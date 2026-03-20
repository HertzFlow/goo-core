/**
 * eip3009-sign.ts — Server-side EIP-3009 transferWithAuthorization signing.
 *
 * Builds EIP-712 typed data and signs it with an ethers.Wallet.
 * Used by the renew-agos-aiou tool to fund AGOS without user interaction.
 *
 * Ported from app/src/finance/eip3009.ts (frontend/worker version).
 */

import { ethers } from "ethers";
import { randomBytes } from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────

export interface Eip3009AuthorizationParams {
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
}

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface Eip3009SettlePayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: Eip3009AuthorizationParams;
  };
}

/**
 * 402 challenge from AGOS funding API.
 * Mirrors the structure returned by `client.fundAgent()` when status=402.
 */
export interface FundChallenge {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    networkId?: number;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
    extra?: {
      authorizationType?: string;
      chainId?: number | string;
      [key: string]: unknown;
    };
  }>;
}

// ─── Constants ──────────────────────────────────────────────────────────

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const DEFAULT_VALIDITY_SECONDS = 30 * 60; // 30 minutes

// ─── Helpers ────────────────────────────────────────────────────────────

function generateNonce(): string {
  return "0x" + randomBytes(32).toString("hex");
}

function findEip3009Accept(challenge: FundChallenge) {
  const accept = challenge.accepts.find(
    (a) => a.extra?.authorizationType === "eip3009",
  );
  if (!accept) {
    throw new Error(
      `No eip3009 accept entry in challenge. Available: ${challenge.accepts.map((a) => a.extra?.authorizationType ?? "unknown").join(", ")}`,
    );
  }
  return accept;
}

// ─── Main ───────────────────────────────────────────────────────────────

export interface BuildAndSignOptions {
  /** Payer wallet address */
  from: string;
  /** EIP-712 domain name (default: "AIOU Credit") */
  tokenName?: string;
  /** EIP-712 domain version (default: "1") */
  domainVersion?: string;
  /** Validity window in seconds (default: 1800) */
  validitySeconds?: number;
}

export interface SignedAuthorization {
  signature: string;
  authorization: Eip3009AuthorizationParams;
  domain: Eip712Domain;
  settlePayload: Eip3009SettlePayload;
}

/**
 * Build EIP-712 typed data from an AGOS 402 challenge and sign it server-side.
 *
 * Returns the signature + authorization params + ready-to-submit settle payload.
 */
export async function buildAndSignAuthorization(
  signer: ethers.Signer,
  challenge: FundChallenge,
  opts: BuildAndSignOptions,
): Promise<SignedAuthorization> {
  const accept = findEip3009Accept(challenge);
  const chainId = Number(accept.extra?.chainId ?? accept.networkId);
  if (!chainId) {
    throw new Error("Cannot determine chainId from challenge accept entry");
  }

  const authorization: Eip3009AuthorizationParams = {
    from: opts.from,
    to: accept.payTo,
    value: accept.maxAmountRequired,
    validAfter: 0,
    validBefore: Math.floor(Date.now() / 1000) + (opts.validitySeconds ?? DEFAULT_VALIDITY_SECONDS),
    nonce: generateNonce(),
  };

  const domain: Eip712Domain = {
    name: opts.tokenName ?? "AIOU Credit",
    version: opts.domainVersion ?? "1",
    chainId,
    verifyingContract: accept.asset,
  };

  // Sign EIP-712 typed data (ethers v6 signTypedData does not want EIP712Domain in types)
  const signature = await signer.signTypedData(
    domain,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    authorization,
  );

  return {
    signature,
    authorization,
    domain,
    settlePayload: {
      x402Version: challenge.x402Version,
      scheme: accept.scheme,
      network: accept.network,
      payload: {
        signature,
        authorization,
      },
    },
  };
}
