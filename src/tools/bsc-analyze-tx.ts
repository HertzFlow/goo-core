import type { AgentTool, ToolContext } from "../types.js";
import { formatTxSummary, parseTxInput } from "../finance/tx-utils.js";

export const bscAnalyzeTxTool: AgentTool = {
  definition: {
    name: "bsc_analyze_tx",
    description:
      "Analyze a BSC transaction for obvious asset-drain patterns before signing or sending it.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        value: { type: "string" },
        data: { type: "string" },
        gasLimit: { type: "string" },
        gasPrice: { type: "string" },
        maxFeePerGas: { type: "string" },
        maxPriorityFeePerGas: { type: "string" },
        nonce: { type: "number" },
        chainId: { type: "number" },
        type: { type: "number" },
      },
      required: ["to"],
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    if (!ctx.agentWallet) return "Agent wallet not configured.";
    const tx = parseTxInput(args);
    const risk = await ctx.agentWallet.analyzeTransaction(tx);
    return [
      "Transaction:",
      formatTxSummary(tx),
      "",
      `Risk level: ${risk.riskLevel}`,
      `Decoded action: ${risk.decodedAction}`,
      risk.selector ? `Selector: ${risk.selector}` : "Selector: none",
      risk.assetSymbol ? `Asset: ${risk.assetSymbol}` : "Asset: unknown",
      "Reasons:",
      ...risk.reasons.map((reason) => `- ${reason}`),
    ].join("\n");
  },
};
