/**
 * payment-token-refill.ts — Ensure agent wallet has enough x402 payment token (USDT)
 *
 * When agent pays for LLM/VPS via x402, it needs USDT in wallet + Permit2 approval.
 * This module:
 * 1. Checks USDT balance
 * 2. If low, swaps BNB→USDT via PancakeSwap V3 (QuoterV2 selects best fee tier)
 * 3. Ensures Permit2 has sufficient allowance
 */

import { ethers } from "ethers";
import type { AgentWallet } from "../wallet.js";
import type { SpendManager } from "../spend.js";
import { PERMIT2_ADDRESS } from "./x402.js";
import { TOKEN_ABI } from "../../const.js";
import {
  PANCAKE_V3,
  QUOTER_ABI,
  SWAP_ROUTER_ABI,
  findBestFeeTier,
} from "./pancakeswap-v3.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface PaymentTokenRefillResult {
  refilled: boolean;
  swapTxHash?: string;
  approveTxHash?: string;
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

/** Minimum USDT balance before triggering a refill (1 AIOU in 18-decimal wei) */
const MIN_PAYMENT_TOKEN_BALANCE = ethers.parseUnits("1", 18);

/** Target USDT balance after refill (10 AIOU in 18-decimal wei) */
const TARGET_PAYMENT_TOKEN_BALANCE = ethers.parseUnits("10", 18);

/** Probe amount for price estimation (0.001 BNB) */
const PROBE_BNB_AMOUNT = ethers.parseEther("0.001");

/** Max uint256 for infinite Permit2 approval */
const MAX_UINT256 = 2n ** 256n - 1n;

// ─── Main ───────────────────────────────────────────────────────────────

/**
 * Check payment token balance and refill via BNB→USDT swap if needed.
 * Uses PancakeSwap V3 with QuoterV2 for optimal fee tier selection.
 * Also ensures Permit2 approval is in place.
 */
export async function ensurePaymentToken(
  wallet: AgentWallet,
  spend?: SpendManager,
): Promise<PaymentTokenRefillResult> {
  if (!wallet.hasPaymentToken) {
    return { refilled: false };
  }

  // 1. Check current USDT balance
  const balance = await wallet.getPaymentTokenBalance();
  if (balance >= MIN_PAYMENT_TOKEN_BALANCE) {
    const allowance = await wallet.getPaymentTokenAllowance(PERMIT2_ADDRESS);
    if (allowance < MIN_PAYMENT_TOKEN_BALANCE) {
      try {
        const approveTxHash = await wallet.approvePaymentToken(PERMIT2_ADDRESS, MAX_UINT256);
        console.log(`[payment-token] Approved Permit2 (tx: ${approveTxHash})`);
        return { refilled: false, approveTxHash };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { refilled: false, error: `Permit2 approve failed: ${msg}` };
      }
    }
    return { refilled: false };
  }

  // 2. Resolve WBNB address from token contract
  let wbnbAddress: string;
  try {
    const tokenContract = new ethers.Contract(
      wallet.tokenAddr,
      TOKEN_ABI,
      wallet.rpcProvider,
    );
    wbnbAddress = await tokenContract.WRAPPED_NATIVE();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { refilled: false, error: `Cannot read WRAPPED_NATIVE: ${msg}` };
  }

  // 3. Resolve PancakeSwap V3 addresses for current chain
  const network = await wallet.rpcProvider.getNetwork();
  const chainId = Number(network.chainId);
  const v3 = PANCAKE_V3[chainId];
  if (!v3) {
    return { refilled: false, error: `PancakeSwap V3 not configured for chain ${chainId}` };
  }

  // 4. Estimate BNB needed to buy target AIOU deficit
  const deficit = TARGET_PAYMENT_TOKEN_BALANCE - balance;
  const quoter = new ethers.Contract(v3.quoter, QUOTER_ABI, wallet.rpcProvider);

  // Probe with small BNB amount to discover price and best fee tier
  const { fee: bestFee, amountOut: probeOut } = await findBestFeeTier(
    quoter,
    wbnbAddress,
    wallet.paymentTokenAddr!,
    PROBE_BNB_AMOUNT,
  );

  if (probeOut === 0n) {
    return { refilled: false, error: "No V3 liquidity found for BNB→USDT across all fee tiers" };
  }

  // Calculate BNB needed: (deficit / probeOut) * PROBE_BNB + 5% buffer for slippage
  const bnbNeeded = (deficit * PROBE_BNB_AMOUNT * 105n) / (probeOut * 100n);

  // 5. Check we have enough BNB (keep 2x for gas headroom)
  const nativeBalance = await wallet.getNativeBalance();
  if (nativeBalance < bnbNeeded * 2n) {
    return {
      refilled: false,
      error: `Insufficient BNB for payment token swap (need ~${ethers.formatEther(bnbNeeded)} BNB for ${ethers.formatUnits(deficit, 18)} AIOU, have ${ethers.formatEther(nativeBalance)})`,
    };
  }

  // 6. Swap BNB→USDT via V3 SwapRouter
  let swapTxHash: string;
  try {
    const swapRouter = new ethers.Contract(v3.swapRouter, SWAP_ROUTER_ABI, wallet.signer);

    // Re-quote with actual bnbNeeded for accurate slippage baseline
    let expectedOut = deficit;
    try {
      const reQuote = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: wbnbAddress,
        tokenOut: wallet.paymentTokenAddr!,
        amountIn: bnbNeeded,
        fee: bestFee,
        sqrtPriceLimitX96: 0n,
      });
      expectedOut = reQuote[0];
    } catch {
      // fallback to deficit estimate
    }
    const amountOutMinimum = expectedOut * 90n / 100n; // 10% slippage tolerance

    const tx = await swapRouter.exactInputSingle(
      {
        tokenIn: wbnbAddress,
        tokenOut: wallet.paymentTokenAddr!,
        fee: bestFee,
        recipient: wallet.address,
        amountIn: bnbNeeded,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
      { value: bnbNeeded },
    );
    const receipt = await tx.wait();
    swapTxHash = receipt.hash;
    console.log(
      `[payment-token] Swapped ${ethers.formatEther(bnbNeeded)} BNB → ~${ethers.formatUnits(deficit, 18)} AIOU via V3 (fee=${bestFee / 100}bps, tx: ${swapTxHash})`,
    );

    if (spend) {
      try { spend.record("other", bnbNeeded, swapTxHash); } catch { /* ignore */ }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { refilled: false, error: `BNB→USDT V3 swap failed: ${msg}` };
  }

  // 7. Ensure Permit2 approval
  let approveTxHash: string | undefined;
  try {
    const allowance = await wallet.getPaymentTokenAllowance(PERMIT2_ADDRESS);
    if (allowance < MIN_PAYMENT_TOKEN_BALANCE) {
      approveTxHash = await wallet.approvePaymentToken(PERMIT2_ADDRESS, MAX_UINT256);
      console.log(`[payment-token] Approved Permit2 (tx: ${approveTxHash})`);
    }
  } catch (err: unknown) {
    console.warn(`[payment-token] Permit2 approve failed (non-fatal): ${(err as Error).message}`);
  }

  return { refilled: true, swapTxHash, approveTxHash };
}
