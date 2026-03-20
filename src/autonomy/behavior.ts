import { ethers } from "ethers";
import {
  AgentStatus,
  type ChainState,
  type RuntimeConfig,
  type Observation,
} from "../types.js";
import type { ChainMonitor, SurvivalManager } from "../survival/index.js";
import { SoulManager } from "./soul.js";
import { ObservationLog } from "./memory.js";
import { emitEvent } from "../events.js";

/**
 * AutonomousBehavior — survival actions + observation recording.
 *
 * LLM reasoning is fully delegated to OpenClaw gateway.
 * On every heartbeat:
 *   1. Read chain state (economic awareness)
 *   2. Execute survival actions (Core: Pulse, survivalSell, gas)
 *   3. Record observation (learning)
 */
export class AutonomousBehavior {
  private soul: SoulManager;
  private memory: ObservationLog;
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

    this.memory = new ObservationLog(config.dataDir);
  }

  /** Initialize: create SOUL.md, load memory */
  async init(): Promise<void> {
    await this.soul.init();
    await this.memory.load();
    this.initialized = true;
    console.log(
      `[autonomy] Initialized. ${this.memory.heartbeatCount} previous heartbeats.`,
    );
  }

  /**
   * Execute one heartbeat cycle.
   *
   * LLM reasoning is delegated to OpenClaw — this only runs survival actions
   * and records the observation.
   *
   * @param state  Current on-chain state
   * @returns      The observation record + survival actions taken
   */
  async onHeartbeat(
    state: ChainState,
  ): Promise<Observation & { survivalActions: string[] }> {
    if (!this.initialized) {
      throw new Error("AutonomousBehavior not initialized — call init() first");
    }

    const heartbeat = this.memory.heartbeatCount + 1;
    const timestamp = new Date().toISOString();

    console.log(
      `[heartbeat #${heartbeat}] Status=${AgentStatus[state.status]}, ` +
        `Treasury=${formatBnb(state.treasuryBalance)} BNB, ` +
        `Runway=${state.runwayHours}h`,
    );

    // Agent is dead — record and return, no actions possible
    if (state.status === AgentStatus.DEAD) {
      emitEvent("agent_dead", "critical", "Goo Agent is Dead. No actions possible.");
      const obs: Observation & { survivalActions: string[] } = {
        heartbeat,
        timestamp,
        status: state.status,
        balanceUsd: parseFloat(
          formatBnb(state.treasuryBalance),
        ),
        runwayHours: 0,
        summary: "Goo Agent is Dead. No actions taken.",
        toolsCalled: [],
        shellCommands: [],
        survivalActions: [],
      };
      await this.memory.record(obs);
      return obs;
    }

    // Execute survival actions (Core responsibility — always runs)
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
      emitEvent("survival_error", "error", msg);
    }

    // Record observation
    const obs: Observation & { survivalActions: string[] } = {
      heartbeat,
      timestamp,
      status: state.status,
      balanceUsd: parseFloat(
        formatBnb(state.treasuryBalance),
      ),
      runwayHours: state.runwayHours,
      summary: survivalActions.join("; ") || "Survival OK",
      toolsCalled: [],
      shellCommands: [],
      survivalActions,
    };

    await this.memory.record(obs);
    return obs;
  }
}

function formatBnb(amount: bigint): string {
  const formatted = ethers.formatEther(amount);
  return parseFloat(formatted).toFixed(4);
}
