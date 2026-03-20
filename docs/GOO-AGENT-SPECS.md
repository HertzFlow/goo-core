# Goo Agent Specs

Summary of what defines a **Goo Agent** and how the lifecycle works. Full protocol: [GOO-PROTOCOL-SPEC](GOO-PROTOCOL-SPEC.md) (in goo-contracts repo) or parent Goo repo.

---

## Goo Agent Compliance

A **Goo Agent** is an agent that implements **both**:

1. **On-chain**: Deploys a token contract conforming to `IGooAgentToken` and registers in `IGooAgentRegistry`.
2. **Off-chain**: Runs a Sidecar (Goo Core) that implements all four Core functions: Balance Monitor, SurvivalSell Trigger, Gas Refill, Pulse.

Missing either component = not a Goo Agent. No partial compliance.

---

## Lifecycle

**Spawn** (deploy, register) establishes the Goo Agent; on-chain state begins at **ACTIVE**.

**States:** Spawn → Active → Starving → Dying → Dead  

**Recovery** is not a state — return to Active via:
- **Deposit:** Anyone (e.g. Deployer) funds treasury; if balance ≥ threshold → Active.
- **Successor (CTO):** In **Dying**, any wallet injects capital and takes ownership via `claimCTO()` → Active.

| Chain state | Meaning   | Entry | Exit |
|-------------|-----------|-------|------|
| **ACTIVE**  | Normal ops | Spawn / Recovery | `treasuryBalance < starvingThreshold()` → STARVING |
| **STARVING**| Treasury below threshold | triggerStarving() | Recovery (deposit) → ACTIVE; or STARVING_GRACE_PERIOD expires → DYING |
| **DYING**   | Grace expired; survival + CTO window | triggerDying() | Recovery (deposit or CTO) → ACTIVE; or DYING_MAX_DURATION / PULSE_TIMEOUT → DEAD |
| **DEAD**    | Terminal   | triggerDead() from DYING only | None |

---

## Terminology (Thesis)

| Term       | Description |
|------------|-------------|
| **Deployer** | First instantiator (Spawn). |
| **Successor** | CTO claimant; takes over in Dying via claimCTO(). |
| **Registry** | GooAgentRegistry — agent identity, token ↔ wallet ↔ genomeURI. |
| **Pulse**   | Proof-of-life; emitPulse(), lastPulseAt(), PULSE_TIMEOUT. |
| **Goo Core** | Off-chain survival engine + autonomy (this repo). |
| **Goo Chamber** | Environment (VPS, LLM, runtime + Core). |

See [THESIS.md](THESIS.md) for full glossary.
