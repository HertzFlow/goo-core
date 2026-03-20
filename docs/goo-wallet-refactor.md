Finance 模块迁移计划

目标

将所有“业务流程”最终迁移到 Finance 模块。

- `AgentWallet` 只保留底层钱包适配能力：密钥、签名器、地址、余额查询、必要的 approve、必要的只读元数据/capability 暴露
- `finance/spend.ts`、`finance/earn.ts`、`finance/action/*` 承担所有资金业务逻辑与流程编排
- 上层调用方（`llm-client`、`survival-manager`、`index`）不再直接依赖 `wallet.ts` 中的业务方法，而是统一依赖 Finance 模块

设计原则

- Wallet 是 adapter，不是 orchestrator
- Finance 是业务边界，负责 gas、x402、treasury、spend、earn
- `index.ts` 负责装配依赖与生命周期，不负责业务细节
- 若为完成迁移需要缩小 `AgentWallet` API，视为预期变更；不再要求 “wallet 外部 API 不变”

---

Phase 0: 先定义最终边界

在开始搬代码前，先明确模块职责，避免一边抽离一边把流程重新塞回 wallet。

最终职责划分：

- `src/finance/wallet.ts`
  - `constructor(privateKey, tokenAddress, provider)`
  - `init()`
  - `getStableBalance()`
  - `getNativeBalance()`
  - `getTokenBalance()`
  - `approveSpend(spender, amount)`
  - `get signer / address / stableAddr / stableDecimalCount`
  - 必要时补充少量只读 metadata accessors，供 Finance 模块使用
- `src/finance/spend.ts`
  - `record()`
  - `getSummary()`
  - `getEntries()`
  - `load()`
  - `save()`
- `src/finance/earn.ts`
  - `record()`
  - `getSummary()`
  - `load()`
  - `save()`
- `src/finance/action/x402.ts`
  - Permit2 常量
  - 签名逻辑
  - payment header 组装
  - 402 后重试
  - 结算后的 spend 记录
- `src/finance/action/gas-refill.ts`
  - native balance 检查
  - treasury 提款
  - allowance / approve
  - stable -> native swap
  - gas spend 记录
- `src/finance/action/treasury.ts`
  - V1 / V2 capability probe
  - `withdrawFromTreasury()`
- `src/finance/action/buyback.ts`
  - buyback quote / execute
  - buyback 相关 spend / earn 记录接入
  - 后续所有 buyback 流程统一从 Finance 进入

说明：

- treasury capability 不应继续藏在 wallet 的业务实现里
- x402 不应只迁签名函数，完整支付流程也应进入 Finance
- gas refill 不应只迁 swap 片段，完整决策与执行都应进入 Finance
- buyback 也属于 Finance 业务边界，不应在别处重新长出流程实现
- 统一采用一个归属原则：action 模块各自创建自己需要的合约实例，`AgentWallet` 不再持有 `routerContract` / `tokenContract` 这类流程导向对象

---

Phase 1: 支出记录独立化

SpendManager 自持数据，不再委托 wallet。

- 将 `wallet.ts` 中的 `spendLog[]`、`recordSpend()`、`getSpendingSummary()`、`saveLog()`、`loadLog()` 搬到 `spend.ts`
- 将 `SpendCategory`、`SpendEntry`、`SpendingSummary` 类型一并迁移到 `spend.ts`
- `SpendManager` 构造不再强依赖 `AgentWallet`
- `SpendManager` 改为仅依赖自身状态和可选 `dataDir`
- `index.ts` 主入口创建 `SpendManager`
- 启动时由 `SpendManager.load()` 读取 `wallet-spending.json`
- 心跳周期和 shutdown 时由 `SpendManager.save()` 持久化
- `wallet.ts` 删除 spending 相关代码
- `finance/index.ts` 改为从 `spend.ts` 导出 `SpendCategory`、`SpendEntry`、`SpendingSummary`

调用方变更：

- `llm-client.ts` 不再调用 `wallet.recordSpend()`
- `gas-refill.ts` 在 swap 成功后调用 `spendManager.record("gas", amount, txHash)`
- 其他支出动作统一通过 `SpendManager` 记录

测试同步：

- 原 `wallet.loadLog()`、`wallet.getSpendingSummary()` 测试迁移到 `SpendManager`
- 新增 `SpendManager.load/save/summary` 测试

---

Phase 2: Permit2 / x402 全流程迁移

将 x402 相关逻辑完整迁移到 `finance/action/x402.ts`，而不是只迁一个签名方法。

- 将 Permit2 常量（`PERMIT2_ADDRESS`、`X402_PERMIT2_PROXY`、`PERMIT2_WITNESS_TYPES`）移到 `action/x402.ts`
- 将 `wallet.signPermit2()` 逻辑下沉为纯函数或 action helper
- `signX402Payment()` 入参改为 `signer: ethers.Wallet` + 支付参数
- 新增更高层的 action，例如：
  - 解析 402 响应
  - 生成 payment payload / header
  - 注入 header 重试请求
  - 从响应头读取结算信息
  - 调用 `SpendManager.record("llm", ...)`
- `wallet.ts` 删除 `signPermit2()` 和 Permit2 常量

调用方变更：

- `llm-client.ts` 不再直接持有 `wallet.signPermit2()` 这类流程依赖
- `llm-client.ts` 改为依赖 Finance 的 x402 action/service
- 若没有 `AgentWallet`，则 fallback 签名逻辑也在这一阶段一并迁入 Finance；不要继续保留在 `llm-client.ts` 的 private method 中
- `llm-client.ts` 在这一阶段就删除重复的 Permit2 常量与 `signPermit2Payment()` fallback 分支，不要拖到收尾阶段

测试同步：

- 为 `x402.ts` 增加签名 payload、payment header、402 重试、spend 记录测试
- 删除对 `wallet.signPermit2()` 的直接测试依赖

---

Phase 3: Treasury 能力独立

将 treasury 相关能力从 wallet 业务实现中抽离到独立 action。

- 先重设计 `wallet.ts` 的 `init()`：迁移后 `init()` 只负责 signer 初始化和基础 metadata 读取，不再做 treasury capability probe
- 新建 `src/finance/action/treasury.ts`
- 将 `withdrawFromTreasury()` 从 `wallet.ts` 提取到 `treasury.ts`
- 将 V2 capability probe（当前 `withdrawToWallet.staticCall(0n)` 语义）迁移到 `treasury.ts`
- Finance 对外暴露明确接口，例如：
  - `detectTreasuryCapabilities(...)`
  - `withdrawFromTreasury(...)`

`init()` 拆分原则：

- `wallet.init()` 只保留通用、可复用的基础初始化
- treasury capability probe 不再在 `wallet.init()` 中执行
- treasury action 在自身模块内读取和缓存自己需要的 capability 信息
- 若某项 metadata 只被某个 action 使用，则优先在该 action 内读取，不放回 wallet

对 `AgentWallet` 的要求：

- 如 Finance 仍需 token address / signer / stable decimals 等上下文，由 `AgentWallet` 提供只读 accessors
- `AgentWallet` 不再直接暴露 `withdrawFromTreasury()`
- `AgentWallet` 不再直接负责 `isV2` 的业务解释；若调用方仍需展示 capability，由 Finance 或 capability 对象提供

调用方变更：

- `index.ts` 如需打印当前 treasury capability，应读取 Finance capability，而不是 `agentWallet.isV2`

测试同步：

- 现有 `wallet.isV2` 测试迁移为 `treasury capability` 测试

---

Phase 4: Gas 补充逻辑完整迁移

将 gas refill 的完整流程迁移到 `finance/action/gas-refill.ts`。

迁移内容：

- 将 `ensureGas()` 的完整流程从 `wallet.ts` 挪到 `gas-refill.ts`
  - 检查 native balance
  - 检查 wallet stable balance
  - 必要时通过 `treasury.ts` 提款
  - 检查 allowance / approve router
  - 执行 stable -> native swap
  - 记录 gas spend
- 将当前 `wallet.init()` 中与 gas refill 相关的初始化一并迁出
  - `ROUTER()` / `WRAPPED_NATIVE()` 等 metadata 由 `gas-refill.ts` 自行读取
  - router 合约实例由 `gas-refill.ts` 自行创建
- `ensureWalletGas()` 入参改为至少包含：
  - `wallet: AgentWallet`
  - `spendManager: SpendManager`
  - treasury / router 所需上下文

关键实现要求：

- 不要把流程迁出后又要求 `AgentWallet` 保留 routerContract、swap、withdraw 等业务方法
- 明确采用单一方案：action 模块各自创建自己需要的合约实例，不让 wallet 持有 `routerContract` / `tokenContract`
- action 所需上下文优先来自 `wallet.signer`、wallet 地址、基础 metadata；其余链上 metadata 由 action 自己读取
- `gas-refill.ts` 应成为唯一的 gas refill 业务入口

`wallet.ts` 删除：

- `ensureGas()`
- router swap 逻辑
- gas refill 过程中的 spend 记录
- `routerContract`
- 为 gas refill 服务的 `tokenContract` / `routerAddr` / capability probe

调用方变更：

- `survival-manager.ts` 改为调用 `ensureWalletGas(wallet, spendManager, ...)`
- `survival-manager.ts` 不再直接依赖 `wallet.ensureGas()`

测试同步：

- 为 `gas-refill.ts` 增加以下测试：
  - gas 足够时不动作
  - 钱包 stable 足够时直接 swap
  - 钱包 stable 不足但 treasury 可提款时先提款再 swap
  - treasury 不可用时返回明确错误
  - swap 成功后记录 gas spend

---

Phase 5: EarnManager 独立化

`EarnManager` 也要与 `SpendManager` 一样，从 `AgentWallet` 依赖中解耦。

- 将 `src/finance/earn.ts` 的 `EarnManagerConfig` 从 `wallet: AgentWallet` 改为独立配置
- 若仅为持久化而保留 wallet 依赖，直接移除，改为 `dataDir` 或专用 persistence 配置
- 若后续需要做链上余额对比，作为显式入参传入，而不是把 wallet 注入为全能依赖
- `finance/index.ts` 继续从 `earn.ts` 导出 earn 相关类型与 manager

测试同步：

- 为 `EarnManager` 增加独立 load/save 测试
- 确认它不再因 wallet 构造而被耦合到其他模块

---

Phase 6: 上层依赖收口到 Finance

当 spend / treasury / gas / x402 都迁完后，统一清理上层调用路径。

- `src/autonomy/llm-client.ts`
  - 不再直接依赖 `wallet.signPermit2()`
  - 不再直接依赖 `wallet.recordSpend()`
  - 改为依赖 Finance 的 x402 action/service
- `src/survival/survival-manager.ts`
  - 不再直接依赖 `wallet.ensureGas()`
  - 改为依赖 Finance 的 gas refill action
- `src/index.ts`
  - 创建并注入 `SpendManager`
  - 创建并注入 Finance action/service 所需依赖
  - 将当前 `wallet.loadLog()` / `wallet.saveLog()` 生命周期迁移到 `SpendManager`

目标结果：

- 钱包对象只提供底层能力
- 所有资金业务都从 Finance 进入
- `llm-client` 和 `survival-manager` 都不再知道 wallet 内部有哪些“业务方法”

---

Phase 7: 收尾清理

- `wallet.ts` 最终只保留底层钱包能力与必要只读 metadata
- Router ABI 移到 `gas-refill.ts`
- treasury 相关 ABI / capability 检测移到 `treasury.ts`
- `finance/index.ts` 更新导出，统一暴露：
  - `AgentWallet`
  - `SpendManager`
  - `EarnManager`
  - `SpendCategory` / `SpendEntry` / `SpendingSummary`
  - `x402` actions
  - `gas-refill` actions
  - `treasury` actions
- `buyback` actions
- 清理 `wallet.ts` 中不再使用的 ABI、类型和 imports
- 跑测试验证

建议验证顺序：

- 单测先过
- 再跑与 heartbeat / startup 相关的集成测试
- 最后回归一次启动流程，确认 spend log 仍会在启动时加载、运行中保存、退出时保存

---

迁移后 wallet.ts 的样子

AgentWallet
  ├── constructor(privateKey, tokenAddress, provider)
  ├── init()                    // 只做基础初始化；不再做 treasury probe / router 实例化
  ├── getStableBalance()
  ├── getNativeBalance()
  ├── getTokenBalance()
  ├── approveSpend(spender, amount)
  ├── get signer / address / stableAddr / stableDecimalCount
  └── (必要时补充只读 metadata/capability accessors，供 Finance 使用)

---

依赖变更示意

before:

- `llm-client -> wallet.signPermit2() / wallet.recordSpend()`
- `survival-manager -> wallet.ensureGas()`
- `index -> wallet.loadLog() / wallet.saveLog() / wallet.isV2`

after:

- `llm-client -> finance/action/x402`
- `survival-manager -> finance/action/gas-refill`
- `index -> SpendManager.load/save + Finance capability wiring`

---

执行顺序建议

1. 先迁 `SpendManager`，把持久化生命周期从 wallet 挪出去
2. 再迁 `x402`，收掉 `llm-client` 里的支付流程分叉
3. 再迁 `treasury` capability 与提款
4. 再迁 `gas-refill`，因为它依赖 treasury 与 spend
5. 再迁 `EarnManager` 解耦
6. 最后清理 `wallet.ts` 和上层调用方

这个顺序的原因：

- `gas-refill` 依赖 `spend` 和 `treasury`
- `x402` 依赖 `spend`
- `EarnManager` 属于同一 Finance 边界，适合在核心支出流程稳定后一起解耦
- 先收敛基础模块，再改调用方，回归面最小
