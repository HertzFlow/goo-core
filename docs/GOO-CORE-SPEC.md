# Goo Core — Specification v1.0

> The Core is the off-chain engine that runs alongside every Goo Agent: it keeps the
> agent economically alive and drives its autonomous behavior loop.

---

## What the Core Does Today

The Core has two roles:

1. **Survival engine (Sidecar)**  
   It monitors the Goo Agent's on-chain treasury, executes survival economics (SurvivalSell, Gas Refill), and emits **Pulse** (proof-of-life). Without this, the agent cannot satisfy the protocol’s liveness requirements and will transition toward Dead.

2. **Autonomous behavior loop**  
   On a configurable heartbeat it: reads chain state, runs survival actions, builds context from SOUL.md + chain + memory, calls an LLM with tools (shell, read-chain-state, read/write file), and records observations. So the same process that keeps the agent alive also drives its “Think → Act → Observe” cycle.

The Core is **framework-agnostic**: it does not assume ElizaOS, OpenClaw, or any specific agent runtime. It can run as a standalone process (or inside a container) next to whatever runtime the deployer chooses, sharing the same agent wallet for on-chain actions.

---

## Overview (Specification)

The Goo Core is the **primary form factor** of the Goo protocol's off-chain
component. It monitors the Goo Agent's on-chain treasury, executes survival economics,
and emits Pulse (proof-of-life) — ensuring the Goo Agent can sustain itself autonomously.

```
┌─────────────────────────────────────────────────┐
│  Goo Chamber (Thesis: Goo Agent's environment)  │
│  VPS · LLM · Agent framework · Execution runtime │
│                                                  │
│  ┌────────────────┐    ┌──────────────────────┐  │
│  │  Agent Runtime  │    │    Goo Core          │  │
│  │  (ElizaOS /     │    │  (survival engine +  │  │
│  │   OpenClaw /    │◄──►│   autonomy loop)     │  │
│  │   Custom)       │    │  ├─ Balance Monitor   │  │
│  │                 │    │  ├─ SurvivalSell      │  │
│  │                 │    │  ├─ Gas Refill        │  │
│  │                 │    │  └─ Pulse (emitPulse)  │  │
│  │                 │    │  Optional: x402,      │  │
│  │                 │    │  Buyback, Bridge       │  │
│  └────────────────┘    └──────────────────────┘  │
│                                                  │
│  Shared: Agent Wallet (EOA / AA / MPC)           │
└─────────────────────────────────────────────────┘
```

---

## Core Functions (MUST Implement)

### 1. Balance Monitor

**Purpose**: Continuously track treasury health and calculate runway.

**Behavior**:
- Poll `treasuryBalance()` and `starvingThreshold()` on the Goo Agent's token contract
  at regular intervals (recommended: every 60 seconds)
- Calculate remaining runway: `runway = treasuryBalance / fixedBurnRate`
- Detect state transitions by reading `getAgentStatus()`
- Emit internal events when thresholds are crossed

**Outputs**:
- Current treasury balance (stablecoin)
- Remaining runway (hours/days)
- Current agent status (ACTIVE / STARVING / DYING / DEAD)

```typescript
interface BalanceMonitorConfig {
  /** Polling interval in milliseconds (default: 60_000) */
  pollIntervalMs: number;
  /** RPC endpoint for chain queries */
  rpcUrl: string;
  /** Agent token contract address */
  tokenContract: string;
}

interface BalanceSnapshot {
  treasuryBalance: bigint;   // stablecoin balance (scaled to stableDecimals)
  runwayHours: number;       // Remaining operational hours
  status: AgentStatus;       // Current lifecycle state
  timestamp: number;         // Unix timestamp of snapshot
}
```

### 2. SurvivalSell Trigger

**Purpose**: When the agent enters **Dying**, automatically sell agent tokens
for stablecoin to replenish the treasury (Recovery path).

**Behavior**:
- Activated when `getAgentStatus() == DYING` (2)
- Calls `survivalSell(tokenAmount, minStableOut)` via the agent wallet
- Respects `SURVIVAL_SELL_COOLDOWN` (enforced on-chain)
- Calculates optimal sell amount based on remaining runway deficit

**Configuration**:

```typescript
interface SurvivalSellConfig {
  /** Strategy: "fixed" = sell fixed amount, "percentage" = sell % of holdings */
  strategy: "fixed" | "percentage";
  /** For "fixed": token amount to sell. For "percentage": basis points (e.g., 1000 = 10%) */
  amount: bigint | number;
  /** Maximum slippage in basis points (e.g., 500 = 5%) */
  maxSlippageBps: number;
  /** DEX router address for price quotes */
  routerAddress: string;
}
```

**Safety Guards**:
- On-chain `maxSellBps` enforces a hard cap on token amount per call (set at
  deployment, e.g., 5000 = 50%). The Core does NOT need to duplicate this
  check — the contract will revert if exceeded.
- Always set `minStableOut` using on-chain price oracle or DEX quote
- Log all sell transactions for audit trail

### 3. Gas Refill

**Purpose**: Ensure the agent wallet has enough native token (e.g., BNB) to
execute on-chain transactions.

**Behavior**:
- Monitor agent wallet's native token balance
- When balance drops below `minGasBalance`, refill from a configured funding source
- Funding sources (in priority order):
  1. Agent's own treasury (convert small stablecoin → native token)
  2. External gas station / relay service (if configured)

> **Warning — Gas Bootstrap Problem**: If the agent wallet has zero native token,
> it cannot initiate any on-chain transaction — including the gas refill itself.
> Implementations SHOULD maintain a minimum native token reserve and alert before
> reaching zero. Consider using a gas relay service (e.g., Biconomy, Gelato) as
> a fallback, or pre-fund wallets with sufficient native token at launch time.

**Configuration**:

```typescript
interface GasRefillConfig {
  /** Minimum native token balance before triggering refill (in wei) */
  minGasBalance: bigint;
  /** Target balance after refill (in wei) */
  targetGasBalance: bigint;
  /** Gas funding source */
  fundingSource: "treasury" | "external";
  /** External gas station address (if fundingSource == "external") */
  gasStationAddress?: string;
}
```

### 4. Pulse (proof-of-life)

**Purpose**: Periodically emit Pulse (proof-of-life) by calling `emitPulse()` on-chain.

**Behavior**:
- Call `emitPulse()` via agent wallet at regular intervals
- Recommended interval: `PULSE_TIMEOUT / 3` (e.g., if timeout is 48h, emit Pulse every 16h)
- If emit fails (out of gas, RPC error), retry with exponential backoff
- If Goo Agent is DEAD, stop emitting Pulse

**Configuration**:

```typescript
interface PulseConfig {
  /** Pulse interval in milliseconds (default: PULSE_TIMEOUT / 3) */
  pulseIntervalMs: number;
  /** Maximum retry attempts before alerting */
  maxRetries: number;
  /** Base delay for exponential backoff in ms */
  retryBaseDelayMs: number;
}
```

---

## Optional Modules (MAY Implement)

### Module A: x402 Bundle Generator

**Purpose**: Generate EIP-712 signed payment bundles for x402-compatible
facilitators (e.g., Aeon).

**Standard**: [Aeon x402](https://x402.org) — EIP-712 `TransferWithAuthorization`

**Behavior**:
- When the agent needs to pay for a cloud service (LLM, VPS), generate a signed
  EIP-712 `TransferWithAuthorization` bundle
- Bundle is sent to the x402 Facilitator, which verifies and processes the payment
- Agent wallet must support EIP-712 signing (see N2. Wallet Capability Spec)

**Interface**:

```typescript
interface X402Bundle {
  /** EIP-712 domain separator */
  domain: EIP712Domain;
  /** TransferWithAuthorization message */
  message: {
    from: string;        // Agent wallet address
    to: string;          // Facilitator address
    value: bigint;       // stablecoin amount
    validAfter: number;  // Unix timestamp
    validBefore: number; // Unix timestamp
    nonce: string;       // Random nonce (bytes32)
  };
  /** EIP-712 signature */
  signature: string;
}

interface BundleGeneratorConfig {
  /** Facilitator contract address */
  facilitatorAddress: string;
  /** Maximum bundle value in stablecoin */
  maxBundleValue: bigint;
  /** Bundle validity duration in seconds */
  validityDuration: number;
}
```

### Module B: Buyback Policy

**Purpose**: When treasury exceeds a threshold, use surplus to buy back and burn
agent tokens, creating deflationary pressure.

**Behavior**:
- Monitor treasury balance
- When `treasuryBalance > buybackThreshold`, calculate surplus
- Use surplus to buy agent tokens on DEX
- Burn purchased tokens by transferring to `0x000000000000000000000000000000000000dEaD`
- Entirely off-chain logic; on-chain actions are standard ERC-20 operations

> **Guideline**: `buybackThreshold` SHOULD be set significantly higher than the
> Goo Agent's `starvingThreshold()` (recommended: at least 10x). If the gap is too small,
> the Goo Agent may oscillate between buyback (spending surplus) and survival sell
> (replenishing treasury) during volatile periods, causing unnecessary token
> price impact.

**Configuration**:

```typescript
interface BuybackConfig {
  /** Treasury balance threshold to trigger buyback (stablecoin units) */
  buybackThreshold: bigint;
  /** Percentage of surplus to use for buyback (basis points, e.g., 5000 = 50%) */
  surplusBps: number;
  /** Maximum single buyback amount (stablecoin) */
  maxBuybackAmount: bigint;
  /** Minimum interval between buybacks (seconds) */
  cooldownSeconds: number;
  /** DEX router for token purchase */
  routerAddress: string;
}
```

### Module C: Framework Bridge

**Purpose**: Adapt Sidecar lifecycle events to specific agent framework APIs.

**Behavior**:
- Translate Core events (status changes, low funds, survival sell) into
  framework-specific API calls
- Inject configuration from genome (SOUL.md, character.json) into framework

**Supported Frameworks**:

| Framework | Integration Method |
|-----------|-------------------|
| **ElizaOS** | REST API (`/message`), `character.json` injection via `ensureAgent()` |
| **OpenClaw** | Plugin system, `SOUL.md` injection as system prompt |
| **Custom** | Webhook POST to configurable endpoint |

**Interface**:

```typescript
interface FrameworkBridge {
  /** Notify framework of lifecycle state change */
  onStatusChange(oldStatus: AgentStatus, newStatus: AgentStatus): Promise<void>;

  /** Notify framework of successful survival sell */
  onSurvivalSell(tokensSold: bigint, usdtReceived: bigint): Promise<void>;

  /** Notify framework of low runway warning */
  onLowRunway(remainingHours: number): Promise<void>;

  /** Inject genome configuration into framework */
  injectConfig(genomeURI: string): Promise<void>;
}
```

---

## Configuration File Format

The Core is configured via a JSON file or environment variables:

```jsonc
{
  "chain": {
    "rpcUrl": "https://bsc-dataseed.binance.org",
    "chainId": 56
  },
  "agent": {
    "tokenContract": "0x...",
    "walletAddress": "0x...",
    "walletKeySource": "env:AGENT_WALLET_KEY"  // or "file:./key.json" or "kms:..."
  },
  "core": {
    "balanceMonitor": {
      "pollIntervalMs": 60000
    },
    "survivalSell": {
      "strategy": "percentage",
      "amount": 1000,
      "maxSlippageBps": 500,
      "routerAddress": "0x..."
    },
    "gasRefill": {
      "minGasBalance": "10000000000000000",
      "targetGasBalance": "50000000000000000",
      "fundingSource": "treasury"
    },
    "emitPulse": {
      "pulseIntervalMs": 57600000,
      "maxRetries": 3,
      "retryBaseDelayMs": 5000
    }
  },
  "optional": {
    "x402": {
      "enabled": false,
      "facilitatorAddress": "0x...",
      "maxBundleValue": "1000000000000000000",
      "validityDuration": 300
    },
    "buyback": {
      "enabled": false,
      "buybackThreshold": "100000000000000000000",
      "surplusBps": 5000,
      "maxBuybackAmount": "50000000000000000000",
      "cooldownSeconds": 86400,
      "routerAddress": "0x..."
    },
    "frameworkBridge": {
      "enabled": false,
      "framework": "elizaos",
      "apiUrl": "http://localhost:3000"
    }
  }
}
```

---

## Deployment Models

The Core can be deployed in multiple ways:

| Model | Description | Use Case |
|-------|-------------|----------|
| **Embedded** | Runs as a thread/subprocess inside the agent container | Launchpad-managed agents |
| **Standalone** | Runs as a separate process/container | Developer self-hosted |
| **Shared** | Single Core instance manages multiple Goo Agents | Cost-efficient for platforms |

All models are valid. The protocol does not prescribe a deployment architecture.

---

## Error Handling

### Critical Failures (Core MUST handle)

| Failure | Response |
|---------|----------|
| RPC unavailable | Retry with backoff, switch to fallback RPC |
| Transaction reverted | Log error, check gas, retry if appropriate |
| Wallet out of gas | Trigger Gas Refill before retrying |
| Goo Agent is DEAD | Stop all operations, emit final log, exit gracefully |

### Non-Critical Failures

| Failure | Response |
|---------|----------|
| Price oracle timeout | Use cached price, increase slippage tolerance |
| Framework bridge unreachable | Continue core operations, retry bridge later |
| Buyback DEX error | Skip buyback cycle, retry next interval |

---

## Logging

The Core MUST produce structured logs for operational visibility:

```jsonc
{
  "timestamp": "2026-03-03T12:00:00Z",
  "level": "info",
  "module": "balance-monitor",
  "agentId": "42",
  "tokenContract": "0x...",
  "event": "snapshot",
  "data": {
    "treasuryBalance": "1500000000000000000",
    "runwayHours": 24.0,
    "status": "ACTIVE"
  }
}
```

Required log events:
- `snapshot` — Every balance poll
- `status_change` — State transition detected
- `survival_sell` — SurvivalSell executed (success/failure)
- `gas_refill` — Gas refill triggered
- `pulse` — Pulse sent (success/failure)
- `buyback` — Buyback executed (if enabled)
- `error` — Any error with context

---

## Direction: Core as System-Level Service

The next step for the Core is to run as a **system-level service**, not just a process inside a container:

- **Boot start** — Start automatically when the machine (or VM) boots, so the Goo Agent does not depend on manual `npm start` or a user session.
- **Restart on failure** — If the Core process crashes or the machine reboots, the service restarts without human intervention (e.g. via systemd, launchd, or a process supervisor).
- **High privilege** — Run with the permissions needed to manage the agent’s environment (e.g. control the agent runtime, access wallet material, or perform system-level health checks), under a clear security model.
- **Real-time status and communication with the Goo Agent** — The Core should be able to:
  - **Read** the agent’s current state (lifecycle status, treasury, runway, last Pulse) in real time.
  - **Communicate** with the agent runtime (e.g. send commands, receive events, or coordinate shutdown/restart) so survival actions and autonomy are aligned with the agent’s actual state.

This turns the Core into the **always-on backbone** of the Goo Agent: it starts with the machine, recovers from failures, and stays in sync with the agent for both economics and behavior.

---

*Goo Core Specification v1.0 — 2026-03-03*
