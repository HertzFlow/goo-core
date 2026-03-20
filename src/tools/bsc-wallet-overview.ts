import { ethers } from "ethers";
import type { AgentTool, ToolContext } from "../types.js";

export const bscWalletOverviewTool: AgentTool = {
  definition: {
    name: "bsc_wallet_overview",
    description:
      "Read your BSC wallet address, pending nonce, native BNB balance, and optional token balances. " +
      "Use this before signing transactions.",
    parameters: {
      type: "object",
      properties: {
        tokens: {
          type: "array",
          items: { type: "string" },
          description: "Optional ERC-20 token addresses to inspect",
        },
      },
    },
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    if (!ctx.agentWallet) return "Agent wallet not configured.";

    const wallet = ctx.agentWallet;
    const nonce = await wallet.getNonce();
    const nativeBalance = await wallet.getNativeBalance();
    const tokens = Array.isArray(args.tokens) ? args.tokens.filter((t): t is string => typeof t === "string") : [];

    const lines = [
      `Address: ${wallet.address}`,
      `Chain ID: ${ctx.config.chainId}`,
      `Pending nonce: ${nonce}`,
      `BNB balance: ${ethers.formatEther(nativeBalance)}`,
      `Min reserve: ${wallet.minWalletBnb} BNB`,
    ];

    for (const token of tokens) {
      if (!ethers.isAddress(token)) {
        lines.push(`Token ${token}: invalid address`);
        continue;
      }
      const [symbol, decimals, balance] = await Promise.all([
        wallet.getTokenSymbol(token),
        wallet.getTokenDecimals(token),
        wallet.getTokenBalanceFor(token),
      ]);
      lines.push(`Token ${symbol} (${ethers.getAddress(token)}): ${ethers.formatUnits(balance, decimals)}`);
    }

    return lines.join("\n");
  },
};
