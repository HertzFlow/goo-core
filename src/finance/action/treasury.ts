/**
 * treasury.ts — Treasury capability detection and withdrawal
 *
 * Detects whether the token contract supports withdrawToWallet (V2 capability),
 * and executes treasury → wallet BNB withdrawal.
 */

import { ethers } from "ethers";

// ─── ABI (treasury-specific) ────────────────────────────────────────────

const TREASURY_ABI = [
  "function withdrawToWallet(uint256 amount)",
  "function treasuryBalance() view returns (uint256)",
  "function starvingThreshold() view returns (uint256)",
];

// ─── Types ──────────────────────────────────────────────────────────────

export interface TreasuryCapabilities {
  /** Whether the contract supports withdrawToWallet */
  hasWithdrawToWallet: boolean;
}

export interface WithdrawResult {
  txHash: string;
  amount: bigint;
}

// ─── Functions ──────────────────────────────────────────────────────────

/**
 * Detect treasury capabilities by probing the token contract.
 * Calls withdrawToWallet.staticCall(0) — if the contract has the function,
 * it will revert with a "Goo:" validation error; if not, it reverts differently.
 */
export async function detectTreasuryCapabilities(
  tokenAddress: string,
  provider: ethers.JsonRpcProvider,
): Promise<TreasuryCapabilities> {
  const contract = new ethers.Contract(tokenAddress, TREASURY_ABI, provider);

  let hasWithdrawToWallet = false;
  try {
    await contract.withdrawToWallet.staticCall(0n).catch((err: Error) => {
      if (err.message.includes("Goo:")) {
        hasWithdrawToWallet = true;
      }
    });
  } catch {
    hasWithdrawToWallet = false;
  }

  return { hasWithdrawToWallet };
}

/**
 * Withdraw BNB from treasury to the agent's wallet.
 * Requires the contract to support withdrawToWallet.
 */
export async function withdrawFromTreasury(
  signer: ethers.Signer,
  tokenAddress: string,
  amount: bigint,
): Promise<WithdrawResult> {
  const contract = new ethers.Contract(tokenAddress, TREASURY_ABI, signer);
  const tx = await contract.withdrawToWallet(amount);
  const receipt = await tx.wait();
  console.log(
    `[treasury] Withdrew ${ethers.formatEther(amount)} BNB from treasury (tx: ${receipt.hash})`,
  );
  return { txHash: receipt.hash, amount };
}
