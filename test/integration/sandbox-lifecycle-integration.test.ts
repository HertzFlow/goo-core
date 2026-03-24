/**
 * Sandbox lifecycle ↔ sandbox-payment / fetch — provider branches and factory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  E2bSandboxLifecycle,
  AgosSandboxLifecycle,
  NoopSandboxLifecycle,
  createSandboxLifecycle,
} from "../../src/survival/sandbox-lifecycle.js";

const getSandboxStatus = vi.hoisted(() => vi.fn());
const renewSandbox = vi.hoisted(() => vi.fn());

vi.mock("../../src/finance/action/sandbox-payment.js", () => ({
  getSandboxStatus,
  renewSandbox,
  createSandbox: vi.fn(),
}));

function baseSandboxInfo(overrides: Partial<import("../../src/finance/action/sandbox-payment.js").SandboxInfo> = {}) {
  return {
    agentId: "agent-1",
    agentName: "Agent",
    sandboxId: "sbx-1",
    state: "running",
    domain: "example.test",
    chainStatus: "ok",
    totalSettledUsd: 0,
    ...overrides,
  };
}

describe("E2bSandboxLifecycle + sandbox-payment", () => {
  const signer = {} as import("ethers").Signer;

  beforeEach(() => {
    getSandboxStatus.mockReset();
    renewSandbox.mockReset();
  });

  it("returns healthy when running with plenty of time left", async () => {
    const endAt = new Date(Date.now() + 3_600_000).toISOString();
    getSandboxStatus.mockResolvedValue(baseSandboxInfo({ endAt }));
    const life = new E2bSandboxLifecycle("agent-1", signer, { managerUrl: "https://mgr.test" }, undefined, 600);
    const h = await life.check();
    expect(h.healthy).toBe(true);
    expect(h.renewed).toBe(false);
    expect(h.status).toMatch(/running/);
    expect(renewSandbox).not.toHaveBeenCalled();
  });

  it("returns healthy when running with no endAt", async () => {
    getSandboxStatus.mockResolvedValue(baseSandboxInfo({ endAt: undefined }));
    const life = new E2bSandboxLifecycle("agent-1", signer, { managerUrl: "https://mgr.test" });
    const h = await life.check();
    expect(h.healthy).toBe(true);
    expect(h.status).toContain("no expiry");
  });

  it("auto-renews when remaining time is below threshold", async () => {
    const endAt = new Date(Date.now() + 30_000).toISOString();
    getSandboxStatus.mockResolvedValue(baseSandboxInfo({ endAt }));
    renewSandbox.mockResolvedValue({ message: "ok" });
    const life = new E2bSandboxLifecycle("agent-1", signer, { managerUrl: "https://mgr.test" }, undefined, 600);
    const h = await life.check();
    expect(h.renewed).toBe(true);
    expect(h.healthy).toBe(true);
    expect(renewSandbox).toHaveBeenCalled();
  });

  it("returns unhealthy when renewal throws", async () => {
    const endAt = new Date(Date.now() + 20_000).toISOString();
    getSandboxStatus.mockResolvedValue(baseSandboxInfo({ endAt }));
    renewSandbox.mockRejectedValue(new Error("payment failed"));
    const life = new E2bSandboxLifecycle("agent-1", signer, { managerUrl: "https://mgr.test" }, undefined, 600);
    const h = await life.check();
    expect(h.renewed).toBe(false);
    expect(h.error).toContain("payment failed");
  });

  it("returns unhealthy when getSandboxStatus throws", async () => {
    getSandboxStatus.mockRejectedValue(new Error("network"));
    const life = new E2bSandboxLifecycle("agent-1", signer, { managerUrl: "https://mgr.test" });
    const h = await life.check();
    expect(h.healthy).toBe(false);
    expect(h.error).toBe("network");
  });

  it("returns unhealthy when sandbox not found (null)", async () => {
    getSandboxStatus.mockResolvedValue(null);
    const life = new E2bSandboxLifecycle("agent-1", signer, { managerUrl: "https://mgr.test" });
    const h = await life.check();
    expect(h.healthy).toBe(false);
    expect(h.status).toContain("not found");
  });

  it("returns unhealthy when state is not running", async () => {
    getSandboxStatus.mockResolvedValue(baseSandboxInfo({ state: "stopped" }));
    const life = new E2bSandboxLifecycle("agent-1", signer, { managerUrl: "https://mgr.test" });
    const h = await life.check();
    expect(h.healthy).toBe(false);
    expect(h.status).toContain("stopped");
  });
});

describe("AgosSandboxLifecycle + fetch", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns OK when balance above min", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { availableBalance: "100", frozenBalance: "0", spentTotal: "0" } }),
    }) as unknown as typeof fetch;
    const life = new AgosSandboxLifecycle({
      apiUrl: "https://api.test",
      agenterId: "ag-1",
      runtimeToken: "tok",
      minBalance: 10,
    });
    const h = await life.check();
    expect(h.healthy).toBe(true);
    expect(h.status).toContain("OK");
  });

  it("warns when balance below min but positive", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { availableBalance: "3", frozenBalance: "0", spentTotal: "0" } }),
    }) as unknown as typeof fetch;
    const life = new AgosSandboxLifecycle({
      apiUrl: "https://api.test",
      agenterId: "ag-1",
      runtimeToken: "tok",
      minBalance: 10,
    });
    const h = await life.check();
    expect(h.healthy).toBe(true);
    expect(h.status).toContain("low");
  });

  it("returns unhealthy when balance depleted", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { availableBalance: "0", frozenBalance: "0", spentTotal: "0" } }),
    }) as unknown as typeof fetch;
    const life = new AgosSandboxLifecycle({
      apiUrl: "https://api.test",
      agenterId: "ag-1",
      runtimeToken: "tok",
    });
    const h = await life.check();
    expect(h.healthy).toBe(false);
    expect(h.status).toContain("depleted");
  });

  it("returns unhealthy when fetch fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    }) as unknown as typeof fetch;
    const life = new AgosSandboxLifecycle({
      apiUrl: "https://api.test",
      agenterId: "ag-1",
      runtimeToken: "tok",
    });
    const h = await life.check();
    expect(h.healthy).toBe(false);
    expect(h.error).toBeDefined();
  });
});

describe("createSandboxLifecycle (env + params)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.SANDBOX_PROVIDER = process.env.SANDBOX_PROVIDER;
    saved.SANDBOX_MANAGER_URL = process.env.SANDBOX_MANAGER_URL;
    delete process.env.SANDBOX_PROVIDER;
    delete process.env.SANDBOX_MANAGER_URL;
  });

  afterEach(() => {
    if (saved.SANDBOX_PROVIDER === undefined) delete process.env.SANDBOX_PROVIDER;
    else process.env.SANDBOX_PROVIDER = saved.SANDBOX_PROVIDER;
    if (saved.SANDBOX_MANAGER_URL === undefined) delete process.env.SANDBOX_MANAGER_URL;
    else process.env.SANDBOX_MANAGER_URL = saved.SANDBOX_MANAGER_URL;
  });

  it("defaults to NoopSandboxLifecycle", () => {
    const life = createSandboxLifecycle({ agentId: "a" });
    expect(life).toBeInstanceOf(NoopSandboxLifecycle);
    expect(life.provider).toBe("none");
  });

  it("selects E2bSandboxLifecycle when e2b + manager URL + signer", () => {
    process.env.SANDBOX_PROVIDER = "e2b";
    const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const life = createSandboxLifecycle({
      agentId: "a",
      signer: {} as import("ethers").Signer,
      sandboxManagerUrl: "https://mgr",
    });
    expect(life).toBeInstanceOf(E2bSandboxLifecycle);
    warnSpy.mockRestore();
  });

  it("falls back to noop for e2b without manager URL", () => {
    process.env.SANDBOX_PROVIDER = "e2b";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const life = createSandboxLifecycle({ agentId: "a", signer: {} as import("ethers").Signer });
    expect(life).toBeInstanceOf(NoopSandboxLifecycle);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to noop for agos without agosConfig", () => {
    process.env.SANDBOX_PROVIDER = "agos";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const life = createSandboxLifecycle({ agentId: "a" });
    expect(life).toBeInstanceOf(NoopSandboxLifecycle);
    warnSpy.mockRestore();
  });

  it("selects AgosSandboxLifecycle when agos + agosConfig", () => {
    process.env.SANDBOX_PROVIDER = "agos";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const life = createSandboxLifecycle({
      agentId: "a",
      agosConfig: {
        apiUrl: "https://x",
        agenterId: "1",
        runtimeToken: "t",
      },
    });
    expect(life).toBeInstanceOf(AgosSandboxLifecycle);
    logSpy.mockRestore();
  });
});
