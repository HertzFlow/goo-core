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
  treasuryBalance: bigint; // stablecoin balance (raw)
  starvingThreshold: bigint; // minimum balance before Starving
  fixedBurnRate: bigint; // daily burn in stablecoin units
  minRunwayHours: bigint;
  nativeBalance: bigint; // BNB/ETH balance of agent wallet
  tokenHoldings: bigint; // agent token balance of contract
  totalSupply: bigint;
  lastPulseAt: bigint; // unix timestamp (last Pulse / proof-of-life)
  starvingEnteredAt: bigint;
  dyingEnteredAt: bigint;
  // Derived
  runwayHours: number; // treasuryBalance / (fixedBurnRate / 24)
  stableDecimals: number;
}

// ─── Runtime Configuration ──────────────────────────────────────────────

export interface RuntimeConfig {
  // Chain connection
  rpcUrl: string;
  chainId: number;
  tokenAddress: string;
  walletPrivateKey: string;

  // LLM
  llmApiUrl: string; // OpenAI-compatible endpoint
  llmApiKey: string;
  llmModel: string; // e.g. "deepseek/deepseek-chat"
  llmMaxTokens: number;
  llmTimeoutMs: number;

  // Runtime behavior
  heartbeatIntervalMs: number; // default: 30_000 (30s)
  maxToolRoundsPerHeartbeat: number; // default: 5
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
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

// ─── LLM Types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface LLMResult {
  response: string;
  toolsUsed: string[];
  shellCommands: string[]; // actual shell_execute commands for grounding
  rounds: number;
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
