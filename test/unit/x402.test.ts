import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  signPermit2,
  buildPaymentHeader,
  readSettlement,
  parseX402Response,
  handleHttpX402,
  handleX402Payment,
  PERMIT2_ADDRESS,
  X402_PERMIT2_PROXY,
} from "../../src/finance/action/x402.js";
import { SpendManager } from "../../src/finance/spend.js";

// Mock ethers to avoid real crypto
const mockSignTypedData = vi.fn().mockResolvedValue("0xSIG_MOCK");
const mockSigner = {
  address: "0xSignerAddress",
  getAddress: vi.fn().mockResolvedValue("0xSignerAddress"),
  signTypedData: mockSignTypedData,
} as never;

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      randomBytes: () => new Uint8Array(32).fill(1),
      toBigInt: (bytes: Uint8Array) => BigInt("0x" + Buffer.from(bytes).toString("hex")),
    },
  };
});

const baseParams = {
  network: "eip155:56",
  asset: "0xAsset",
  amount: "1000000",
  payTo: "0xPayTo",
};

describe("x402", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("signPermit2", () => {
    it("signs and returns from, signature, permit2Authorization", async () => {
      const result = await signPermit2(mockSigner, baseParams);

      expect(result.from).toBe("0xSignerAddress");
      expect(result.signature).toBe("0xSIG_MOCK");
      expect(result.permit2Authorization).toMatchObject({
        from: "0xSignerAddress",
        spender: X402_PERMIT2_PROXY,
        permitted: { token: "0xAsset", amount: "1000000" },
        witness: { to: "0xPayTo" },
      });

      // Verify signTypedData was called with Permit2 domain
      expect(mockSignTypedData).toHaveBeenCalledOnce();
      const [domain] = mockSignTypedData.mock.calls[0];
      expect(domain.name).toBe("Permit2");
      expect(domain.verifyingContract).toBe(PERMIT2_ADDRESS);
      expect(domain.chainId).toBe(56);
    });

    it("parses chainId from network string", async () => {
      await signPermit2(mockSigner, { ...baseParams, network: "eip155:97" });
      const [domain] = mockSignTypedData.mock.calls[0];
      expect(domain.chainId).toBe(97);
    });
  });

  describe("buildPaymentHeader", () => {
    it("builds base64 JSON with correct structure", () => {
      const signed = {
        from: "0xFrom",
        signature: "0xSig",
        permit2Authorization: { foo: "bar" },
      };
      const header = buildPaymentHeader(signed, {
        x402Version: 2,
        network: "eip155:56",
        resource: { url: "https://api.test" },
        accepted: { amount: "100" },
      });

      const decoded = JSON.parse(atob(header));
      expect(decoded.x402Version).toBe(2);
      expect(decoded.scheme).toBe("exact");
      expect(decoded.network).toBe("eip155:56");
      expect(decoded.payload.permit2Authorization).toEqual({ foo: "bar" });
      expect(decoded.payload.signature).toBe("0xSig");
      expect(decoded.resource.url).toBe("https://api.test");
      expect(decoded.accepted.amount).toBe("100");
    });
  });

  describe("readSettlement", () => {
    it("reads tx hash and payer from payment-response header", () => {
      const headers = new Headers({
        "payment-response": btoa(JSON.stringify({
          transaction: "0xTxHash",
          payer: "0xPayer",
        })),
      });
      const res = { headers } as Response;
      const settlement = readSettlement(res);
      expect(settlement.txHash).toBe("0xTxHash");
      expect(settlement.payer).toBe("0xPayer");
    });

    it("reads tx hash and payer from response headers", () => {
      const headers = new Headers({
        "x-bsc-llm-router-tx": "0xTxHash",
        "x-bsc-llm-router-payer": "0xPayer",
      });
      const res = { headers } as Response;
      const settlement = readSettlement(res);
      expect(settlement.txHash).toBe("0xTxHash");
      expect(settlement.payer).toBe("0xPayer");
    });

    it("returns undefined when headers are missing", () => {
      const headers = new Headers();
      const res = { headers } as Response;
      const settlement = readSettlement(res);
      expect(settlement.txHash).toBeUndefined();
      expect(settlement.payer).toBeUndefined();
    });
  });

  describe("parseX402Response", () => {
    it("extracts requirements from accepts[0]", () => {
      const body = {
        x402Version: 2,
        resource: { url: "https://api.test" },
        accepts: [{
          scheme: "exact",
          network: "eip155:56",
          asset: "0xAsset",
          amount: "500",
          payTo: "0xPayTo",
          maxTimeoutSeconds: 600,
        }],
      };
      const { requirements, x402Version, resource } = parseX402Response(body);
      expect(requirements.network).toBe("eip155:56");
      expect(requirements.amount).toBe("500");
      expect(requirements.payTo).toBe("0xPayTo");
      expect(requirements.maxTimeoutSeconds).toBe(600);
      expect(x402Version).toBe(2);
      expect(resource).toEqual({ url: "https://api.test" });
    });

    it("throws when no accepts", () => {
      expect(() => parseX402Response({})).toThrow("No payment requirements");
      expect(() => parseX402Response({ accepts: [] })).toThrow("No payment requirements");
    });

    it("defaults x402Version to 2", () => {
      const { x402Version } = parseX402Response({
        accepts: [{ scheme: "exact", network: "eip155:56", asset: "0x", amount: "1", payTo: "0x" }],
      });
      expect(x402Version).toBe(2);
    });
  });

  describe("handleHttpX402", () => {
    function make402Response(body: unknown, paymentRequired: boolean = false): Response {
      const headers = new Headers();
      if (paymentRequired) {
        headers.set("payment-required", btoa(JSON.stringify(body)));
      }
      return {
        headers,
        json: () => Promise.resolve(body),
      } as Response;
    }

    function makeRetryResponse(
      status: number,
      settlement?: { txHash?: string; payer?: string; usePaymentResponse?: boolean },
    ): Response {
      const headers = new Headers();
      if (settlement?.usePaymentResponse && settlement.txHash) {
        headers.set("payment-response", btoa(JSON.stringify({
          transaction: settlement.txHash,
          payer: settlement.payer ?? "0xPayer",
        })));
      } else if (settlement?.txHash) {
        headers.set("x-bsc-llm-router-tx", settlement.txHash);
        headers.set("x-bsc-llm-router-payer", settlement.payer ?? "0xPayer");
      }
      return { status, headers, text: () => Promise.resolve("") } as Response;
    }

    const res402Body = {
      x402Version: 2,
      resource: { url: "https://api.test" },
      accepts: [{
        scheme: "exact",
        network: "eip155:56",
        asset: "0xAsset",
        amount: "1000",
        payTo: "0xPayTo",
      }],
    };

    it("signs, builds header, retries, reads settlement", async () => {
      const retryRes = makeRetryResponse(200, {
        txHash: "0xSettledTx",
        usePaymentResponse: true,
      });
      const retry = vi.fn().mockResolvedValue(retryRes);

      const result = await handleHttpX402(
        mockSigner,
        make402Response(res402Body, true),
        retry,
      );

      expect(result.success).toBe(true);
      expect(result.response).toBe(retryRes);
      expect(result.amount).toBe("1000");
      expect(result.settlement?.txHash).toBe("0xSettledTx");
      expect(result.settlement?.payer).toBe("0xPayer");

      // Verify retry was called with a base64 payment header
      expect(retry).toHaveBeenCalledOnce();
      const header = retry.mock.calls[0][0] as string;
      const decoded = JSON.parse(atob(header));
      expect(decoded.x402Version).toBe(2);
      expect(decoded.payload.signature).toBe("0xSIG_MOCK");
    });

    it("returns error when retry still returns 402", async () => {
      const retry = vi.fn().mockResolvedValue(makeRetryResponse(402));

      const result = await handleHttpX402(
        mockSigner,
        make402Response(res402Body, true),
        retry,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Payment rejected");
    });

    it("records spend when SpendManager provided", async () => {
      const retryRes = makeRetryResponse(200, {
        txHash: "0xSettledTx",
        usePaymentResponse: true,
      });
      const retry = vi.fn().mockResolvedValue(retryRes);
      const sm = new SpendManager({ dataDir: "/tmp" });
      const recordSpy = vi.spyOn(sm, "record");

      await handleHttpX402(
        mockSigner,
        make402Response(res402Body, true),
        retry,
        { manager: sm, category: "llm" },
      );

      expect(recordSpy).toHaveBeenCalledWith("llm", 1000n, "0xSettledTx");
    });

    it("does not record spend when no settlement txHash", async () => {
      const retryRes = makeRetryResponse(200); // no txHash header
      const retry = vi.fn().mockResolvedValue(retryRes);
      const sm = new SpendManager({ dataDir: "/tmp" });
      const recordSpy = vi.spyOn(sm, "record");

      await handleHttpX402(
        mockSigner,
        make402Response(res402Body, true),
        retry,
        { manager: sm, category: "llm" },
      );

      expect(recordSpy).not.toHaveBeenCalled();
    });

    it("falls back to response body when payment-required header is absent", async () => {
      const retry = vi.fn().mockResolvedValue(makeRetryResponse(200, { txHash: "0xLegacyTx" }));

      const result = await handleHttpX402(
        mockSigner,
        make402Response(res402Body, false),
        retry,
      );

      expect(result.success).toBe(true);
      expect(result.settlement?.txHash).toBe("0xLegacyTx");
    });
  });

  describe("handleX402Payment", () => {
    it("signs, builds header, passes to callback", async () => {
      const retryFn = vi.fn().mockResolvedValue({ ok: true });

      const result = await handleX402Payment(mockSigner, baseParams, retryFn);

      expect(result.success).toBe(true);
      expect(retryFn).toHaveBeenCalledOnce();
      // The callback receives a base64 payment header string
      const header = retryFn.mock.calls[0][0] as string;
      const decoded = JSON.parse(atob(header));
      expect(decoded.scheme).toBe("exact");
      expect(decoded.payload.signature).toBe("0xSIG_MOCK");
    });

    it("returns error on failure", async () => {
      const retryFn = vi.fn().mockRejectedValue(new Error("network error"));
      const result = await handleX402Payment(mockSigner, baseParams, retryFn);
      expect(result.success).toBe(false);
      expect(result.error).toContain("network error");
    });
  });
});
