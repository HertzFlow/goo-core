import { ethers } from "ethers";
import { AgentStatus, type ChainState, type RuntimeConfig } from "../types.js";
import type { LivenessPayload } from "../types.js";

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
    runwayHours: 0,
    tokenAddress: config.tokenAddress,
    chainId: config.chainId,
    timestamp: new Date().toISOString(),
  };
}
