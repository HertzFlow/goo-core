/**
 * buyback.ts — Buy back agent's own token using BNB via DEX router.
 *
 * Uses the agent wallet's native BNB to swap for the agent's token through
 * the same DEX router referenced by the token contract. Uses the FoT-supporting
 * swap variant because GooAgentToken has a 1% transfer fee.
 */

import { ethers } from "ethers";
import type { AgentWallet } from "../wallet.js";
import type { SpendManager } from "../spend.js";
import { TOKEN_ABI } from "../../const.js";
import { emitEvent } from "../../events.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface BuybackParams {
  /** BNB amount for buyback (wei) */
  amountIn: bigint;
  /** Minimum acceptable agent token output (slippage protection, 0 = no check) */
  amountOutMin?: bigint;
  /** Optional: deadline in seconds from now (default 300) */
  deadlineSeconds?: number;
}

export interface BuybackResult {
  success: boolean;
  txHash?: string;
  /** Actual token amount received (measured via balance diff) */
  amountOut?: bigint;
  error?: string;
}

// ─── Router ABI (PancakeSwap V2 compatible) ─────────────────────────────

const SWAP_EXECUTOR_ABI = [
  "function router() view returns (address)",
  "function wrappedNative() view returns (address)",
];

const ROUTER_ABI = [
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  "function WETH() view returns (address)",
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
];

// ─── Handlers ───────────────────────────────────────────────────────────

/**
 * Execute a BNB → AgentToken buyback via the DEX router.
 *
 * 1. Read swapExecutor from token → read router + wrappedNative from executor
 * 2. Check native balance ≥ amountIn * 2 (gas buffer)
 * 3. Swap BNB → AgentToken using FoT-supporting variant
 * 4. Measure actual output via balance diff (accounts for 1% FoT)
 * 5. Record spend
 */
export async function executeBuyback(
  wallet: AgentWallet,
  params: BuybackParams,
  spend?: SpendManager,
): Promise<BuybackResult> {
  const { amountIn, amountOutMin = 0n, deadlineSeconds = 300 } = params;

  // 1. Read router address via swapExecutor on the token contract
  let routerAddress: string;
  let wethAddress: string;
  try {
    const tokenContract = new ethers.Contract(
      wallet.tokenAddr,
      TOKEN_ABI,
      wallet.rpcProvider,
    );
    const executorAddr: string = await tokenContract.swapExecutor();
    const executor = new ethers.Contract(executorAddr, SWAP_EXECUTOR_ABI, wallet.rpcProvider);
    routerAddress = await executor.router();
    wethAddress = await executor.wrappedNative();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitEvent("buyback_failed", "error", `Cannot read router: ${msg}`);
    return { success: false, error: `Cannot read router: ${msg}` };
  }

  // 2. Check we have enough BNB (amountIn + gas buffer)
  const nativeBalance = await wallet.getNativeBalance();
  if (nativeBalance < amountIn * 2n) {
    emitEvent("buyback_failed", "warn", "Insufficient BNB for buyback (need 2x for gas buffer)");
    return { success: false, error: "Insufficient BNB for buyback (need 2x for gas buffer)" };
  }

  // 3. Record token balance before swap
  const tokenBalanceBefore = await wallet.getTokenBalance();

  // 4. Swap BNB → AgentToken via FoT-supporting variant
  let txHash: string;
  try {
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, wallet.signer);
    const path = [wethAddress, wallet.tokenAddr];
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;

    // Auto-quote slippage protection when caller doesn't specify
    let effectiveAmountOutMin = amountOutMin;
    if (effectiveAmountOutMin === 0n) {
      try {
        const amounts: bigint[] = await router.getAmountsOut(amountIn, path);
        // 5% slippage: covers 1% FoT + price movement
        effectiveAmountOutMin = amounts[1] * 95n / 100n;
      } catch {
        console.warn("[buyback] getAmountsOut failed, proceeding without slippage protection");
      }
    }

    const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      effectiveAmountOutMin,
      path,
      wallet.address,
      deadline,
      { value: amountIn },
    );
    const receipt = await tx.wait();
    txHash = receipt.hash;
    console.log(`[buyback] Swapped ${ethers.formatEther(amountIn)} BNB → AgentToken (tx: ${txHash})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emitEvent("buyback_failed", "error", `BNB→AgentToken swap failed: ${msg}`);
    return { success: false, error: `BNB→AgentToken swap failed: ${msg}` };
  }

  // 5. Measure actual output
  const tokenBalanceAfter = await wallet.getTokenBalance();
  const amountOut = tokenBalanceAfter - tokenBalanceBefore;

  // 6. Record spend
  if (spend) {
    try { spend.record("invest", amountIn, txHash); } catch { /* ignore */ }
  }

  emitEvent("buyback_ok", "info", `Buyback: ${ethers.formatEther(amountIn)} BNB → ${ethers.formatEther(amountOut)} tokens`, {
    txHash,
    amountInWei: amountIn.toString(),
    amountOutWei: amountOut.toString(),
  });

  return { success: true, txHash, amountOut };
}

/**
 * Quote how many agent tokens would be received for a given BNB input.
 * Applies FoT discount to the raw router estimate.
 */
export async function quoteBuyback(
  wallet: AgentWallet,
  amountBnbIn: bigint,
): Promise<{ amountTokenOut: bigint } | { error: string }> {
  try {
    const tokenContract = new ethers.Contract(
      wallet.tokenAddr,
      TOKEN_ABI,
      wallet.rpcProvider,
    );
    const executorAddr: string = await tokenContract.swapExecutor();
    const executor = new ethers.Contract(executorAddr, SWAP_EXECUTOR_ABI, wallet.rpcProvider);
    const routerAddress: string = await executor.router();
    const wethAddress: string = await executor.wrappedNative();
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, wallet.rpcProvider);

    // Get raw estimate from router
    const amounts: bigint[] = await router.getAmountsOut(amountBnbIn, [wethAddress, wallet.tokenAddr]);
    const rawEstimate = amounts[1];

    // Apply FoT discount
    const feeRate: bigint = await tokenContract.feeRate();
    const amountTokenOut = rawEstimate * (10000n - feeRate) / 10000n;

    return { amountTokenOut };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Quote failed: ${msg}` };
  }
}
