/**
 * pancakeswap-v3.ts — Shared PancakeSwap V3 constants, ABIs, and helpers.
 *
 * Used by payment-token-refill.ts and renew-agos-aiou tool.
 */

import { ethers } from "ethers";

// ─── Fee tiers to probe via QuoterV2 ────────────────────────────────────

export const FEE_TIERS = [500, 2500, 10_000] as const; // 0.05%, 0.25%, 1%

// ─── PancakeSwap V3 Addresses (canonical, immutable) ────────────────────

export const PANCAKE_V3: Record<number, { swapRouter: string; quoter: string }> = {
  56: { // BSC Mainnet
    swapRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
    quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
  },
  97: { // BSC Testnet
    swapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
    quoter: "0xbC203d7f83677c7ed3F7acEc959963E7F4ECC5C2",
  },
};

// ─── ABIs ────────────────────────────────────────────────────────────────

export const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

export const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountIn)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Find the best fee tier for a pair by quoting each via QuoterV2 staticCall.
 */
export async function findBestFeeTier(
  quoter: ethers.Contract,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<{ fee: number; amountOut: bigint }> {
  let bestFee = 2500;
  let bestOut = 0n;

  for (const fee of FEE_TIERS) {
    try {
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      });
      const amountOut: bigint = result[0];
      if (amountOut > bestOut) {
        bestOut = amountOut;
        bestFee = fee;
      }
    } catch {
      // Pool doesn't exist or has no liquidity for this fee tier
    }
  }

  return { fee: bestFee, amountOut: bestOut };
}

/**
 * Find the best fee tier for a desired output amount by quoting each via QuoterV2 staticCall.
 * Returns the fee tier that requires the least input.
 */
export async function findBestFeeTierForOutput(
  quoter: ethers.Contract,
  tokenIn: string,
  tokenOut: string,
  amountOut: bigint,
): Promise<{ fee: number; amountIn: bigint }> {
  let bestFee = 2500;
  let bestIn = 0n;

  for (const fee of FEE_TIERS) {
    try {
      const result = await quoter.quoteExactOutputSingle.staticCall({
        tokenIn,
        tokenOut,
        amount: amountOut,
        fee,
        sqrtPriceLimitX96: 0n,
      });
      const amountIn: bigint = result[0];
      if (bestIn === 0n || amountIn < bestIn) {
        bestIn = amountIn;
        bestFee = fee;
      }
    } catch {
      // Pool doesn't exist or has no liquidity for this fee tier
    }
  }

  return { fee: bestFee, amountIn: bestIn };
}

/**
 * Execute a V3 exactOutputSingle swap (buy exact output amount).
 * For native BNB input: pass `nativeValue` >= `amountInMaximum`.
 * The router refunds excess BNB as WBNB — caller may need to unwrap.
 */
export async function executeExactOutputSwap(
  signer: ethers.Signer,
  routerAddress: string,
  params: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    recipient: string;
    amountOut: bigint;
    amountInMaximum: bigint;
  },
  nativeValue?: bigint,
): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
  const router = new ethers.Contract(routerAddress, SWAP_ROUTER_ABI, signer);
  const tx = await router.exactOutputSingle(
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.fee,
      recipient: params.recipient,
      amountOut: params.amountOut,
      amountInMaximum: params.amountInMaximum,
      sqrtPriceLimitX96: 0n,
    },
    nativeValue !== undefined ? { value: nativeValue } : {},
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, receipt };
}

/**
 * Execute a V3 exactInputSingle swap. Supports both native BNB (payable) and ERC20 input.
 * For native BNB: pass `nativeValue` equal to `amountIn`.
 * For ERC20: caller must approve the router first, pass `nativeValue` as undefined.
 */
export async function executeSwap(
  signer: ethers.Signer,
  routerAddress: string,
  params: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    recipient: string;
    amountIn: bigint;
    amountOutMinimum: bigint;
  },
  nativeValue?: bigint,
): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
  const router = new ethers.Contract(routerAddress, SWAP_ROUTER_ABI, signer);
  const tx = await router.exactInputSingle(
    {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.fee,
      recipient: params.recipient,
      amountIn: params.amountIn,
      amountOutMinimum: params.amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    },
    nativeValue !== undefined ? { value: nativeValue } : {},
  );
  const receipt = await tx.wait();
  return { txHash: receipt.hash, receipt };
}
