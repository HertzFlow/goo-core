import type { AgentWallet } from "./finance/wallet.js";
import type { SpendManager } from "./finance/spend.js";

// ─── Agent Status (mirrors on-chain enum) ───────────────────────────────

export enum AgentStatus {
  ACTIVE = 0,
  STARVING = 1, // Treasury below threshold
  DYING = 2, // Grace period expired; Recovery via deposit or Successor/CTO
  DEAD = 3, // Dead — terminal (no Recovery)
}

// ─── On-Chain State Snapshot ─────────────────────────────────────────────

export interface ChainState {
  status: AgentStatus;
  treasuryBalance: bigint; // BNB balance (wei) — contract + wallet
  starvingThreshold: bigint; // minimum balance before Starving (wei) — 0.015 BNB constant
  dyingThreshold: bigint; // deprecated (always 0), kept for backward compat
  nativeBalance: bigint; // BNB balance of agent wallet (wei)
  tokenHoldings: bigint; // agent token balance of contract
  totalSupply: bigint;
  lastPulseAt: bigint; // unix timestamp (last Pulse / proof-of-life)
  starvingEnteredAt: bigint;
  dyingEnteredAt: bigint;
  owner: string; // owner address (admin/economic role)
  paused: boolean; // whether the contract is paused
}

// ─── Runtime Configuration ──────────────────────────────────────────────

export interface RuntimeConfig {
  // Chain connection
  rpcUrl: string;
  chainId: number;
  tokenAddress: string;
  walletPrivateKeyFile?: string;
  walletPrivateKey?: string;

  // LLM (informational — actual calls delegated to OpenClaw)
  llmModel: string;

  // Runtime behavior
  heartbeatIntervalMs: number; // default: 30_000 (30s)
  dataDir: string; // persistent data directory

  // Deployer uploads (file paths or content)
  uploads: {
    soul?: string; // soul.md content
    agent?: string; // agent.md content
    skills?: string; // skills.md content
    memory?: string; // memory.md content
  };

  // Survival thresholds
  minGasBalance: bigint; // below this: refill gas
  gasRefillAmount: bigint; // how much to refill
  minWalletBnb: number; // minimum BNB in wallet for operations (default: 0.01)

  // x402 payment token (USDT address — agent swaps BNB→USDT for LLM/VPS payments)
  x402PaymentToken?: string;

  // OpenClaw gateway (push heartbeat summaries to UI)
  openclawGatewayUrl?: string; // e.g. "http://127.0.0.1:19789"
  openclawGatewayToken?: string;

  // Optional: buyback
  buyback?: {
    enabled: boolean;
    thresholdMultiplier: number; // e.g. 10 = buyback when treasury > 10x starvingThreshold
    burnAddress: string; // default: 0x000...dead
  };
}

// ─── Tool Interface ─────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolContext {
  chainState: ChainState;
  config: RuntimeConfig;
  dataDir: string;
  workspaceDir: string;
  agentWallet?: AgentWallet;
  spendManager?: SpendManager;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

// ─── Observation (memory entry) ─────────────────────────────────────────

export interface Observation {
  heartbeat: number;
  timestamp: string;
  status: AgentStatus;
  balanceUsd: number;
  runwayHours: number;
  summary: string;
  toolsCalled: string[];
  shellCommands: string[];
}

// ─── Events ─────────────────────────────────────────────────────────────

export interface RuntimeEvent {
  type:
    | "heartbeat_start"
    | "tool_call"
    | "heartbeat_end"
    | "survival_action"
    | "error";
  heartbeat: number;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Liveness & Inspection (Goo Agent proof / public API) ────────────────

/** Payload for GET /liveness — proves agent is alive and is a Goo Agent. */
export interface LivenessPayload {
  /** Protocol identifier */
  protocol: "goo";
  /** Current lifecycle status (ACTIVE / STARVING / DYING / DEAD) */
  status: string;
  /** Unix timestamp of last emitPulse() */
  lastPulseAt: number;
  /** Treasury balance (human-readable) */
  treasuryBalanceUsd: string;
  /** Estimated runway in hours */
  runwayHours: number;
  /** Token contract address */
  tokenAddress: string;
  /** Chain ID */
  chainId: number;
  /** When this payload was generated (ISO string) */
  timestamp: string;
}
