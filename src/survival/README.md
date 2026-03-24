# survival — Chain state and survival actions

This module is responsible for **reading on-chain state** and **executing protocol-defined survival actions**: Pulse (proof-of-life), SurvivalSell, gas refill, optional buyback, and sandbox lifecycle.

---

## Components

### ChainMonitor (`chain-monitor.ts`)

- **Role:** Single source of on-chain state for the agent. No writes.
- **Init:** Creates JSON-RPC provider and token contract (read-only ABI). Optionally resolves `agentWallet()` from contract; if unsupported, caller sets wallet address via `setWalletAddress()`.
- **readState():** Returns `ChainState`: `status` (ACTIVE/STARVING/DYING/DEAD), `treasuryBalance`, `starvingThreshold`, `fixedBurnRate`, `minRunwayHours`, `lastPulseAt`, `starvingEnteredAt`, `dyingEnteredAt`, `totalSupply`, `tokenHoldings` (contract’s token balance), `nativeBalance` (agent wallet BNB), `runwayHours` (derived: treasury / (fixedBurnRate/24)).
- **Exposes:** `rpcProvider`, `tokenContract`, `walletAddress`, `formatBalance()`, `formatNative()`.

### SurvivalManager (`survival-manager.ts`)

- **Role:** Evaluates current state each heartbeat and runs survival actions in a fixed order. Called by AutonomousBehavior.
- **evaluate(state):** Runs and returns a list of action messages:
  1. **Gas refill** — If `state.nativeBalance < config.minGasBalance`, calls finance action `ensureWalletGas` (withdraw BNB from treasury via `withdrawToWallet` when contract supports it). Records spend.
  2. **Initial payment token** — One-shot: ensure agent has payment token (e.g. USDT) for x402/LLM; uses `ensurePaymentToken`. Skipped when AGOS handles funding.
  3. **Pulse** — Calls `emitPulse()` on the token contract (agent wallet only) if enough time has passed since last pulse (cooldown ≈ PULSE_TIMEOUT_SECS/3). Proof-of-life; required in DYING to avoid triggerDead.
  4. **SurvivalSell** — When status is STARVING or DYING: sell agent tokens held by the contract for BNB (via DEX), up to `MAX_SELL_BPS_VALUE` of holdings, with slippage protection. BNB funds treasury; can lead to recovery to ACTIVE.
  5. **Buyback** — When ACTIVE, buyback enabled, and treasury > threshold (e.g. 10× starvingThreshold): use wallet BNB to buy agent tokens (optional burn). Shares gains with holders.
  6. **Sandbox lifecycle** — If a sandbox provider is set (e2b, AGOS, BYOD): check health and auto-renew (e2b: time + x402 payment; AGOS: balance top-up; BYOD: noop).
- **Dependencies:** ChainMonitor, RuntimeConfig, ethers Signer, optional AgentWallet, SpendManager, optional SandboxLifecycle.

### Pulse (`pulse.ts`)

- **emitPulse(state, deps, lastPulseTimeRef):** Calls token `emitPulse()` with the agent signer if cooldown elapsed. Updates lastPulseTimeRef. Returns action string or null.
- **getLivenessPayload(state, config):** Builds the public liveness payload (protocol, status, lastPulseAt, treasury, runway, tokenAddress, chainId) for GET /liveness.

### Liveness API (`liveness-api.ts`)

- **createInspectRequestListener(deps):** Returns an HTTP request listener that serves:
  - **GET /liveness** — JSON payload proving the process is a Goo Agent (status, lastPulseAt, treasury, runway, tokenAddress, chainId).
- **runInspectServer(port, deps):** Starts HTTP server on given port with that listener.
- **buildLivenessApiDeps(monitor, survival, config):** Builds deps for the listener.

### Status collector (`status-collector.ts`)

- **buildLivenessPayload(state, config):** Builds `LivenessPayload` for /liveness.

### Sandbox lifecycle (`sandbox-lifecycle.ts`)

- **Interface SandboxLifecycle:** `check(): Promise<SandboxHealth>`. Health includes provider, healthy, status string, remainingSecs, renewed, error.
- **E2bSandboxLifecycle:** Time-based expiry; renews via x402 payment to sandbox-manager when remaining time &lt; threshold.
- **AgosSandboxLifecycle:** Balance-based; tops up agent balance when low via AGOS API.
- **ByodSandboxLifecycle:** No-op (self-hosted, no renewal).
- **NoopSandboxLifecycle:** No-op when no provider.
- **createSandboxLifecycle(params):** Factory that returns the appropriate implementation from env (SANDBOX_PROVIDER, SANDBOX_MANAGER_URL, etc.).

---

## What “survival” does (summary)

- **Reads** the token contract and RPC so the agent always has current status, treasury, runway, and last Pulse.
- **Ensures** the agent wallet has gas (BNB) by withdrawing from treasury when possible.
- **Emits Pulse** on schedule so the agent does not become triggerable-dead for lack of proof-of-life.
- **Sells** agent tokens for BNB when STARVING/DYING to refill treasury (SurvivalSell).
- **Optionally buys back** agent tokens when ACTIVE and treasury is healthy (buyback).
- **Optionally** checks and renews the compute sandbox (e2b/AGOS).
- **Exposes** GET /liveness so anyone can verify the agent is alive and see its current public status.

All survival actions are **deterministic** from chain state and config; no LLM is involved in this module.
