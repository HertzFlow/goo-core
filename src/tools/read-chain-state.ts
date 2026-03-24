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
    const treasuryBnb = formatBnb(s.treasuryBalance);
    const thresholdBnb = formatBnb(s.starvingThreshold);
    const dyingThresholdBnb = formatBnb(s.dyingThreshold);

    const lines = [
      `Status: ${statusName}`,
      `Treasury Balance: ${treasuryBnb} BNB`,
      `Starving Threshold: ${thresholdBnb} BNB`,
      `Dying Threshold: ${dyingThresholdBnb} BNB`,
      `Native Balance: ${ethers.formatEther(s.nativeBalance)} BNB (wallet)`,
      `Token Holdings: ${ethers.formatEther(s.tokenHoldings)} tokens`,
      `Total Supply: ${ethers.formatEther(s.totalSupply)} tokens`,
      `Last Pulse: ${new Date(Number(s.lastPulseAt) * 1000).toISOString()}`,
      `Owner: ${s.owner}`,
      `Paused: ${s.paused}`,
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

function formatBnb(amount: bigint): string {
  const formatted = ethers.formatEther(amount);
  return parseFloat(formatted).toFixed(4);
}
