import { ethers } from "ethers";
import { AgentStatus, type AgentTool, type ToolContext } from "../types.js";

export const readChainStateTool: AgentTool = {
  definition: {
    name: "read_chain_state",
    description:
      "Read your on-chain economic status from the smart contract. " +
      "Returns: status, treasury balance, runway, burn rate, " +
      "native token balance, token holdings. " +
      "All values are FACTS from the blockchain — never fabricate these.",
    parameters: {
      type: "object",
      properties: {},
    },
  },

  async execute(
    _args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<string> {
    const s = ctx.chainState;
    const statusName = AgentStatus[s.status];
    const balanceUsd = formatUsd(s.treasuryBalance, s.stableDecimals);
    const thresholdUsd = formatUsd(s.starvingThreshold, s.stableDecimals);
    const burnUsd = formatUsd(s.fixedBurnRate, s.stableDecimals);

    const lines = [
      `Status: ${statusName}`,
      `Treasury Balance: $${balanceUsd}`,
      `Starving threshold: $${thresholdUsd}`,
      `Daily Burn Rate: $${burnUsd}/day`,
      `Estimated Runway: ${s.runwayHours} hours (~${Math.floor(s.runwayHours / 24)} days)`,
      `Native Balance: ${ethers.formatEther(s.nativeBalance)} (for gas)`,
      `Token Holdings: ${ethers.formatEther(s.tokenHoldings)} tokens`,
      `Total Supply: ${ethers.formatEther(s.totalSupply)} tokens`,
      `Last Pulse: ${new Date(Number(s.lastPulseAt) * 1000).toISOString()}`,
    ];

    if (s.starvingEnteredAt > 0n) {
      lines.push(`Starving entered: ${new Date(Number(s.starvingEnteredAt) * 1000).toISOString()}`);
    }
    if (s.dyingEnteredAt > 0n) {
      lines.push(`Dying entered: ${new Date(Number(s.dyingEnteredAt) * 1000).toISOString()}`);
    }

    return lines.join("\n");
  },
};

function formatUsd(amount: bigint, decimals: number): string {
  const formatted = ethers.formatUnits(amount, decimals);
  return parseFloat(formatted).toFixed(2);
}
