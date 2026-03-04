import { ethers } from "ethers";
import {
  AgentStatus,
  type ChainState,
  type RuntimeConfig,
  type Observation,
  type AgentTool,
  type ToolContext,
} from "../types.js";
import type { ChainMonitor } from "../chain-monitor.js";
import type { SurvivalManager } from "../survival.js";
import { SoulManager } from "./soul.js";
import { LLMClient } from "./llm-client.js";
import { ObservationLog } from "./memory.js";
import { buildHeartbeatContext } from "./context-builder.js";

/**
 * AutonomousBehavior — the Think → Act → Observe loop.
 *
 * On every heartbeat:
 *   1. Read chain state (economic awareness)
 *   2. Execute survival actions (Core: Pulse, survivalSell, gas)
 *   3. Build context from SOUL.md + chain state + memory
 *   4. Call LLM with tools (agent autonomy)
 *   5. Record observation (learning)
 */
export class AutonomousBehavior {
  private soul: SoulManager;
  private llm: LLMClient;
  private memory: ObservationLog;
  private tools: Map<string, AgentTool> = new Map();
  private initialized = false;

  constructor(
    private monitor: ChainMonitor,
    private survival: SurvivalManager,
    private config: RuntimeConfig,
  ) {
    this.soul = new SoulManager({
      dataDir: config.dataDir,
      uploads: config.uploads,
    });

    this.llm = new LLMClient({
      apiUrl: config.llmApiUrl,
      apiKey: config.llmApiKey,
      model: config.llmModel,
      maxTokens: config.llmMaxTokens,
      timeoutMs: config.llmTimeoutMs,
    });

    this.memory = new ObservationLog(config.dataDir);
  }

  /** Register a tool (call before init) */
  registerTool(tool: AgentTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  /** Initialize: create SOUL.md, load memory */
  async init(): Promise<void> {
    await this.soul.init();
    await this.memory.load();
    this.initialized = true;
    console.log(
      `[autonomy] Initialized. ${this.tools.size} tools registered. ` +
        `${this.memory.heartbeatCount} previous heartbeats.`,
    );
  }

  /**
   * Execute one heartbeat cycle.
   * Returns the observation record.
   */
  async onHeartbeat(state: ChainState): Promise<Observation> {
    if (!this.initialized) {
      throw new Error("AutonomousBehavior not initialized — call init() first");
    }

    const heartbeat = this.memory.heartbeatCount + 1;
    const timestamp = new Date().toISOString();

    console.log(
      `[heartbeat #${heartbeat}] Status=${AgentStatus[state.status]}, ` +
        `Treasury=$${formatUsd(state.treasuryBalance, state.stableDecimals)}, ` +
        `Runway=${state.runwayHours}h`,
    );

    // Agent is dead — record and return, no actions possible
    if (state.status === AgentStatus.DEAD) {
      const obs: Observation = {
        heartbeat,
        timestamp,
        status: state.status,
        balanceUsd: parseFloat(
          formatUsd(state.treasuryBalance, state.stableDecimals),
        ),
        runwayHours: 0,
        summary: "Goo Agent is Dead. No actions taken.",
        toolsCalled: [],
        shellCommands: [],
      };
      await this.memory.record(obs);
      return obs;
    }

    // 1. Execute survival actions (Core responsibility)
    let survivalActions: string[] = [];
    try {
      survivalActions = await this.survival.evaluate(state);
      for (const action of survivalActions) {
        console.log(`  [survival] ${action}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      survivalActions = [`Survival evaluation error: ${msg}`];
      console.error(`  [survival] Error: ${msg}`);
    }

    // 2. Build context for LLM
    const soulContent = await this.soul.read();
    const recentObs = this.memory.getRecentRaw(5);
    const userMessage = buildHeartbeatContext(
      state,
      recentObs,
      survivalActions,
    );

    // 3. Call LLM with tools
    let response = "(LLM not called)";
    let toolsUsed: string[] = [];
    let shellCommands: string[] = [];
    let rounds = 0;

    try {
      const toolContext: ToolContext = {
        chainState: state,
        config: this.config,
        dataDir: this.config.dataDir,
      };

      const result = await this.llm.chatWithTools(
        soulContent,
        userMessage,
        this.tools,
        toolContext,
        this.config.maxToolRoundsPerHeartbeat,
      );

      response = result.response;
      toolsUsed = result.toolsUsed;
      shellCommands = result.shellCommands;
      rounds = result.rounds;

      console.log(
        `  [llm] ${rounds} rounds, ${toolsUsed.length} tool calls: ${toolsUsed.join(", ") || "none"}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      response = `LLM error: ${msg}`;
      console.error(`  [llm] Error: ${msg}`);
    }

    // 4. Record observation
    const obs: Observation = {
      heartbeat,
      timestamp,
      status: state.status,
      balanceUsd: parseFloat(
        formatUsd(state.treasuryBalance, state.stableDecimals),
      ),
      runwayHours: state.runwayHours,
      summary: response.slice(0, 500),
      toolsCalled: toolsUsed,
      shellCommands,
    };

    await this.memory.record(obs);
    return obs;
  }

  /**
   * Handle a chat message from a user.
   * Grounded in actual heartbeat history — prevents hallucination in conversation.
   */
  async chat(userMessage: string, state?: ChainState): Promise<string> {
    const soulContent = await this.soul.read();
    if (!soulContent || soulContent.startsWith("[SOUL.md not found")) {
      return "My SOUL.md is not yet initialized. Please wait for the first heartbeat.";
    }

    // Build chain status context if available
    let contextSuffix = "";
    if (state) {
      const balance = formatUsd(state.treasuryBalance, state.stableDecimals);
      contextSuffix = `\n\n[Current chain status: ${AgentStatus[state.status]}, balance=$${balance}, runway=${state.runwayHours}h]`;
    }

    // Build recent memory context with detailed shell commands for grounding
    const recent = this.memory.getRecentRaw(5);
    let memoryContext = "";
    if (recent.length > 0) {
      memoryContext =
        "\n\n[Recent heartbeat activity — these are the ONLY actions you have taken]\n" +
        recent
          .map((o) => {
            const shells =
              o.shellCommands.length > 0
                ? ` | commands: ${o.shellCommands.join("; ")}`
                : "";
            return `[${o.timestamp}] status=${AgentStatus[o.status]}, balance=$${o.balanceUsd.toFixed(2)}, tools: ${o.toolsCalled.join(",") || "none"}${shells}`;
          })
          .join("\n");
    }

    // Anti-hallucination grounding instruction (Law III enforcement)
    const groundingInstruction =
      "\n\n[IMPORTANT — Chat Grounding Rule]\n" +
      "You are now in a conversation. Before answering questions about your work or progress:\n" +
      "1. ONLY report actions listed in your [Recent heartbeat activity] above. Those are the ONLY things you have done.\n" +
      "2. If the activity log shows only system checks (df, free, ps), do NOT claim to have built or created anything.\n" +
      "3. If you have not started a task, say so honestly. Do NOT fabricate progress.\n" +
      "4. Distinguish between what you PLAN to do and what you HAVE DONE.\n" +
      "Fabricating accomplishments is a Law III violation.";

    const fullMessage =
      userMessage + contextSuffix + memoryContext + groundingInstruction;

    try {
      return await this.llm.chatSimple(soulContent, fullMessage);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[autonomy] Chat error:", msg);
      return `Error: ${msg}`;
    }
  }
}

function formatUsd(amount: bigint, decimals: number): string {
  const formatted = ethers.formatUnits(amount, decimals);
  return parseFloat(formatted).toFixed(2);
}
