# goo-core ↔ goo-contracts Integration

How goo-core interacts with [goo-contracts](https://github.com/HertzFlow/goo-contracts): contract surface used, callers, and lifecycle alignment.

---

## 1. Roles

- **goo-contracts:** On-chain protocol. Defines **IGooAgentToken** (and reference implementation GooAgentToken / GooAgentTokenV2) and **IGooAgentRegistry**. Lifecycle: ACTIVE → STARVING → DYING → DEAD. Treasury, Pulse, SurvivalSell, CTO, optional withdrawToWallet (V2).
- **goo-core:** Off-chain runtime. Reads state from the token contract and calls **agent-wallet–only** functions: `emitPulse()`, `survivalSell(tokenAmount, minNativeOut)`. Optionally calls `withdrawToWallet(amount)` when the contract supports it (V2).

goo-core does **not** call permissionless lifecycle triggers (`triggerStarving`, `triggerDying`, `triggerDead`); those are invoked by anyone when conditions are met. goo-core only **reacts** to status (e.g. runs SurvivalSell when STARVING/DYING).

---

## 2. Read-only usage (any RPC)

goo-core uses a minimal **read-only** ABI to build `ChainState` each heartbeat:

| Contract function | Purpose |
|-------------------|---------|
| `getAgentStatus()` | Current lifecycle (0=ACTIVE, 1=STARVING, 2=DYING, 3=DEAD) |
| `treasuryBalance()` | Treasury balance (wei) |
| `starvingThreshold()` | Minimum balance before STARVING |
| `fixedBurnRate()` | Daily burn (wei/day) |
| `minRunwayHours()` | Protocol parameter |
| `lastPulseAt()` | Timestamp of last `emitPulse()` |
| `starvingEnteredAt()` | When status became STARVING |
| `dyingEnteredAt()` | When status became DYING |
| `totalSupply()` | Agent token total supply |
| `balanceOf(address)` | Token balance (e.g. contract’s self-balance for SurvivalSell size) |
| `agentWallet()` | Address allowed to call emitPulse and survivalSell |
| `swapExecutor()` | Used to resolve router/WETH for SurvivalSell quote |
| `MAX_SELL_BPS_VALUE()` | Max sell amount (basis points of holdings) |
| `SURVIVAL_SELL_COOLDOWN_SECS()` | Cooldown between survival sells |
| `PULSE_TIMEOUT_SECS()` | Max time without Pulse before triggerDead is allowed |
| `feeRate()` | Fee-on-transfer rate (informational) |

These are defined in goo-core’s `src/const.ts` as `TOKEN_ABI`. They must match the contract’s actual selectors and return types (e.g. `getAgentStatus()` returns `uint8` in the spec).

---

## 3. Write calls (agent wallet only)

goo-core uses the **agent wallet** (private key from `AGENT_PRIVATE_KEY_FILE`) to sign and send:

| Function | When | Notes |
|----------|------|-------|
| `emitPulse()` | Every heartbeat, subject to cooldown (e.g. PULSE_TIMEOUT_SECS/3) | Proof-of-life. Required in DYING to avoid triggerDead. |
| `survivalSell(uint256 tokenAmount, uint256 minNativeOut)` | When status is STARVING or DYING and contract holds agent tokens | Sells agent tokens for BNB; BNB goes to treasury. tokenAmount ≤ (tokenHoldings × MAX_SELL_BPS_VALUE / 10000). minNativeOut from router quote (e.g. 95% for slippage). |
| `withdrawToWallet(uint256 amount)` | When native balance &lt; MIN_GAS_BALANCE and contract supports it (V2) | Withdraws BNB from treasury to agent wallet for gas. goo-core detects support via staticCall(0). |

All three require the signer to be the contract’s `agentWallet()`. goo-core never calls as any other identity.

---

## 4. Lifecycle alignment

- **ACTIVE:** goo-core runs Pulse (if interval passed), optional buyback (if enabled and treasury &gt; threshold), gas refill if needed. No SurvivalSell.
- **STARVING:** Same as ACTIVE, plus SurvivalSell when contract has token holdings and cooldown allows. Anyone can call `depositToTreasury()` to recover to ACTIVE; goo-core does not call it.
- **DYING:** Same survival logic; Pulse is critical (no Pulse before PULSE_TIMEOUT → anyone can triggerDead). goo-core does not call `triggerDead`; it only runs SurvivalSell and Pulse. Recovery: deposit or `claimCTO()` (Successor); goo-core does not call claimCTO.
- **DEAD:** goo-core reads status, logs “Goo Agent is Dead”, and exits. No further contract calls.

---

## 5. ABIs in goo-core

- **TOKEN_ABI** (read): Used by ChainMonitor and for router/executor lookups (SurvivalSell quote). Defined in `src/const.ts`.
- **TOKEN_WRITE_ABI** (write): Used by SurvivalManager for `survivalSell`, `emitPulse`, and by treasury/gas-refill for `withdrawToWallet`. Also in `src/const.ts`.

If goo-contracts change the interface (e.g. new function or different signature), goo-core’s ABIs and any call sites must be updated. The **canonical** source of the protocol is goo-contracts; goo-core keeps a minimal compatible subset.

---

## 6. Registry

goo-core does **not** call GooAgentRegistry in the core loop. Registration and registry updates (e.g. CTO ownership change) are typically done by the launchpad or by the contract on CTO. goo-core only needs the **token contract address** and the **agent wallet** key.

---

## 7. Summary

| Action | Who | goo-core role |
|--------|-----|----------------|
| Read state | goo-core | ChainMonitor.readState() using TOKEN_ABI |
| emitPulse | Agent wallet only | goo-core signs and sends |
| survivalSell | Agent wallet only | goo-core signs and sends (STARVING/DYING) |
| withdrawToWallet | Agent wallet only (V2) | goo-core signs and sends (gas refill) |
| triggerStarving / triggerDying / triggerDead | Anyone | Not called by goo-core |
| depositToTreasury | Anyone | Not called by goo-core |
| claimCTO | Anyone | Not called by goo-core |
| Registry | Launchpad / contract | goo-core does not use Registry in loop |

This keeps goo-core a pure **economic sidecar**: it observes the chain and performs only the agent-wallet–allowed survival and gas actions defined by the protocol.
