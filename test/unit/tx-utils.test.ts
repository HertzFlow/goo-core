import { describe, it, expect } from "vitest";
import {
  parseBigIntish,
  parseNumberish,
  normalizeHexData,
  parseTxInput,
  serializePreparedTx,
  formatTxSummary,
} from "../../src/finance/tx-utils.js";

const VALID_TO = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

describe("parseBigIntish", () => {
  it("returns undefined for null, empty string", () => {
    expect(parseBigIntish(null, "v")).toBeUndefined();
    expect(parseBigIntish("", "v")).toBeUndefined();
  });

  it("passes through bigint", () => {
    expect(parseBigIntish(5n, "v")).toBe(5n);
  });

  it("truncates non-negative finite numbers", () => {
    expect(parseBigIntish(42, "v")).toBe(42n);
    expect(parseBigIntish(3.9, "v")).toBe(3n);
  });

  it("throws for negative or non-finite numbers", () => {
    expect(() => parseBigIntish(-1, "v")).toThrow("non-negative finite");
    expect(() => parseBigIntish(Number.NaN, "v")).toThrow("non-negative finite");
    expect(() => parseBigIntish(Number.POSITIVE_INFINITY, "v")).toThrow("non-negative finite");
  });

  it("parses decimal and hex strings", () => {
    expect(parseBigIntish(" 100 ", "v")).toBe(100n);
    expect(parseBigIntish("0xff", "v")).toBe(255n);
  });

  it("throws for invalid types", () => {
    expect(() => parseBigIntish(true, "v")).toThrow("string, number, or bigint");
  });
});

describe("parseNumberish", () => {
  it("returns undefined for null and empty", () => {
    expect(parseNumberish(null, "n")).toBeUndefined();
    expect(parseNumberish("", "n")).toBeUndefined();
  });

  it("accepts non-negative integers", () => {
    expect(parseNumberish(0, "n")).toBe(0);
    expect(parseNumberish(7, "n")).toBe(7);
  });

  it("throws for float or negative", () => {
    expect(() => parseNumberish(1.5, "n")).toThrow("non-negative integer");
    expect(() => parseNumberish(-1, "n")).toThrow("non-negative integer");
  });

  it("parses base-10 strings", () => {
    expect(parseNumberish(" 12 ", "n")).toBe(12);
  });

  it("throws for invalid string numbers", () => {
    expect(() => parseNumberish("abc", "n")).toThrow("non-negative integer");
  });

  it("throws for non-string non-number types", () => {
    expect(() => parseNumberish(true, "n")).toThrow("string or number");
  });
});

describe("normalizeHexData", () => {
  it("returns undefined for null/empty", () => {
    expect(normalizeHexData(null)).toBeUndefined();
    expect(normalizeHexData("")).toBeUndefined();
  });

  it("adds 0x prefix and lowercases valid hex", () => {
    expect(normalizeHexData("abcd")).toBe("0xabcd");
    expect(normalizeHexData("0xABCD")).toBe("0xABCD");
  });

  it("throws for non-string", () => {
    expect(() => normalizeHexData(1)).toThrow("data must be a string");
  });

  it("throws for invalid hex or odd length", () => {
    expect(() => normalizeHexData("0xgg")).toThrow("valid hex");
    expect(() => normalizeHexData("0xabc")).toThrow("valid hex");
  });
});

describe("parseTxInput", () => {
  it("parses minimal valid input with checksum address", () => {
    const tx = parseTxInput({ to: VALID_TO });
    expect(tx.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(tx.value).toBeUndefined();
  });

  it("parses optional bigint and number fields", () => {
    const tx = parseTxInput({
      to: VALID_TO,
      value: "1000",
      data: "0x",
      gasLimit: 21000n,
      nonce: 5,
      chainId: "97",
      type: 2,
    });
    expect(tx.value).toBe(1000n);
    expect(tx.data).toBe("0x");
    expect(tx.gasLimit).toBe(21000n);
    expect(tx.nonce).toBe(5);
    expect(tx.chainId).toBe(97);
    expect(tx.type).toBe(2);
  });

  it("throws when to is missing or invalid", () => {
    expect(() => parseTxInput({})).toThrow("valid EVM address");
    expect(() => parseTxInput({ to: "not-an-address" })).toThrow("valid EVM address");
  });
});

describe("serializePreparedTx and formatTxSummary", () => {
  it("serializes bigint fields as decimal strings", () => {
    const rec = serializePreparedTx({
      from: "0x0000000000000000000000000000000000000001",
      to: VALID_TO,
      chainId: 97,
      nonce: 1,
      gasLimit: 21000n,
      value: 1n,
      data: "0x",
      gasPrice: 2n,
      maxFeePerGas: 3n,
      maxPriorityFeePerGas: 4n,
    });
    expect(rec.value).toBe("1");
    expect(rec.gasLimit).toBe("21000");
    expect(rec.chainId).toBe(97);
  });

  it("formatTxSummary includes from for PreparedTx", () => {
    const prepared = {
      from: "0x0000000000000000000000000000000000000002",
      to: VALID_TO,
      chainId: 97,
      nonce: 0,
      gasLimit: 21000n,
    };
    const json = formatTxSummary(prepared);
    expect(json).toContain("from");
    expect(json).toContain("0x0000000000000000000000000000000000000002");
  });

  it("formatTxSummary omits from for TxInput only", () => {
    const input = parseTxInput({ to: VALID_TO, value: "0" });
    const json = formatTxSummary(input);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeDefined();
  });
});
