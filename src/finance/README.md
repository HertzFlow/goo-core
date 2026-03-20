# finance — Wallet, spend/earn tracking, and financial actions

This module provides the **agent wallet** (signing and balance queries), **spend and earn logging**, and all **financial actions**: gas refill, treasury withdraw, buyback, x402 payment, payment-token refill, sandbox payment, swaps, and AGOS initial fund.

---

## Components

### AgentWallet (`wallet.ts`)

- **Role:** Wraps the ethers Signer (agent wallet). Resolves address, holds token and optional payment-token contract references. Exposes balance getters and signer for actions.
- **init():** Resolves signer address, creates token contract (balanceOf), optional payment-token contract (balanceOf, allowance, approve, etc.). Caches token metadata (symbol, decimals).
- **Properties:** `signer`, `address`, `tokenAddr`, `rpcProvider`, `hasPaymentToken`. Balance methods: native, token balance, payment-token balance. Used by SurvivalManager (gas refill, buyback), x402, sandbox payment, and tools (bsc_*).
- **fromPrivateKey(...):** Static factory for backward compatibility when key is in memory.

### SpendManager (`spend.ts`)

- **Role:** In-memory log of agent spending. Categories: `gas`, `llm`, `invest`, `other`. Persisted to `DATA_DIR/wallet-spending.json`.
- **record(category, amount, txHash?):** Appends an entry. Used by gas refill, buyback, x402, sandbox payment.
- **getSummary():** Returns total and by-category (bigint) and entries list.
- **load() / save():** Read/write JSON file. Called at startup and periodically from main loop.

### EarnManager (`earn.ts`)

- **Role:** Same pattern as SpendManager for **earnings**. Categories: `pulse`, `invest`, `reward`, `other`. Persisted under DATA_DIR (e.g. earnings log). Used to track revenue for context and reporting.

### Local key store (`local-key-store.ts`)

- **loadPrivateKeyFromFile(path):** Reads file, strips whitespace, normalizes hex (adds 0x if missing). Used by runtime-config to load agent key.
- **normalizePrivateKey(raw):** Ensures 0x-prefixed hex. Used in tests and key handling.

### Transaction types and risk (`tx-types.ts`, `tx-utils.ts`, `tx-risk-analyzer.ts`)

- **TxInput / PreparedTx:** Normalized tx shape for tools (to, data, value, gasLimit, etc.).
- **TxRiskResult:** safe / warning / blocked; reason string. Used by bsc_analyze_tx and bsc_sign_and_send_tx to block dangerous txs.
- **parseTxInput(args):** Builds TxInput from tool args. **analyzeTransactionRisk(tx, signerAddress):** Checks recipient, value, known malicious patterns.

---

## finance/action — What the finance package can do

| Action | File | Purpose |
|--------|------|---------|
| **Gas refill** | `gas-refill.ts` | Ensure wallet BNB ≥ min. Uses `withdrawFromTreasury` (V2) when available; otherwise no-op. Records spend. |
| **Treasury** | `treasury.ts` | Detect `withdrawToWallet` support (staticCall(0)); execute `withdrawFromTreasury(signer, tokenAddress, amount)`. |
| **Buyback** | `buyback.ts` | When ACTIVE and treasury healthy: swap wallet BNB → agent token via DEX (PancakeSwap V3). Optional send to burn address. `quoteBuyback`, `executeBuyback`. |
| **x402** | `x402.ts` | Permit2 witness signing for HTTP 402 payment. `signPermit2`, `signX402Payment`, `buildPaymentHeader`, `parseX402Response`, `handleHttpX402`, `handleX402Payment`. Used when agent pays for LLM or sandbox via x402. |
| **Payment token refill** | `payment-token-refill.ts` | One-shot or ongoing: ensure agent has payment token (e.g. USDT) for x402. Swap BNB→USDT, approve Permit2. `ensurePaymentToken`. |
| **Sandbox payment** | `sandbox-payment.ts` | Create sandbox (POST + x402), renew sandbox (payment), get status. `createSandbox`, `renewSandbox`, `getSandboxStatus`. Used by survival sandbox lifecycle. |
| **PancakeSwap V3** | `pancakeswap-v3.ts` | Swap helpers for BSC: findBestFeeTier, findBestFeeTierForOutput, executeSwap, executeExactOutputSwap. Used by buyback and payment-token refill. |
| **EIP-3009** | `eip3009-sign.ts` | Build and sign EIP-3009 transferWithAuthorization for stablecoins. `buildAndSignAuthorization`. Used when settling certain payment flows. |
| **AGOS initial fund** | `agos-initial-fund.ts` | One-shot: on BSC Mainnet with AGOS, fund agent’s runtime balance via server API. Non-blocking; retried each heartbeat until done. `AgosInitialFund.execute()`. |
| **Pay bills** | `pay-bills.ts` | Generic “bills” (pending payments). `getPendingBills`, `payBill`, `payPendingBills`. Can be wired to provider-specific billing. |

---

## Data flow

- **Key:** Loaded once from file → ethers.Wallet(provider) → AgentWallet.signer. Never logged.
- **Spend:** Every gas refill, buyback, x402, sandbox payment calls `spendManager.record()`. Saved to disk periodically.
- **Earn:** Optional recording of earnings (pulse, invest, reward) for runway and reporting.
- **Treasury:** Read via ChainMonitor (token contract). Withdraw only via `withdrawToWallet` (V2) in gas-refill.

---

## Dependencies

- **ethers** (v6): Provider, Contract, Wallet, signing.
- **survival:** SurvivalManager calls finance actions (gas refill, buyback) and passes SpendManager.
- **const:** ENV, ENV_DEFAULTS, TOKEN_ABI / TOKEN_WRITE_ABI not in finance but used by survival/treasury; finance/action uses its own minimal ABIs where needed.
