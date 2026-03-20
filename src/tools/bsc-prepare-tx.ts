import type { AgentTool, ToolContext } from "../types.js";
import { formatTxSummary, parseTxInput, serializePreparedTx } from "../finance/tx-utils.js";

export const bscPrepareTxTool: AgentTool = {
  definition: {
    name: "bsc_prepare_tx",
    description:
      "Normalize a BSC transaction by filling nonce, chainId, gas, and fee fields before signing.",
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
    const prepared = await ctx.agentWallet.prepareTransaction(parseTxInput(args));
    return `Prepared transaction:\n${formatTxSummary(prepared)}\n\nJSON:\n${JSON.stringify(serializePreparedTx(prepared), null, 2)}`;
  },
};
