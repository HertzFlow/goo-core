import { ethers } from "ethers";
import type { AgentTool, ToolContext } from "../types.js";

export const bscSendTxTool: AgentTool = {
  definition: {
    name: "bsc_send_tx",
    description:
      "Broadcast a previously signed BSC transaction. The transaction is re-analyzed before sending.",
    parameters: {
      type: "object",
      properties: {
        signedTransaction: {
          type: "string",
          description: "The raw signed transaction hex",
        },
      },
      required: ["signedTransaction"],
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    if (!ctx.agentWallet) return "Agent wallet not configured.";
    const signedTransaction = args.signedTransaction;
    if (typeof signedTransaction !== "string" || !signedTransaction.startsWith("0x")) {
      return "signedTransaction must be a raw hex string.";
    }

    const tx = ethers.Transaction.from(signedTransaction);
    const risk = await ctx.agentWallet.analyzeTransaction({
      to: tx.to ?? ethers.ZeroAddress,
      value: tx.value ?? undefined,
      data: tx.data,
      gasLimit: tx.gasLimit ?? undefined,
      gasPrice: tx.gasPrice ?? undefined,
      maxFeePerGas: tx.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? undefined,
      nonce: tx.nonce,
      chainId: tx.chainId ? Number(tx.chainId) : ctx.config.chainId,
      type: tx.type ?? undefined,
    });
    if (risk.riskLevel === "blocked") {
      return `Broadcast refused.\nRisk level: blocked\nReasons:\n- ${risk.reasons.join("\n- ")}`;
    }

    const txHash = await ctx.agentWallet.broadcastSignedTransaction(signedTransaction);
    return JSON.stringify({ txHash, riskLevel: risk.riskLevel, reasons: risk.reasons }, null, 2);
  },
};
