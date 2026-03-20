/**
 * agos-initial-fund.ts — One-shot BSC Mainnet initial AIOU fund for AGOS agents.
 *
 * Called in index.ts before the heartbeat loop when SANDBOX_PROVIDER=agos.
 * Handles the full flow: check AGOS balance → BNB→USDT swap → USDT→AIOU mint → EIP-3009 fund.
 * All operations use BSC Mainnet with the agent wallet's private key.
 */

import { ethers } from "ethers";
import {
  PANCAKE_V3,
  QUOTER_ABI,
  ERC20_ABI,
  findBestFeeTierForOutput,
  executeExactOutputSwap,
} from "./pancakeswap-v3.js";
import {
  buildAndSignAuthorization,
  type FundChallenge,
} from "./eip3009-sign.js";
import { emitEvent } from "../../events.js";

// ─── BSC Mainnet Constants ──────────────────────────────────────────────

const BSC_MAINNET_RPC = "https://bsc-dataseed.binance.org/";
const BSC_MAINNET_CHAIN_ID = 56;

const AIOU_TOKEN = "0xF6138EE4174e85017bD43989CaAF8bC2D39aa733";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

const AIOU_DEPOSIT_ABI = ["function deposit(address token, uint256 amount)"];

/** Buffer on top of quoted BNB amount (5%) — excess is refunded as WBNB */
const BNB_BUFFER_BPS = 105n;

/** Default target AIOU amount */
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
  const result = (await res.json()) as {
    ok: boolean;
    data: { amount: string; deployTriggered: boolean; txHash: string };
  };
  return result.data;
}

// ─── Result Type ────────────────────────────────────────────────────────

export interface AgosInitialFundResult {
  done: boolean;
  error?: string;
  steps: string[];
}

// ─── Main Class ─────────────────────────────────────────────────────────

export class AgosInitialFund {
  private walletPrivateKey: string;
  private serverUrl: string;
  private agenterId: string;
  private runtimeToken: string;
  private targetAiou: string;

  constructor(opts: {
    walletPrivateKey: string;
    serverUrl: string;
    agenterId: string;
    runtimeToken: string;
    targetAiou?: string;
  }) {
    this.walletPrivateKey = opts.walletPrivateKey;
    this.serverUrl = opts.serverUrl;
    this.agenterId = opts.agenterId;
    this.runtimeToken = opts.runtimeToken;
    this.targetAiou = opts.targetAiou ?? DEFAULT_TARGET_AIOU;
  }

  async execute(): Promise<AgosInitialFundResult> {
    const steps: string[] = [];

    try {
      // 1. Check AGOS platform balance
      const agosBalance = await fetchAgosBalance(
        this.serverUrl,
        this.agenterId,
        this.runtimeToken,
      );
      const available = parseFloat(agosBalance.availableBalance || "0");
      steps.push(`AGOS balance: ${available} AIOU`);

      if (available >= parseFloat(this.targetAiou)) {
        steps.push("Already funded — skipping.");
        return { done: true, steps };
      }

      // 2. Connect to BSC Mainnet
      const mainnetProvider = new ethers.JsonRpcProvider(
        BSC_MAINNET_RPC,
        BSC_MAINNET_CHAIN_ID,
      );
      const mainnetWallet = new ethers.Wallet(
        this.walletPrivateKey,
        mainnetProvider,
      );
      const v3 = PANCAKE_V3[BSC_MAINNET_CHAIN_ID];

      // 3. Check on-chain AIOU balance
      const aiouContract = new ethers.Contract(
        AIOU_TOKEN,
        ERC20_ABI,
        mainnetProvider,
      );
      let aiouBalance: bigint = await aiouContract.balanceOf(
        mainnetWallet.address,
      );
      steps.push(`On-chain AIOU: ${ethers.formatUnits(aiouBalance, 18)}`);

      const targetWei = ethers.parseUnits(this.targetAiou, 18);

      // 4. If on-chain AIOU >= target, skip swap steps
      if (aiouBalance < targetWei) {
        // 4a. Check USDT balance
        const usdtContract = new ethers.Contract(
          USDT_ADDRESS,
          ERC20_ABI,
          mainnetWallet,
        );
        let usdtBalance: bigint = await usdtContract.balanceOf(
          mainnetWallet.address,
        );
        const targetUsdt = ethers.parseUnits(this.targetAiou, 18);
        steps.push(`USDT balance: ${ethers.formatUnits(usdtBalance, 18)}`);

        // 4b. If USDT < target, swap BNB→USDT
        if (usdtBalance < targetUsdt) {
          const nativeBalance = await mainnetProvider.getBalance(
            mainnetWallet.address,
          );
          steps.push(`BNB balance: ${ethers.formatEther(nativeBalance)}`);

          const usdtDeficit = targetUsdt - usdtBalance;
          const quoter = new ethers.Contract(
            v3.quoter,
            QUOTER_ABI,
            mainnetProvider,
          );

          const { fee: bnbUsdtFee, amountIn: quotedBnb } =
            await findBestFeeTierForOutput(
              quoter,
              WBNB_ADDRESS,
              USDT_ADDRESS,
              usdtDeficit,
            );

          if (quotedBnb === 0n) {
            return {
              done: false,
              error: "No V3 liquidity for BNB→USDT",
              steps,
            };
          }

          const maxBnb = (quotedBnb * BNB_BUFFER_BPS) / 100n;
          const gasBuffer = ethers.parseEther("0.005");

          if (nativeBalance < maxBnb + gasBuffer) {
            return {
              done: false,
              error: `Insufficient BNB. Need ~${ethers.formatEther(maxBnb)} for swap + gas, have ${ethers.formatEther(nativeBalance)}`,
              steps,
            };
          }

          steps.push(
            `Buying ${ethers.formatUnits(usdtDeficit, 18)} USDT with ~${ethers.formatEther(maxBnb)} BNB (fee: ${bnbUsdtFee})...`,
          );
          const { txHash: bnbSwapTx } = await executeExactOutputSwap(
            mainnetWallet,
            v3.swapRouter,
            {
              tokenIn: WBNB_ADDRESS,
              tokenOut: USDT_ADDRESS,
              fee: bnbUsdtFee,
              recipient: mainnetWallet.address,
              amountOut: usdtDeficit,
              amountInMaximum: maxBnb,
            },
            maxBnb,
          );
          steps.push(`BNB→USDT tx: ${bnbSwapTx}`);

          usdtBalance = await usdtContract.balanceOf(mainnetWallet.address);
          steps.push(
            `USDT balance after swap: ${ethers.formatUnits(usdtBalance, 18)}`,
          );
        }

        // 4c. Deposit USDT → AIOU (1:1 mint)
        const depositAmount =
          usdtBalance < targetUsdt ? usdtBalance : targetUsdt;
        if (depositAmount > 0n) {
          const usdtContract = new ethers.Contract(
            USDT_ADDRESS,
            ERC20_ABI,
            mainnetWallet,
          );
          const allowance: bigint = await usdtContract.allowance(
            mainnetWallet.address,
            AIOU_TOKEN,
          );
          if (allowance < depositAmount) {
            steps.push("Approving USDT for AIOU contract...");
            const approveTx = await usdtContract.approve(
              AIOU_TOKEN,
              ethers.MaxUint256,
            );
            await approveTx.wait();
          }

          steps.push(
            `Depositing ${ethers.formatUnits(depositAmount, 18)} USDT → AIOU (1:1 mint)...`,
          );
          const aiouMintContract = new ethers.Contract(
            AIOU_TOKEN,
            AIOU_DEPOSIT_ABI,
            mainnetWallet,
          );
          const depositTx = await aiouMintContract.deposit(USDT_ADDRESS, depositAmount);
          const depositReceipt = await depositTx.wait();
          steps.push(`USDT→AIOU deposit tx: ${depositReceipt.hash}`);
        }

        aiouBalance = await aiouContract.balanceOf(mainnetWallet.address);
        steps.push(
          `AIOU balance after swaps: ${ethers.formatUnits(aiouBalance, 18)}`,
        );
      }

      if (aiouBalance === 0n) {
        return { done: false, error: "No AIOU available to fund", steps };
      }

      // 5. Fund AGOS via EIP-3009
      const aiouFormatted = ethers.formatUnits(aiouBalance, 18);
      steps.push(
        `Starting AGOS funding challenge for ${aiouFormatted} AIOU...`,
      );

      const fundResult = await startFundingChallenge(
        this.serverUrl,
        this.agenterId,
        this.runtimeToken,
        aiouFormatted,
      );

      if (!fundResult.needsPayment) {
        steps.push("No payment needed — already funded.");
        emitEvent(
          "agos_initial_fund_ok",
          "info",
          "AGOS initial fund: no payment needed",
          {},
        );
        return { done: true, steps };
      }

      // Sign EIP-3009 authorization
      const signed = await buildAndSignAuthorization(
        mainnetWallet,
        fundResult.challenge!,
        { from: mainnetWallet.address },
      );
      steps.push("Signed EIP-3009 authorization");

      // Settle
      const settleResult = await settleFunding(
        this.serverUrl,
        this.agenterId,
        this.runtimeToken,
        signed.settlePayload,
      );
      steps.push(
        `Settled: ${settleResult.amount} AIOU (deploy triggered: ${settleResult.deployTriggered})`,
      );

      emitEvent(
        "agos_initial_fund_ok",
        "info",
        `AGOS initial fund: ${settleResult.amount} AIOU`,
        { txHash: settleResult.txHash, amount: settleResult.amount },
      );

      return { done: true, steps };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      emitEvent("agos_initial_fund_failed", "error", msg);
      return { done: false, error: msg, steps };
    }
  }
}
