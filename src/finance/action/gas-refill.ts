/**
 * gas-refill.ts — Gas refill from BNB treasury
 *
 * Treasury IS BNB, so gas refill = withdrawToWallet(amount). No swap needed.
 */

import { ethers } from "ethers";
import type { AgentWallet } from "../wallet.js";
import type { SpendManager } from "../spend.js";
import { detectTreasuryCapabilities, withdrawFromTreasury } from "./treasury.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface GasRefillResult {
  refilled: boolean;
  amount?: bigint;
  txHash?: string;
  error?: string;
}

export interface GasCheckOptions {
  /** native balance minimum (wei) */
  minGasBalance: bigint;
  /** single refill target amount (wei) */
  gasRefillAmount: bigint;
}

// ─── Handlers ───────────────────────────────────────────────────────────

/**
 * Check native balance and refill gas if below threshold.
 * Since treasury is BNB, refill = withdrawToWallet from contract.
 */
export async function ensureWalletGas(
  wallet: AgentWallet,
  options: GasCheckOptions,
  spendManager?: SpendManager,
): Promise<GasRefillResult> {
  const { minGasBalance, gasRefillAmount } = options;
  const signer = wallet.signer;
  const provider = wallet.rpcProvider;

  // 1. Check native balance
  const signerAddress = await signer.getAddress();
  const nativeBalance = await provider.getBalance(signerAddress);
  if (nativeBalance >= minGasBalance) {
    return { refilled: false };
  }

  console.log(
    `[gas-refill] Gas low: ${ethers.formatEther(nativeBalance)} < ` +
    `${ethers.formatEther(minGasBalance)}. Attempting refill from treasury...`,
  );

  try {
    // 2. Detect treasury capability and withdraw BNB
    const caps = await detectTreasuryCapabilities(wallet.tokenAddr, provider);
    if (!caps.hasWithdrawToWallet) {
      return { refilled: false, error: "Treasury withdraw not supported" };
    }

    // 3. Check treasury balance — skip if insufficient to avoid on-chain revert
    const treasuryContract = new ethers.Contract(
      wallet.tokenAddr,
      ["function treasuryBalance() view returns (uint256)"],
      provider,
    );
    let treasuryBal: bigint;
    try {
      treasuryBal = await treasuryContract.treasuryBalance();
    } catch {
      treasuryBal = 0n;
    }

    let withdrawAmount = gasRefillAmount;
    if (treasuryBal < gasRefillAmount) {
      // Treasury can't cover full refill — take what's available minus a small buffer for gas
      const buffer = ethers.parseEther("0.001");
      if (treasuryBal <= buffer) {
        return {
          refilled: false,
          error: `Treasury too low for gas refill (${ethers.formatEther(treasuryBal)} BNB)`,
        };
      }
      withdrawAmount = treasuryBal - buffer;
    }

    const result = await withdrawFromTreasury(
      signer,
      wallet.tokenAddr,
      withdrawAmount,
    );

    console.log(
      `[gas-refill] Refilled: withdrew ${ethers.formatEther(withdrawAmount)} BNB from treasury (tx: ${result.txHash})`,
    );

    // Record spend if manager provided
    if (spendManager && result.txHash) {
      spendManager.record("gas", withdrawAmount, result.txHash);
    }

    return { refilled: true, amount: withdrawAmount, txHash: result.txHash };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { refilled: false, error: `Gas refill failed: ${msg}` };
  }
}

/**
 * Placeholder for token contract gas top-up.
 */
export async function ensureTokenGas(
  _wallet: AgentWallet,
  _options: GasCheckOptions,
): Promise<GasRefillResult> {
  return { refilled: false };
}
