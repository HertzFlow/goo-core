import { describe, it, expect, vi, beforeEach } from "vitest";
import { payBill, getPendingBills, payPendingBills } from "../../src/finance/action/pay-bills.js";

const handleX402Payment = vi.hoisted(() => vi.fn());

vi.mock("../../src/finance/action/x402.js", () => ({
  handleX402Payment,
}));

describe("pay-bills", () => {
  beforeEach(() => {
    handleX402Payment.mockReset();
  });

  it("getPendingBills returns empty array", async () => {
    await expect(getPendingBills()).resolves.toEqual([]);
  });

  it("payBill returns failure when handleX402Payment fails", async () => {
    handleX402Payment.mockResolvedValue({ success: false, error: "no funds" });
    const signer = {} as never;
    const retry = vi.fn();
    const out = await payBill(
      signer,
      {
        service: "hosting",
        payment: { network: "eip155:97" } as never,
      },
      retry,
    );
    expect(out.paid).toBe(false);
    expect(out.error).toBe("no funds");
  });

  it("payBill returns paid true on success", async () => {
    handleX402Payment.mockResolvedValue({ success: true, response: { ok: true } });
    const signer = {} as never;
    const retry = vi.fn().mockResolvedValue({});
    const out = await payBill(
      signer,
      { service: "api", payment: { network: "eip155:97" } as never },
      retry,
    );
    expect(out.paid).toBe(true);
    expect(out.result?.success).toBe(true);
  });

  it("payPendingBills yields no results when no pending bills", async () => {
    const signer = {} as never;
    const retry = vi.fn();
    const results = await payPendingBills(signer, retry);
    expect(results).toEqual([]);
    expect(handleX402Payment).not.toHaveBeenCalled();
  });

  it("payPendingBills pays each bill when bills option is provided", async () => {
    const bills = [
      { service: "hosting", payment: { network: "eip155:97" } as never },
      { service: "api", payment: { network: "eip155:97" } as never },
    ];
    handleX402Payment.mockResolvedValue({ success: true, response: {} });
    const signer = {} as never;
    const results = await payPendingBills(signer, vi.fn().mockResolvedValue({}), { bills });
    expect(results).toHaveLength(2);
    expect(results[0]?.paid).toBe(true);
    expect(results[1]?.paid).toBe(true);
    expect(handleX402Payment).toHaveBeenCalledTimes(2);
  });
});
