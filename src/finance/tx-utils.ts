import { ethers } from "ethers";
import type { PreparedTx, TxInput } from "./tx-types.js";

export function parseBigIntish(value: unknown, field: string): bigint | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${field} must be a non-negative finite number`);
    }
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.startsWith("0x") ? BigInt(trimmed) : BigInt(trimmed);
  }
  throw new Error(`${field} must be a string, number, or bigint`);
}

export function parseNumberish(value: unknown, field: string): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative integer`);
    return parsed;
  }
  throw new Error(`${field} must be a string or number`);
}

export function normalizeHexData(data: unknown): string | undefined {
  if (data == null || data === "") return undefined;
  if (typeof data !== "string") throw new Error("data must be a string");
  const trimmed = data.trim();
  if (!trimmed) return undefined;
  const prefixed = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]*$/.test(prefixed) || prefixed.length % 2 !== 0) {
    throw new Error("data must be a valid hex string");
  }
  return prefixed;
}

export function parseTxInput(args: Record<string, unknown>): TxInput {
  const to = args.to;
  if (typeof to !== "string" || !ethers.isAddress(to)) {
    throw new Error("to must be a valid EVM address");
  }

  return {
    to: ethers.getAddress(to),
    value: parseBigIntish(args.value, "value"),
    data: normalizeHexData(args.data),
    gasLimit: parseBigIntish(args.gasLimit, "gasLimit"),
    gasPrice: parseBigIntish(args.gasPrice, "gasPrice"),
    maxFeePerGas: parseBigIntish(args.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: parseBigIntish(args.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    nonce: parseNumberish(args.nonce, "nonce"),
    chainId: parseNumberish(args.chainId, "chainId"),
    type: parseNumberish(args.type, "type"),
  };
}

function bigIntToString(value?: bigint): string | undefined {
  return value == null ? undefined : value.toString();
}

export function serializePreparedTx(tx: PreparedTx): Record<string, string | number | undefined> {
  return {
    from: tx.from,
    to: tx.to,
    chainId: tx.chainId,
    nonce: tx.nonce,
    type: tx.type,
    value: bigIntToString(tx.value),
    data: tx.data,
    gasLimit: bigIntToString(tx.gasLimit),
    gasPrice: bigIntToString(tx.gasPrice),
    maxFeePerGas: bigIntToString(tx.maxFeePerGas),
    maxPriorityFeePerGas: bigIntToString(tx.maxPriorityFeePerGas),
  };
}

export function formatTxSummary(tx: TxInput | PreparedTx): string {
  return JSON.stringify(
    {
      to: tx.to,
      chainId: tx.chainId,
      nonce: tx.nonce,
      type: tx.type,
      value: bigIntToString(tx.value),
      data: tx.data,
      gasLimit: bigIntToString(tx.gasLimit),
      gasPrice: bigIntToString(tx.gasPrice),
      maxFeePerGas: bigIntToString(tx.maxFeePerGas),
      maxPriorityFeePerGas: bigIntToString(tx.maxPriorityFeePerGas),
      ...( "from" in tx ? { from: tx.from } : {}),
    },
    null,
    2,
  );
}
