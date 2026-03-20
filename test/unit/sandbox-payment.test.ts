import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpendManager } from "../../src/finance/spend.js";
import {
  createSandbox,
  getSandboxStatus,
  renewSandbox,
  testCreateSandbox,
} from "../../src/finance/action/sandbox-payment.js";

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

describe("sandbox-payment", () => {
  const config = { managerUrl: "https://manager.test/" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createSandbox returns direct success response without x402 retry", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({
        agentId: "agent-1",
        sandboxId: "sbx_123",
        domain: "agent.example.com",
      }),
    });

    const result = await createSandbox(mockSigner, config, { agentId: "agent-1" });

    expect(result.sandboxId).toBe("sbx_123");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("createSandbox handles x402 payment retry with x-payment header", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        headers: new Headers({
          "payment-required": btoa(JSON.stringify({
            x402Version: 2,
            accepts: [{
              scheme: "exact",
              network: "eip155:56",
              asset: "0xAsset",
              amount: "1000",
              payTo: "0xPayTo",
            }],
          })),
        }),
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({
          "payment-response": btoa(JSON.stringify({
            transaction: "0xSettledTx",
            payer: "0xSignerAddress",
          })),
        }),
        json: () => Promise.resolve({
          agentId: "agent-1",
          sandboxId: "sbx_paid",
          domain: "agent.example.com",
        }),
      });

    const spendManager = new SpendManager({ dataDir: "/tmp" });
    const recordSpy = vi.spyOn(spendManager, "record");
    const result = await createSandbox(
      mockSigner,
      config,
      { agentId: "agent-1", walletPrivateKey: "0xabc" },
      spendManager,
    );

    expect(result.sandboxId).toBe("sbx_paid");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const retryHeaders = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]?.headers as Record<string, string>;
    expect(retryHeaders["x-payment"]).toBeTypeOf("string");
    expect(recordSpy).toHaveBeenCalledWith("other", 1000n, "0xSettledTx");
  });

  it("testCreateSandbox calls test endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        agentId: "agent-1",
        sandboxId: "sbx_test",
        domain: "agent.example.com",
      }),
    });

    const result = await testCreateSandbox(config, { agentId: "agent-1" });

    expect(result.sandboxId).toBe("sbx_test");
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "https://manager.test/api/v1/sandboxes/test-create",
    );
  });

  it("renewSandbox retries through x402 and returns response body", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        headers: new Headers({
          "payment-required": btoa(JSON.stringify({
            x402Version: 2,
            accepts: [{
              scheme: "exact",
              network: "eip155:56",
              asset: "0xAsset",
              amount: "2000",
              payTo: "0xPayTo",
            }],
          })),
        }),
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          "payment-response": btoa(JSON.stringify({
            transaction: "0xRenewTx",
            payer: "0xSignerAddress",
          })),
        }),
        json: () => Promise.resolve({ message: "renewed" }),
      });

    const result = await renewSandbox(mockSigner, config, "agent-1");

    expect(result.message).toBe("renewed");
    const retryHeaders = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1]?.headers as Record<string, string>;
    expect(retryHeaders["x-payment"]).toBeTypeOf("string");
  });

  it("getSandboxStatus returns null on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(getSandboxStatus(config, "missing")).resolves.toBeNull();
  });
});
