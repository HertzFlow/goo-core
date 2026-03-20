import type { AgentTool, ToolContext } from "../types.js";
import { parseTxInput, serializePreparedTx } from "../finance/tx-utils.js";

export const bscSignAndSendTxTool: AgentTool = {
  definition: {
    name: "bsc_sign_and_send_tx",
    description:
      "Analyze, sign, and broadcast a BSC transaction with the local private key. Blocked transactions are refused.",
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
    if (risk.riskLevel === "blocked") {
      return `Signing refused.\nRisk level: blocked\nReasons:\n- ${risk.reasons.join("\n- ")}`;
    }
    const result = await ctx.agentWallet.signAndSendTransaction(tx);
    return JSON.stringify(
      {
        preparedTx: serializePreparedTx(result.preparedTx),
        signedTransaction: result.signedTransaction,
        txHash: result.txHash,
        riskLevel: risk.riskLevel,
        reasons: risk.reasons,
      },
      null,
      2,
    );
  },
};
