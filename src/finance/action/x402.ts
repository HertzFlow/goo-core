/**
 * x402.ts — x402 payment protocol: Permit2 signing, payment header assembly, 402 orchestration
 *
 * When an upstream service returns 402 Payment Required, handles the complete x402 protocol flow:
 * parse 402 response → sign Permit2 → assemble payment-signature header → retry request → read settlement info.
 *
 * This is the sole entry point for x402 business logic; callers like pay-bills use this module uniformly.
 */

import { ethers } from "ethers";
import type { SpendManager, SpendCategory } from "../spend.js";

// ─── Permit2 constants ──────────────────────────────────────────────────

export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const X402_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";

export const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface X402PaymentParams {
  /** Payment network, e.g. "eip155:56" */
  network: string;
  /** Payment asset address */
  asset: string;
  /** Payment amount (wei or smallest unit as string) */
  amount: string;
  /** Recipient address (x402 payTo) */
  payTo: string;
  /** Optional: timeout in seconds */
  maxTimeoutSeconds?: number;
}

export interface X402SignedResult {
  from: string;
  signature: string;
  permit2Authorization: Record<string, unknown>;
}

export interface X402PaymentResult {
  success: boolean;
  response?: Response;
  /** Payment amount (from the 402 response accepts[0].amount) */
  amount?: string;
  settlement?: X402Settlement;
  error?: string;
}

export interface X402Settlement {
  txHash?: string;
  payer?: string;
}

/** Parsed 402 response body */
export interface X402ResponseBody {
  x402Version?: number;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts?: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: { name?: string; version?: string };
  }>;
}

// ─── Low-level helpers ──────────────────────────────────────────────────

/**
 * Sign a Permit2 PermitWitnessTransferFrom for x402 payment.
 * Pure function — only needs an ethers.Wallet signer and payment params.
 */
export async function signPermit2(
  signer: ethers.Signer,
  params: X402PaymentParams,
): Promise<X402SignedResult> {
  const now = Math.floor(Date.now() / 1000);
  const chainId = parseInt(params.network.split(":")[1], 10);
  const deadline = now + (params.maxTimeoutSeconds || 300);
  const validAfter = now - 600;

  const nonceBytes = ethers.randomBytes(32);
  const nonce = ethers.toBigInt(nonceBytes);

  const domain = {
    name: "Permit2",
    verifyingContract: PERMIT2_ADDRESS,
    chainId,
  };

  const message = {
    permitted: {
      token: params.asset,
      amount: BigInt(params.amount),
    },
    spender: X402_PERMIT2_PROXY,
    nonce,
    deadline: BigInt(deadline),
    witness: {
      to: params.payTo,
      validAfter: BigInt(validAfter),
    },
  };

  const signerAddress = await signer.getAddress();

  const signature = await signer.signTypedData(
    domain,
    PERMIT2_WITNESS_TYPES,
    message,
  );

  const permit2Authorization = {
    from: signerAddress,
    spender: X402_PERMIT2_PROXY,
    nonce: nonce.toString(),
    deadline: String(deadline),
    permitted: {
      token: params.asset,
      amount: params.amount,
    },
    witness: {
      to: params.payTo,
      validAfter: String(validAfter),
    },
  };

  return { from: signerAddress, signature, permit2Authorization };
}

/**
 * Build base64-encoded x-payment header from signed Permit2 data.
 */
export function buildPaymentHeader(
  signed: X402SignedResult,
  opts: {
    x402Version: number;
    network: string;
    resource?: unknown;
    accepted?: unknown;
  },
): string {
  const paymentPayload = {
    x402Version: opts.x402Version,
    scheme: "exact",
    network: opts.network,
    payload: {
      permit2Authorization: signed.permit2Authorization,
      signature: signed.signature,
    },
    resource: opts.resource,
    accepted: opts.accepted,
  };
  return btoa(JSON.stringify(paymentPayload));
}

/**
 * Parse a 402 response body to extract payment requirements.
 */
export function parseX402Response(body: X402ResponseBody): {
  requirements: X402PaymentParams;
  x402Version: number;
  resource?: unknown;
} {
  const requirements = body.accepts?.[0];
  if (!requirements) {
    throw new Error("x402: No payment requirements in 402 response");
  }
  return {
    requirements: {
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.amount,
      payTo: requirements.payTo,
      maxTimeoutSeconds: requirements.maxTimeoutSeconds,
    },
    x402Version: body.x402Version ?? 2,
    resource: body.resource,
  };
}

/**
 * Read settlement info from response headers.
 * Checks both x402 standard (`payment-response` base64 JSON) and
 * legacy bsc-llm-router headers (`x-bsc-llm-router-tx` / `payer`).
 */
export function readSettlement(res: Response): X402Settlement {
  // x402 standard: base64-encoded JSON in payment-response header
  const paymentResponse = res.headers.get("payment-response");
  if (paymentResponse) {
    try {
      const decoded = JSON.parse(atob(paymentResponse));
      return {
        txHash: decoded.transaction ?? decoded.txHash ?? undefined,
        payer: decoded.payer ?? undefined,
      };
    } catch { /* fall through to legacy headers */ }
  }
  // Legacy bsc-llm-router headers
  return {
    txHash: res.headers.get("x-bsc-llm-router-tx") ?? undefined,
    payer: res.headers.get("x-bsc-llm-router-payer") ?? undefined,
  };
}

// ─── Complete 402 orchestration ─────────────────────────────────────────

/**
 * Handle a complete HTTP 402 flow:
 * 1. Parse 402 response (header or body) for payment requirements
 * 2. Sign Permit2 authorization
 * 3. Build x-payment header
 * 4. Retry the original request with the header
 * 5. Validate retry response (reject if still 402)
 * 6. Read settlement info from response headers
 *
 * This is the single entry point for x402 payment handling.
 * Supports both:
 * - `payment-required` header (base64 JSON, used by @x402/hono middleware)
 * - Response body JSON (used by bsc-llm-router and other services)
 */
export async function handleHttpX402(
  signer: ethers.Signer,
  res402: Response,
  retry: (paymentHeader: string) => Promise<Response>,
  spend?: { manager: SpendManager; category: SpendCategory },
): Promise<X402PaymentResult> {
  try {
    // 1. Parse 402 — try header first (x402 standard), then body (legacy)
    let body: X402ResponseBody;
    const prHeader = res402.headers.get("payment-required");
    if (prHeader) {
      try {
        body = JSON.parse(atob(prHeader)) as X402ResponseBody;
      } catch {
        body = await res402.json() as X402ResponseBody;
      }
    } else {
      body = await res402.json() as X402ResponseBody;
    }
    const { requirements, x402Version, resource } = parseX402Response(body);

    console.log(
      `  [x402] Payment required: ${requirements.amount} on ${requirements.network} → signing...`
    );

    // 2. Sign
    const signed = await signPermit2(signer, requirements);

    // 3. Build header
    const paymentHeader = buildPaymentHeader(signed, {
      x402Version,
      network: requirements.network,
      resource,
      accepted: body.accepts?.[0],
    });

    // 4. Retry with payment header
    const retryRes = await retry(paymentHeader);

    // 5. Validate
    if (retryRes.status === 402) {
      const errBody = await retryRes.text().catch(() => "");
      throw new Error(`x402: Payment rejected after signing: ${errBody}`);
    }

    // 6. Read settlement
    const settlement = readSettlement(retryRes);
    if (settlement.txHash) {
      console.log(`  [x402] Settled: payer=${settlement.payer} tx=${settlement.txHash}`);
      // Record spend if manager provided
      if (spend) {
        try {
          spend.manager.record(spend.category, BigInt(requirements.amount), settlement.txHash);
        } catch { /* ignore recording errors */ }
      }
    }

    return { success: true, response: retryRes, amount: requirements.amount, settlement };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

// ─── Convenience aliases ────────────────────────────────────────────────

/** Alias for signPermit2. */
export async function signX402Payment(
  signer: ethers.Signer,
  params: X402PaymentParams,
): Promise<X402SignedResult> {
  return signPermit2(signer, params);
}

/**
 * Simple callback-based 402 handler for non-HTTP contexts (e.g. pay-bills).
 * Signs, builds the payment header, and passes it to the callback.
 */
export async function handleX402Payment(
  signer: ethers.Signer,
  params: X402PaymentParams,
  retryWithHeader: (paymentHeader: string) => Promise<unknown>,
  x402Version: number = 2,
): Promise<X402PaymentResult> {
  try {
    const signed = await signPermit2(signer, params);
    const paymentHeader = buildPaymentHeader(signed, {
      x402Version,
      network: params.network,
    });
    const response = await retryWithHeader(paymentHeader);
    return { success: true, response: response as Response };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
