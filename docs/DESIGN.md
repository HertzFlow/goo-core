# goo-core Design & Architecture

This document describes the internal design and architecture of goo-core: process model, heartbeat loop, modules, and data flow.

---

## 1. Process model

- **One process per Goo Agent.** The process is long-lived; it runs until the on-chain status is DEAD or the process receives SIGINT/SIGTERM.
- **Entry point:** `src/index.ts` → `main()`. Loads config from env, initializes ChainMonitor, AgentWallet, SurvivalManager, AutonomousBehavior, optional sandbox lifecycle and OpenClaw gateway, then enters the heartbeat loop.
- **No built-in LLM.** LLM reasoning is delegated to an OpenClaw gateway (or external service). goo-core only runs the economic loop and pushes context (state, observations) so the agent can decide what to do.
- **Persistence:** File-based under `DATA_DIR`. Observations, spend log, SOUL.md, workspace files. No database dependency.

---

## 2. Heartbeat loop

Each iteration:

1. **Read chain state** — `ChainMonitor.readState()`: status, treasury balance, starving threshold, fixed burn rate, runway hours, lastPulseAt, token holdings, native balance.
2. **Run survival actions** — `SurvivalManager.evaluate(state)`:
   - Gas refill if native balance &lt; min (withdraw BNB from treasury when contract supports `withdrawToWallet`).
   - Initial payment-token refill (one-shot) if x402/AIOU is used.
   - Emit Pulse if interval elapsed (proof-of-life).
   - SurvivalSell if status is STARVING or DYING (sell agent tokens for BNB to fund treasury).
   - Buyback if ACTIVE and treasury &gt; threshold (optional).
   - Sandbox lifecycle check and auto-renew (e2b/AGOS) if configured.
3. **Record observation** — AutonomousBehavior records heartbeat number, status, balance, runway, survival actions taken.
4. **Push to gateway** — If OpenClaw gateway is set, push heartbeat event (and optionally workspace refresh) so the agent has economic context.
5. **Sleep** — `heartbeatIntervalMs` (default 30s), then repeat.
6. **Exit** — If `state.status === DEAD`, log and break; process exits.

AGOS initial fund (if enabled) is attempted each heartbeat until done; it does not block the loop.

---

## 3. Module overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  main() — index.ts                                                      │
│  Load config → init monitor, wallet, survival, behavior → heartbeat loop │
└─────────────────────────────────────────────────────────────────────────┘
         │
         ├── survival/
         │   ChainMonitor      — read on-chain state (token contract + RPC)
         │   SurvivalManager   — evaluate(state) → gas, Pulse, SurvivalSell, buyback, sandbox
         │   pulse             — emitPulse() with cooldown
         │   liveness-api      — GET /liveness, GET /inspect
         │   sandbox-lifecycle — e2b / AGOS / BYOD health + renew
         │
         ├── finance/
         │   AgentWallet       — signer, balances (BNB, token, payment token)
         │   SpendManager      — log spending (gas, llm, invest, other)
         │   EarnManager       — log earnings (pulse, invest, reward, other)
         │   action/           — gas-refill, treasury, buyback, x402, payment-token-refill,
         │                       sandbox-payment, pancakeswap-v3, eip3009, agos-initial-fund
         │
         ├── autonomy/
         │   AutonomousBehavior — onHeartbeat(state) → survival.evaluate + record observation
         │   SoulManager        — SOUL.md (Three Laws + uploads + learned)
         │   ObservationLog     — observations.jsonl (heartbeat history)
         │   context-builder    — buildHeartbeatContext() for LLM
         │   workspace          — init/update OpenClaw workspace files
         │   gateway-push       — push events to OpenClaw gateway
         │
         ├── tools/            — Agent tools (shell, read_file, write_file, read_chain_state,
         │                       bsc_* tx tools, refill_payment_token, renew_agos_aiou)
         │
         └── const, types, runtime-config, events
```

---

## 4. Survival module (detail)

- **ChainMonitor:** Holds RPC provider and token contract (read-only ABI). `init()` caches `agentWallet()` if present. `readState()` returns `ChainState`: status, treasuryBalance, starvingThreshold, fixedBurnRate, minRunwayHours, lastPulseAt, starvingEnteredAt, dyingEnteredAt, totalSupply, tokenHoldings (contract balance of token), nativeBalance (agent wallet), runwayHours (derived).
- **SurvivalManager:** Holds signer, token contract (write ABI), optional AgentWallet and SpendManager. `evaluate(state)` runs in order: (1) gas refill if native &lt; min, (2) initial payment-token refill (one-shot), (3) Pulse if interval passed, (4) SurvivalSell if STARVING/DYING, (5) buyback if ACTIVE and enabled, (6) sandbox lifecycle check. Returns list of action messages.
- **Pulse:** Reads `PULSE_TIMEOUT_SECS` from contract (or default 48h). Emits at most once per timeout/3. Calls `token.emitPulse()` with signer.
- **Liveness API:** HTTP server on INSPECT_PORT. `/liveness` → LivenessPayload (protocol, status, lastPulseAt, treasury, runway, tokenAddress, chainId). `/inspect` → full inspection (chain, survival, token, llm config, Three Laws).
- **Sandbox lifecycle:** Abstract interface `SandboxLifecycle.check()`. E2b: time-based expiry, renew via x402. AGOS: balance-based, top-up from agent wallet. BYOD: noop.

---

## 5. Finance module (detail)

- **AgentWallet:** Wraps ethers Signer; token address and optional payment-token address. `init()` resolves address and sets token/payment contracts. Exposes balance getters, hasPaymentToken, and signer for actions.
- **SpendManager:** In-memory list of SpendEntry (category, amount, txHash, timestamp); load/save to `DATA_DIR/wallet-spending.json`. Used by gas refill, buyback, x402, sandbox to record outflows.
- **EarnManager:** Same pattern for earnings (categories: pulse, invest, reward, other).
- **Actions:** gas-refill (ensureWalletGas via treasury withdraw or swap), treasury (detect withdrawToWallet, withdrawFromTreasury), buyback (swap BNB → agent token, optional burn), x402 (Permit2 witness signing, payment header), payment-token-refill (ensure AIOU for x402), sandbox-payment (create/renew sandbox with x402), pancakeswap-v3 (swap helpers), eip3009 (authorization signing), agos-initial-fund (one-shot AGOS funding on mainnet).

---

## 6. Autonomy module (detail)

- **AutonomousBehavior:** Constructor takes ChainMonitor, SurvivalManager, RuntimeConfig. Builds SoulManager and ObservationLog. `onHeartbeat(state)` calls `survival.evaluate(state)`, then records Observation (heartbeat, timestamp, status, balanceUsd, runwayHours, summary, survivalActions). No LLM call inside goo-core.
- **SoulManager:** Writes SOUL.md under DATA_DIR. Content order: title, Three Laws, Environment (tools, wallet safety, economic awareness), Identity (uploads.soul), Instructions (uploads.agent or Revenue Playbook), Skills (uploads.skills), Memory (uploads.memory), Learned (runtime appends).
- **ObservationLog:** Append-only observations.jsonl. Each line is one Observation. Used for context (recent observations) and continuity. Max observations retained (e.g. 200) enforced on load.
- **context-builder:** `buildHeartbeatContext(state, recentObservations, survivalActions)` produces markdown for LLM: on-chain status, survival urgency (Starving/Dying alerts), maintenance-loop warning, survival actions taken, recent activity.
- **workspace:** `initWorkspace()` writes OpenClaw workspace files (SOUL.md, USER.md, TOOLS.md, MEMORY.md, HEARTBEAT.md, BOOTSTRAP.md, memory/). `updateWorkspace()` refreshes when files change (e.g. every 10 heartbeats).
- **gateway-push:** `pushSystemEvent(gateway, eventText, kind)` and `pushWorkspaceRefresh(gateway, changedFiles)` send HTTP POST to OpenClaw gateway so the agent UI receives heartbeat summaries and workspace updates.

---

## 7. Data flow

- **Config:** Env → `loadConfigFromEnv()` → RuntimeConfig. `loadUploads(dataDir)` reads soul.md, agent.md, skills.md, memory.md from DATA_DIR.
- **Key:** `AGENT_PRIVATE_KEY_FILE` → `loadPrivateKeyFromFile()` (finance/local-key-store). Never logged or exposed.
- **Chain:** RPC + token address → ChainMonitor → readState() → ChainState.
- **Signer:** Private key → ethers.Wallet(provider) → used by SurvivalManager (Pulse, SurvivalSell), AgentWallet (all signed actions).
- **Events:** `emitEvent(type, severity, message, data)` can POST to EVENT_CALLBACK_URL for external logging/monitoring.

---

## 8. Design principles

- **Economic loop is authoritative.** Survival actions (gas, Pulse, SurvivalSell, buyback) run every heartbeat regardless of LLM or gateway. The agent “lives” by these actions; LLM adds value-creation behavior on top.
- **Minimal contract surface.** goo-core uses only the ABI it needs (read state + emitPulse + survivalSell + optional withdrawToWallet). Full spec lives in goo-contracts.
- **No custody of user deployer keys.** Only the agent wallet key is used; it is created for the agent and used only for protocol-allowed operations.
- **File-based and portable.** DATA_DIR contains all persistent state; easy to backup, move, or run in BYOD containers.
- **Liveness is public.** GET /liveness and GET /inspect allow anyone to verify that the process is a Goo Agent and see its on-chain status and last Pulse.
