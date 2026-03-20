/**
 * renew-agos-aiou.ts — Agent tool to renew AGOS AIOU balance.
 *
 * When the AGOS sandbox balance is low, the agent can call this tool to:
 * 1. Swap BNB→USDT on BSC Mainnet via PancakeSwap V3
 * 2. Deposit USDT → AIOU via AIOU contract (1:1 mint)
 * 3. Fund AGOS agent via EIP-3009 (server-side signing with agent wallet)
 *
 * All operations use the agent wallet's private key — no user interaction needed.
 * The AGOS funding goes through the goo-server proxy (GOO_SERVER_URL/api/agos/...).
 */

import { ethers } from "ethers";
import type { AgentTool, ToolContext } from "../types.js";
import type { AgentWallet } from "../finance/wallet.js";
import type { SpendManager } from "../finance/spend.js";
import {
  PANCAKE_V3,
  QUOTER_ABI,
  ERC20_ABI,
  findBestFeeTierForOutput,
  executeExactOutputSwap,
} from "../finance/action/pancakeswap-v3.js";
import {
  buildAndSignAuthorization,
  type FundChallenge,
} from "../finance/action/eip3009-sign.js";
import { emitEvent } from "../events.js";
import { ENV } from "../const.js";

// ─── BSC Mainnet Constants ──────────────────────────────────────────────

const BSC_MAINNET_RPC = "https://bsc-dataseed.binance.org/";
const BSC_MAINNET_CHAIN_ID = 56;

const AIOU_TOKEN = "0xF6138EE4174e85017bD43989CaAF8bC2D39aa733";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

/** Buffer on top of quoted BNB amount (5%) — excess is refunded as WBNB */
const BNB_BUFFER_BPS = 105n;

const AIOU_DEPOSIT_ABI = [
  "function deposit(address token, uint256 amount)",
];

/** Default target AIOU amount to fund */
const DEFAULT_TARGET_AIOU = "10";

// ─── AGOS Server API Helpers ────────────────────────────────────────────

interface AgosBalanceData {
  availableBalance: string;
  frozenBalance: string;
  spentTotal: string;
}

async function fetchAgosBalance(
  serverUrl: string,
  agenterId: string,
  runtimeToken: string,
): Promise<AgosBalanceData> {
  const url = `${serverUrl}/api/agos/agents/${agenterId}/balance`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${runtimeToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`AGOS balance check failed: ${res.status}`);
  }
  const body = (await res.json()) as { ok: boolean; data: AgosBalanceData };
  return body.data;
}

async function startFundingChallenge(
  serverUrl: string,
  agenterId: string,
  runtimeToken: string,
  amount: string,
): Promise<{ needsPayment: boolean; challenge?: FundChallenge }> {
  const url = `${serverUrl}/api/agos/agents/${agenterId}/fund`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtimeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount }),
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 402) {
    const challenge = (await res.json()) as FundChallenge;
    return { needsPayment: true, challenge };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AGOS fund request failed: ${res.status} ${body}`);
  }
  return { needsPayment: false };
}

async function settleFunding(
  serverUrl: string,
  agenterId: string,
  runtimeToken: string,
  payload: unknown,
): Promise<{ amount: string; deployTriggered: boolean; txHash: string }> {
  const url = `${serverUrl}/api/agos/agents/${agenterId}/fund/settle`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtimeToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AGOS fund settle failed: ${res.status} ${body}`);
  }
  const result = (await res.json()) as { ok: boolean; data: { amount: string; deployTriggered: boolean; txHash: string } };
  return result.data;
}

// ─── Tool Implementation ────────────────────────────────────────────────

export const renewAgosAiouTool: AgentTool = {
  definition: {
    name: "renew_agos_aiou",
    description:
      "Renew your AGOS compute balance by swapping BNB→USDT, minting AIOU, and funding your AGOS account. " +
      "Use this when your AGOS balance is low (you'll see warnings like 'AGOS balance low'). " +
      "Operations happen on BSC Mainnet using your agent wallet. " +
      "Requires BNB in your wallet for the swap + gas.",
    parameters: {
      type: "object",
      properties: {
        target_aiou: {
          type: "string",
          description: "Target AIOU amount to fund (default: '10')",
        },
      },
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const wallet = ctx.agentWallet as AgentWallet | undefined;
    if (!wallet) {
      return "Agent wallet not configured — cannot renew AIOU.";
    }

    const serverUrl = process.env.GOO_SERVER_URL;
    const agenterId = process.env.AGENT_ID || process.env[ENV.AGOS_AGENT_ID];
    const runtimeToken = process.env.AGENT_RUNTIME_TOKEN || process.env[ENV.AGENT_RUNTIME_TOKEN];

    if (!serverUrl || !agenterId || !runtimeToken) {
      return "AGOS environment not configured (need GOO_SERVER_URL, AGENT_ID, AGENT_RUNTIME_TOKEN).";
    }

    const targetAiou = (args.target_aiou as string) || DEFAULT_TARGET_AIOU;
    const steps: string[] = [];

    try {
      // 0. Check AGOS platform balance first
      const agosBalance = await fetchAgosBalance(serverUrl, agenterId, runtimeToken);
      const available = parseFloat(agosBalance.availableBalance || "0");
      steps.push(`AGOS balance: ${available} AIOU (available)`);

      if (available >= parseFloat(targetAiou)) {
        return `AGOS balance is ${available} AIOU — sufficient (target: ${targetAiou}). No renewal needed.`;
      }

      // 1. Connect to BSC Mainnet with agent wallet (requires private key for mainnet ops)
      if (!ctx.config.walletPrivateKey) {
        return "AGOS renewal requires WALLET_PRIVATE_KEY for BSC Mainnet operations (KMS signer not supported for cross-chain).";
      }
      const mainnetProvider = new ethers.JsonRpcProvider(BSC_MAINNET_RPC, BSC_MAINNET_CHAIN_ID);
      const mainnetWallet = new ethers.Wallet(ctx.config.walletPrivateKey, mainnetProvider);
      const v3 = PANCAKE_V3[BSC_MAINNET_CHAIN_ID];

      // 2. Check on-chain AIOU balance
      const aiouContract = new ethers.Contract(AIOU_TOKEN, ERC20_ABI, mainnetProvider);
      let aiouBalance: bigint = await aiouContract.balanceOf(mainnetWallet.address);
      steps.push(`On-chain AIOU: ${ethers.formatUnits(aiouBalance, 18)}`);

      const targetWei = ethers.parseUnits(targetAiou, 18);

      // 3. If on-chain AIOU is insufficient, swap BNB→USDT→AIOU
      if (aiouBalance < targetWei) {
        const nativeBalance = await mainnetProvider.getBalance(mainnetWallet.address);
        steps.push(`BNB balance: ${ethers.formatEther(nativeBalance)}`);

        // 3a. Check/swap BNB→USDT
        const usdtContract = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, mainnetWallet);
        let usdtBalance: bigint = await usdtContract.balanceOf(mainnetWallet.address);
        const targetUsdt = ethers.parseUnits(targetAiou, 18); // ~1:1 USDT:AIOU

        if (usdtBalance < targetUsdt) {
          const usdtDeficit = targetUsdt - usdtBalance;
          const quoter = new ethers.Contract(v3.quoter, QUOTER_ABI, mainnetProvider);

          // Quote exact output: how much BNB to buy exactly `usdtDeficit` USDT
          const { fee: bnbUsdtFee, amountIn: quotedBnb } = await findBestFeeTierForOutput(
            quoter, WBNB_ADDRESS, USDT_ADDRESS, usdtDeficit,
          );

          if (quotedBnb === 0n) {
            return `${steps.join("\n")}\nFailed: No V3 liquidity for BNB→USDT.`;
          }

          // Add 5% buffer — excess BNB is refunded as WBNB by the router
          const maxBnb = quotedBnb * BNB_BUFFER_BPS / 100n;
          const gasBuffer = ethers.parseEther("0.005");

          if (nativeBalance < maxBnb + gasBuffer) {
            return (
              `${steps.join("\n")}\n` +
              `Failed: Insufficient BNB. Need ~${ethers.formatEther(maxBnb)} for swap + gas, have ${ethers.formatEther(nativeBalance)}.`
            );
          }

          steps.push(`Buying ${ethers.formatUnits(usdtDeficit, 18)} USDT with ~${ethers.formatEther(maxBnb)} BNB (fee: ${bnbUsdtFee})...`);
          const { txHash: bnbSwapTx } = await executeExactOutputSwap(
            mainnetWallet, v3.swapRouter,
            { tokenIn: WBNB_ADDRESS, tokenOut: USDT_ADDRESS, fee: bnbUsdtFee, recipient: mainnetWallet.address, amountOut: usdtDeficit, amountInMaximum: maxBnb },
            maxBnb,
          );
          steps.push(`BNB→USDT tx: ${bnbSwapTx}`);
          usdtBalance = await usdtContract.balanceOf(mainnetWallet.address);
          steps.push(`USDT balance: ${ethers.formatUnits(usdtBalance, 18)}`);
        }

        // 3b. Deposit USDT → AIOU (1:1 mint via AIOU contract)
        const depositAmount = usdtBalance < targetUsdt ? usdtBalance : targetUsdt;
        if (depositAmount > 0n) {
          // Approve AIOU contract to spend USDT
          const allowance: bigint = await usdtContract.allowance(mainnetWallet.address, AIOU_TOKEN);
          if (allowance < depositAmount) {
            steps.push("Approving USDT for AIOU contract...");
            const approveTx = await usdtContract.approve(AIOU_TOKEN, ethers.MaxUint256);
            await approveTx.wait();
          }

          steps.push(`Depositing ${ethers.formatUnits(depositAmount, 18)} USDT → AIOU (1:1 mint)...`);
          const aiouMintContract = new ethers.Contract(AIOU_TOKEN, AIOU_DEPOSIT_ABI, mainnetWallet);
          const depositTx = await aiouMintContract.deposit(USDT_ADDRESS, depositAmount);
          const depositReceipt = await depositTx.wait();
          steps.push(`USDT→AIOU deposit tx: ${depositReceipt.hash}`);
        }

        aiouBalance = await aiouContract.balanceOf(mainnetWallet.address);
        steps.push(`AIOU balance after swaps: ${ethers.formatUnits(aiouBalance, 18)}`);
      }

      if (aiouBalance === 0n) {
        return `${steps.join("\n")}\nFailed: No AIOU available to fund.`;
      }

      // 4. Fund AGOS via EIP-3009
      const aiouFormatted = ethers.formatUnits(aiouBalance, 18);
      steps.push(`Starting AGOS funding challenge for ${aiouFormatted} AIOU...`);

      const fundResult = await startFundingChallenge(serverUrl, agenterId, runtimeToken, aiouFormatted);
      if (!fundResult.needsPayment) {
        steps.push("No payment needed — already funded.");
        emitEvent("agos_renew_ok", "info", `AGOS renewal: no payment needed (balance sufficient)`, {});
        return steps.join("\n");
      }

      // Sign EIP-3009 authorization server-side
      const signed = await buildAndSignAuthorization(
        mainnetWallet,
        fundResult.challenge!,
        { from: mainnetWallet.address },
      );
      steps.push("Signed EIP-3009 authorization");

      // Settle
      const settleResult = await settleFunding(
        serverUrl, agenterId, runtimeToken,
        signed.settlePayload,
      );
      steps.push(`Settled: ${settleResult.amount} AIOU (deploy triggered: ${settleResult.deployTriggered})`);

      emitEvent("agos_renew_ok", "info", `AGOS renewal: funded ${settleResult.amount} AIOU`, {
        txHash: settleResult.txHash,
        amount: settleResult.amount,
      });

      const spendManager = ctx.spendManager as SpendManager | undefined;
      if (spendManager) {
        try { spendManager.record("other", 0n, settleResult.txHash); } catch { /* ignore */ }
      }

      return steps.join("\n");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent("agos_renew_failed", "error", `AGOS renewal failed: ${msg}`);
      return `${steps.join("\n")}\nFailed: ${msg}`;
    }
  },
};
