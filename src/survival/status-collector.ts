import { ethers } from "ethers";
import { AgentStatus, type ChainState, type RuntimeConfig } from "../types.js";
import type { LivenessPayload, AgentInspectionPayload } from "../types.js";
import type { ChainMonitor } from "./chain-monitor.js";

/**
 * Build liveness payload from current chain state (for GET /liveness).
 * Proves the agent is a Goo Agent and current proof-of-life.
 */
export function buildLivenessPayload(
  state: ChainState,
  config: Pick<RuntimeConfig, "tokenAddress" | "chainId">
): LivenessPayload {
  const treasuryUsd = ethers.formatEther(state.treasuryBalance);
  return {
    protocol: "goo",
    status: AgentStatus[state.status],
    lastPulseAt: Number(state.lastPulseAt),
    treasuryBalanceUsd: treasuryUsd,
    runwayHours: state.runwayHours,
    tokenAddress: config.tokenAddress,
    chainId: config.chainId,
    timestamp: new Date().toISOString(),
  };
}

export interface CollectInspectionInput {
  chainState: ChainState;
  survivalActions: string[];
  config: RuntimeConfig;
  threeLaws: string;
  monitor: ChainMonitor;
}

/**
 * Collect full agent status for internal use and for public GET /inspect.
 * Includes: survival state, chain state, token state, LLM config, Three Laws.
 */
export function collectAgentInspection(input: CollectInspectionInput): AgentInspectionPayload {
  const { chainState, survivalActions, config, threeLaws, monitor } = input;
  const liveness = buildLivenessPayload(chainState, config);
  const gasWarning = chainState.nativeBalance < config.minGasBalance;

  return {
    protocol: "goo",
    timestamp: new Date().toISOString(),
    liveness,
    chain: {
      status: AgentStatus[chainState.status],
      treasuryBalance: ethers.formatEther(chainState.treasuryBalance),
      starvingThreshold: ethers.formatEther(chainState.starvingThreshold),
      fixedBurnRate: ethers.formatEther(chainState.fixedBurnRate),
      nativeBalance: ethers.formatEther(chainState.nativeBalance),
      tokenHoldings: ethers.formatEther(chainState.tokenHoldings),
      totalSupply: ethers.formatEther(chainState.totalSupply),
      runwayHours: chainState.runwayHours,
      lastPulseAt: Number(chainState.lastPulseAt),
      starvingEnteredAt: Number(chainState.starvingEnteredAt),
      dyingEnteredAt: Number(chainState.dyingEnteredAt),
    },
    survival: {
      lastActions: survivalActions,
      gasWarning,
    },
    token: {
      address: config.tokenAddress,
      holdings: ethers.formatEther(chainState.tokenHoldings),
      totalSupply: ethers.formatEther(chainState.totalSupply),
    },
    llm: {
      model: config.llmModel,
      apiUrl: config.llmApiUrl,
      configured: Boolean(config.llmApiKey),
    },
    threeLaws,
  };
}
