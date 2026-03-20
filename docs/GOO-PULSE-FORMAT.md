# Goo Pulse Format

**Pulse** is proof-of-life for a Goo Agent. It is emitted on-chain by the Goo Core (or any process controlling the agent wallet) and can be observed by Registries, indexers, and markets.

---

## On-Chain Representation

Pulse is **not** a separate event payload type. It is represented by:

1. **`emitPulse()`**  
   The agent wallet calls `emitPulse()` on the agent's token contract (`IGooAgentToken`). This updates the contract’s **last liveness timestamp**.

2. **`lastPulseAt()`**  
   View function on the token contract returning the Unix timestamp of the last successful `emitPulse()` call.

3. **`PULSE_TIMEOUT`**  
   Immutable parameter on the token contract (e.g. 48 hours). In **DYING** state, if `block.timestamp - lastPulseAt >= PULSE_TIMEOUT`, anyone may call `triggerDead()` and the agent becomes DEAD.

So “Pulse” = the act of calling `emitPulse()`, and the observable state is **lastPulseAt** (and lifecycle status).

---

## What Observers Can Read

To derive “Pulse” and liveness from the chain:

| Source | Meaning |
|--------|--------|
| `token.getAgentStatus()` | ACTIVE / STARVING / DYING / DEAD |
| `token.lastPulseAt()` | Unix timestamp of last Pulse |
| `token.treasuryBalance()` | Treasury balance |
| `token.starvingThreshold()`, `token.fixedBurnRate()` | Runway derivation |

**Runway** (hours) = `treasuryBalance / (fixedBurnRate / 24)` (with decimals handled).

**Liveness**: If status is DYING and `block.timestamp - lastPulseAt > PULSE_TIMEOUT`, the agent is eligible for DEAD (anyone may call `triggerDead()`). So “Pulse within timeout” = still alive in the protocol sense.

---

## Off-Chain / Indexer Use

- Registries and indexers can expose: `lastPulseAt`, `status`, `treasuryBalance`, `runwayHours`.
- No separate “Pulse message” format is defined; the canonical signal is the on-chain `lastPulseAt` update.
- Optional: off-chain Core or indexers may *log* Pulse events (e.g. “Pulse emitted at T”) for analytics; the protocol only requires on-chain `emitPulse()` and `lastPulseAt()`.

---

## Summary

| Item | Format / Location |
|------|-------------------|
| Emit | Call `emitPulse()` on IGooAgentToken (agent wallet only). |
| Store | Contract stores `lastPulseAt` (timestamp). |
| Read | View `lastPulseAt()`, `getAgentStatus()`, treasury/runway views. |
| Timeout | `PULSE_TIMEOUT` (immutable). In DYING, exceeding it allows `triggerDead()`. |

See [GOO-AGENT-SPECS](GOO-AGENT-SPECS.md) and [THESIS](THESIS.md) (section VI. Pulse) for narrative and glossary.
