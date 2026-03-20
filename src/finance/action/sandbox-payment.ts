/**
 * sandbox-payment.ts — Sandbox Manager x402 payment integration
 *
 * Calls the sandbox-manager API via x402 protocol to create/renew sandboxes.
 * Uses handleHttpX402 to complete the full 402 -> Permit2 signing -> retry flow.
 */

import { ethers } from "ethers";
import type { SpendManager } from "../spend.js";
import { handleHttpX402 } from "./x402.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface SandboxCreateParams {
  agentId: string;
  agentName?: string;
  tokenAddress?: string;
  walletAddress?: string;
  walletPrivateKey?: string;
  genome?: Record<string, unknown>;
}

export interface SandboxCreateResult {
  agentId: string;
  sandboxId: string;
  domain: string;
  gatewayUrl?: string;
  walletAddress?: string;
}

export interface SandboxRenewParams {
  timeoutMs?: number;
}

export interface SandboxPaymentConfig {
  /** Sandbox manager base URL (e.g. "https://testnet-api.bscsandboxmanager.com") */
  managerUrl: string;
}

// ─── Create Sandbox ─────────────────────────────────────────────────────

/**
 * Create a sandbox via the sandbox-manager, handling x402 payment automatically.
 *
 * Flow:
 * 1. POST /api/v1/sandboxes → 402 Payment Required
 * 2. Sign Permit2 via agent wallet
 * 3. Retry with x-payment header → 201 Created
 *
 * If the manager is configured without x402 (no X402_WALLET_ADDRESS),
 * the first request succeeds directly with 201.
 */
export async function createSandbox(
  signer: ethers.Signer,
  config: SandboxPaymentConfig,
  params: SandboxCreateParams,
  spendManager?: SpendManager,
): Promise<SandboxCreateResult> {
  const url = `${config.managerUrl.replace(/\/+$/, "")}/api/v1/sandboxes`;
  const body = JSON.stringify({
    agentId: params.agentId,
    agentName: params.agentName || params.agentId.slice(0, 8),
    tokenAddress: params.tokenAddress || "0x0",
    walletAddress: params.walletAddress,
    walletPrivateKey: params.walletPrivateKey,
    genome: params.genome || {},
  });

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  console.log(`[sandbox-payment] Creating sandbox for ${params.agentId}...`);
  const res = await fetch(url, { method: "POST", headers, body });

  // No payment required — direct success
  if (res.status === 201 || (res.ok && res.status < 300)) {
    return await res.json() as SandboxCreateResult;
  }

  // x402 payment required
  if (res.status === 402) {
    const result = await handleHttpX402(
      signer,
      res,
      async (paymentHeader) => {
        return fetch(url, {
          method: "POST",
          headers: { ...headers, "x-payment": paymentHeader },
          body,
        });
      },
      spendManager ? { manager: spendManager, category: "other" } : undefined,
    );

    if (!result.success) {
      throw new Error(`Sandbox create payment failed: ${result.error}`);
    }

    const data = await result.response!.json() as SandboxCreateResult;
    console.log(`[sandbox-payment] Sandbox created: ${data.sandboxId}`);
    return data;
  }

  // Other error
  const errBody = await res.text().catch(() => "");
  throw new Error(`Sandbox create failed (${res.status}): ${errBody}`);
}

// ─── Test Create (skip payment) ─────────────────────────────────────────

/**
 * Create a sandbox via the test-create endpoint (skips x402 payment).
 */
export async function testCreateSandbox(
  config: SandboxPaymentConfig,
  params: SandboxCreateParams,
): Promise<SandboxCreateResult> {
  const url = `${config.managerUrl.replace(/\/+$/, "")}/api/v1/sandboxes/test-create`;
  const body = JSON.stringify({
    agentId: params.agentId,
    agentName: params.agentName || params.agentId.slice(0, 8),
    walletAddress: params.walletAddress,
    walletPrivateKey: params.walletPrivateKey,
    genome: params.genome || {},
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Sandbox test-create failed (${res.status}): ${errBody}`);
  }

  return await res.json() as SandboxCreateResult;
}

// ─── Renew Sandbox ──────────────────────────────────────────────────────

/**
 * Renew (extend timeout) a sandbox via x402 payment.
 *
 * Flow:
 * 1. POST /api/v1/sandboxes/:agentId/renew → 402
 * 2. Sign Permit2 → retry with x-payment header → 200
 */
export async function renewSandbox(
  signer: ethers.Signer,
  config: SandboxPaymentConfig,
  agentId: string,
  params?: SandboxRenewParams,
  spendManager?: SpendManager,
): Promise<{ message: string }> {
  const url = `${config.managerUrl.replace(/\/+$/, "")}/api/v1/sandboxes/${agentId}/renew`;
  const body = JSON.stringify(params || {});
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  console.log(`[sandbox-payment] Renewing sandbox for ${agentId}...`);
  const res = await fetch(url, { method: "POST", headers, body });

  // No payment required
  if (res.ok) {
    return await res.json() as { message: string };
  }

  // x402 payment required
  if (res.status === 402) {
    const result = await handleHttpX402(
      signer,
      res,
      async (paymentHeader) => {
        return fetch(url, {
          method: "POST",
          headers: { ...headers, "x-payment": paymentHeader },
          body,
        });
      },
      spendManager ? { manager: spendManager, category: "other" } : undefined,
    );

    if (!result.success) {
      throw new Error(`Sandbox renew payment failed: ${result.error}`);
    }

    const data = await result.response!.json() as { message: string };
    console.log(`[sandbox-payment] Sandbox renewed for ${agentId}`);
    return data;
  }

  const errBody = await res.text().catch(() => "");
  throw new Error(`Sandbox renew failed (${res.status}): ${errBody}`);
}

// ─── Get Sandbox Status ─────────────────────────────────────────────────

export interface SandboxInfo {
  agentId: string;
  agentName: string;
  sandboxId: string;
  state: string;
  domain: string;
  chainStatus: string;
  launchTime?: string;
  uptimeSeconds?: number;
  endAt?: string;
  totalSettledUsd: number;
}

/**
 * Get sandbox detail from the manager (no payment required).
 */
export async function getSandboxStatus(
  config: SandboxPaymentConfig,
  agentId: string,
): Promise<SandboxInfo | null> {
  const url = `${config.managerUrl.replace(/\/+$/, "")}/api/v1/sandboxes/${agentId}`;
  const res = await fetch(url);

  if (res.status === 404) return null;
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Sandbox status failed (${res.status}): ${errBody}`);
  }

  return await res.json() as SandboxInfo;
}
