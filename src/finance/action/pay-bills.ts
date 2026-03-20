/**
 * pay-bills.ts — Pay infrastructure service bills (via x402)
 *
 * Handles bill payment for infra services (hosting, API, storage, etc.):
 * completes payment using the x402 protocol (via handleX402Payment) and records as infra spending.
 */

import type { ethers } from "ethers";
import type { X402PaymentParams, X402PaymentResult } from "./x402.js";
import { handleX402Payment } from "./x402.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface Bill {
  /** Service identifier, e.g. "hosting", "api", "storage" */
  service: string;
  /** Payment parameters (same as x402) */
  payment: X402PaymentParams;
  /** Optional: due date or description */
  dueAt?: string;
  note?: string;
}

export interface PayBillsResult {
  paid: boolean;
  billId?: string;
  result?: X402PaymentResult;
  error?: string;
}

// ─── Handlers ───────────────────────────────────────────────────────────

/**
 * Pay a single infra bill: complete payment via x402 and record spending (scaffolding).
 */
export async function payBill(
  signer: ethers.Signer,
  bill: Bill,
  retryWithHeader: (paymentHeader: string) => Promise<unknown>,
): Promise<PayBillsResult> {
  const result = await handleX402Payment(signer, bill.payment, retryWithHeader);
  if (!result.success) {
    return { paid: false, result, error: result.error };
  }
  // TODO: record spend via spendManager.record("other", ...) when txHash available
  return { paid: true, result };
}

/**
 * Get the list of pending bills (scaffolding: can be loaded from config or external API).
 */
export async function getPendingBills(): Promise<Bill[]> {
  // TODO: load from config or billing API
  return [];
}

export interface PayPendingBillsOptions {
  /**
   * When set, pay this list instead of calling getPendingBills().
   * Use when the caller already loaded bills from an external API or for tests.
   */
  bills?: Bill[];
}

/**
 * Pay all currently pending bills in batch (scaffolding).
 */
export async function payPendingBills(
  signer: ethers.Signer,
  retryWithHeader: (bill: Bill, paymentHeader: string) => Promise<unknown>,
  options?: PayPendingBillsOptions,
): Promise<PayBillsResult[]> {
  const bills = options?.bills ?? (await getPendingBills());
  const results: PayBillsResult[] = [];
  for (const bill of bills) {
    const r = await payBill(signer, bill, (header) => retryWithHeader(bill, header));
    results.push(r);
  }
  return results;
}
