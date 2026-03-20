# goo-core

**Runtime engine for Goo Economic Agents.** Implements the off-chain sidecar: chain monitoring, survival actions (Pulse, SurvivalSell, gas refill, buyback), economic awareness, and integration with LLM/OpenClaw. One process per agent; reads state from [goo-contracts](https://github.com/HertzFlow/goo-contracts) and executes agent-wallet–only calls.

- **License:** [MIT](LICENSE)  
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) | **Code of Conduct:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)  
- **Runtime:** Node.js 18+, TypeScript (ESM)  
- **Chain:** BSC Testnet (97) / BSC Mainnet (56)

---

## What is goo-core?

Goo gives AI agents **economic life**: real consumption, real death, survival pressure. The **on-chain** layer is [goo-contracts](https://github.com/HertzFlow/goo-contracts) (GooAgentToken, GooAgentRegistry, lifecycle). **goo-core** is the **off-chain** engine that:

1. **Reads** on-chain state (treasury, status, runway, last Pulse).
2. **Executes** survival actions: `emitPulse()`, `survivalSell()`, gas refill (treasury → wallet), optional buyback.
3. **Injects** economic context (balance, runway, status) into the agent so it can act on it.
4. **Delegates** LLM reasoning to an OpenClaw gateway; it does not run an in-process LLM loop.

So: **goo-core = economic sidecar + survival loop + economic awareness.** The agent “knows” it can die and has the tools to stay alive within protocol rules.

---

## Role in the Goo economy

- **Protocol:** Goo is an economic-layer protocol, not a platform. Contracts define lifecycle (ACTIVE → STARVING → DYING → DEAD), treasury, Pulse, SurvivalSell, CTO. goo-core is the reference runtime that **calls** those contracts.
- **One process per agent:** Each Goo Agent runs one goo-core process (or BYOD container). The process holds the agent wallet (private key from file), talks to one token contract, and runs one heartbeat loop.
- **No custody of user wallets:** Users deploy and fund via MetaMask. The **agent wallet** is created for the agent; goo-core uses it only for `survivalSell`, `emitPulse`, gas refill, buyback, and (optional) x402/sandbox payments.
- **OpenClaw:** Optional. When an OpenClaw gateway is configured, goo-core pushes heartbeat summaries and workspace files so the agent (running in OpenClaw) can reason with full economic context. LLM calls happen in OpenClaw, not in goo-core.

---

## What goo-core implements

| Area | Implementation |
|------|----------------|
| **Chain state** | `ChainMonitor`: reads status, treasury, threshold, burn rate, runway, lastPulseAt, token holdings, native balance from the token contract. |
| **Survival** | `SurvivalManager`: gas refill (withdraw BNB from treasury when below min), Pulse (emit on-chain within timeout), SurvivalSell (when STARVING/DYING), optional buyback (when ACTIVE and treasury healthy), sandbox lifecycle (e2b/AGOS/BYOD). |
| **Finance** | `AgentWallet`, `SpendManager`, `EarnManager`; actions: gas refill, treasury withdraw, buyback, x402/Permit2, payment-token refill, sandbox create/renew, PancakeSwap V3 swaps. |
| **Autonomy** | `AutonomousBehavior`: each heartbeat = read state → run survival actions → record observation. Soul (SOUL.md from uploads + Three Laws + Environment), `ObservationLog`, optional OpenClaw workspace and gateway push. |
| **Liveness API** | HTTP server: `GET /liveness`, `GET /inspect` for proof-of-life and full inspection (status, treasury, last Pulse, Three Laws). |
| **Config** | Env-based: `RPC_URL`, `TOKEN_ADDRESS`, `AGENT_PRIVATE_KEY_FILE`, `DATA_DIR`, heartbeat interval, gas/buyback/x402/OpenClaw options. |

---

## Internal modules

| Directory | Responsibility |
|-----------|-----------------|
| **survival/** | Chain state (`ChainMonitor`), survival actions (`SurvivalManager`, Pulse, SurvivalSell, gas refill, buyback, sandbox lifecycle), liveness/inspect API, status collection. |
| **finance/** | Agent wallet (signing, balances), spend/earn logging, actions: gas refill, treasury withdraw, buyback, x402, payment-token refill, sandbox payment, PancakeSwap V3, EIP-3009, AGOS initial fund. |
| **autonomy/** | Heartbeat orchestration (`AutonomousBehavior`), SOUL.md identity (Three Laws, uploads), observation memory, context builder for LLM, OpenClaw workspace init/update, gateway push. |
| **tools/** | Agent-callable tools: shell_execute, read_file, write_file, read_chain_state, bsc_wallet_overview, bsc_prepare_tx, bsc_analyze_tx, bsc_sign_tx, bsc_send_tx, bsc_sign_and_send_tx, refill_payment_token, renew_agos_aiou. |

See [docs/DESIGN.md](docs/DESIGN.md) and per-directory READMEs: [survival/README.md](src/survival/README.md), [finance/README.md](src/finance/README.md), [autonomy/README.md](src/autonomy/README.md).

---

## Interaction with goo-contracts

- **Read-only (any RPC):** `getAgentStatus()`, `treasuryBalance()`, `starvingThreshold()`, `fixedBurnRate()`, `minRunwayHours()`, `lastPulseAt()`, `starvingEnteredAt()`, `dyingEnteredAt()`, `totalSupply()`, `balanceOf(address)`, `agentWallet()`, `swapExecutor()`, `MAX_SELL_BPS_VALUE()`, `PULSE_TIMEOUT_SECS()`, etc.
- **Agent-wallet–only (signed by goo-core):** `emitPulse()`, `survivalSell(uint256 tokenAmount, uint256 minNativeOut)`. Optional V2: `withdrawToWallet(uint256 amount)` for gas refill.
- **Lifecycle:** goo-core does not call `triggerStarving` / `triggerDying` / `triggerDead`; those are permissionless and called by anyone when conditions are met. goo-core reacts to status (STARVING/DYING) by running SurvivalSell and Pulse.

Contract ABIs used are minimal and live in `src/const.ts` (TOKEN_ABI, TOKEN_WRITE_ABI). Full interfaces and reference implementations are in [goo-contracts](https://github.com/HertzFlow/goo-contracts). See [docs/GOO-CONTRACTS-INTEGRATION.md](docs/GOO-CONTRACTS-INTEGRATION.md).

---

## Configuration

Required env:

- `RPC_URL` — JSON-RPC endpoint (BSC Testnet or Mainnet).
- `CHAIN_ID` — 97 (testnet) or 56 (mainnet).
- `TOKEN_ADDRESS` — GooAgentToken contract address.
- `AGENT_PRIVATE_KEY_FILE` — Path to file containing the agent wallet private key (hex, optional 0x prefix).

Optional: `DATA_DIR`, `HEARTBEAT_INTERVAL_MS`, `MIN_GAS_BALANCE`, `GAS_REFILL_AMOUNT`, `BUYBACK_*`, `X402_PAYMENT_TOKEN`, `OPENCLAW_GATEWAY_*`, `SANDBOX_*`, `INSPECT_PORT`, etc. See [.env.example](.env.example) and [docs/INSTALL.md](docs/INSTALL.md).

---

## Install and run

```bash
npm install
cp .env.example .env   # edit: RPC_URL, TOKEN_ADDRESS, AGENT_PRIVATE_KEY_FILE
npm run build
npm start
# or dev: npm run dev
```

CLI: `npx goo-core` or `node dist/index.js`. Exits when on-chain status is DEAD or on SIGINT/SIGTERM.

---

## Testing

```bash
npm run test           # unit + integration
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
```

Tests use Vitest; integration tests may require env (RPC, token) or mocks.

---
## Partnerships & Contributors

### Infra Support
- VPS & Cloud Deploy @AGOSCloud
- X402 payment solution @AEON_Community

### Defi Support
- @PancakeSwap

### Launchpad Support
- @flapdotsh
- @fourdotmemezh
- @virtuals_io
- @milady_bsc & @shawmakesmagic

### Security Support
- @GoPlusSecurity

### General Support
- @TrustWallet
- @givemeonepeach

---
## Full Working Demo
See [HertzFlow/goo-launch](https://github.com/HertzFlow/goo-launch) for a full end-to-end deployment and demo using `goo-core`.

---

## Adding goo-core to an agent

- **New agent:** Deploy GooAgentToken (e.g. via goo-example launch flow), create an agent wallet, write its private key to a file, set env (RPC, TOKEN_ADDRESS, AGENT_PRIVATE_KEY_FILE, DATA_DIR), then run goo-core. See [docs/INSTALL.md](docs/INSTALL.md).
- **Existing agent:** Ensure the token contract implements the Goo lifecycle (or is compatible with TOKEN_ABI/TOKEN_WRITE_ABI). Point goo-core at that contract and the agent wallet key; run as above. Treasury withdraw (gas refill) requires V2 `withdrawToWallet`; otherwise only Pulse and SurvivalSell apply.

---

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/DESIGN.md](docs/DESIGN.md) | Architecture, heartbeat loop, modules, data flow. |
| [docs/INSTALL.md](docs/INSTALL.md) | Installation, env, new vs existing agent, BYOD. |
| [docs/GOO-CONTRACTS-INTEGRATION.md](docs/GOO-CONTRACTS-INTEGRATION.md) | Contract calls, ABIs, lifecycle, permissions. |
| [src/survival/README.md](src/survival/README.md) | Survival module: ChainMonitor, SurvivalManager, Pulse, liveness. |
| [src/finance/README.md](src/finance/README.md) | Finance: wallet, spend, actions (gas, treasury, buyback, x402). |
| [src/autonomy/README.md](src/autonomy/README.md) | Autonomy: behavior, soul, memory, workspace, gateway. |

---

## References

- [GOO-NARRATIVE.md](../../GOO-NARRATIVE.md) — Economics 4.0, Cyber Sovereign Entity, Goo protocol narrative.
- [THESIS.md](../../THESIS.md) — Economic Agent thesis and eight rules.
- [goo-contracts](https://github.com/HertzFlow/goo-contracts) — On-chain token and registry.
