import { ethers } from "ethers";
import type { AgentTool, ToolContext } from "../types.js";
import type { AgentWallet } from "../finance/wallet.js";
import type { SpendManager } from "../finance/spend.js";
import { ensurePaymentToken } from "../finance/action/payment-token-refill.js";

export const refillPaymentTokenTool: AgentTool = {
  definition: {
    name: "refill_payment_token",
    description:
      "Check your AIOU (USDT) balance and auto-refill by swapping BNB→USDT if below 1 AIOU. " +
      "Targets ~10 AIOU per refill. Use this when you notice your AIOU balance is low " +
      "or before making x402 payments. Returns current balance and refill result.",
    parameters: {
      type: "object",
      properties: {},
    },
  },

  async execute(
    _args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const wallet = ctx.agentWallet as AgentWallet | undefined;
    if (!wallet?.hasPaymentToken) {
      return "No payment token configured — x402 payments not enabled.";
    }

    const balance = await wallet.getPaymentTokenBalance();
    const balanceFormatted = ethers.formatUnits(balance, 18);

    const result = await ensurePaymentToken(
      wallet,
      ctx.spendManager as SpendManager | undefined,
    );

    if (result.refilled) {
      const newBalance = await wallet.getPaymentTokenBalance();
      return (
        `Refilled AIOU: swapped BNB→USDT (tx: ${result.swapTxHash}). ` +
        `Balance: ${balanceFormatted} → ${ethers.formatUnits(newBalance, 18)} AIOU.`
      );
    }

    if (result.error) {
      return `AIOU balance: ${balanceFormatted}. Refill skipped: ${result.error}`;
    }

    if (result.approveTxHash) {
      return `AIOU balance: ${balanceFormatted} (sufficient). Permit2 approved (tx: ${result.approveTxHash}).`;
    }

    return `AIOU balance: ${balanceFormatted} (sufficient, no refill needed).`;
  },
};
