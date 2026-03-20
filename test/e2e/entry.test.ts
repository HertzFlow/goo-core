import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentStatus } from "../../src/types.js";
import { makeChainState } from "../helpers/fixtures.js";

// Hoist so mock factory can reference them (vi.mock is hoisted). No imports inside hoisted.
const e2eHoisted = vi.hoisted(() => {
  const deadState = {
    status: 3 as const, // AgentStatus.DEAD
    treasuryBalance: 0n,
    starvingThreshold: 0n,
    fixedBurnRate: 0n,
    minRunwayHours: 0n,
    nativeBalance: 0n,
    tokenHoldings: 0n,
    totalSupply: 0n,
    lastPulseAt: 0n,
    starvingEnteredAt: 0n,
    dyingEnteredAt: 0n,
    runwayHours: 0,
  };
  return {
    mockMonitorInstance: {
      init: vi.fn().mockResolvedValue(undefined),
      readState: vi.fn().mockResolvedValue(deadState),
      walletAddress: "0xMockWallet",
      setWalletAddress: vi.fn(),
      rpcProvider: {},
      tokenContract: {},
    },
    mockToken: {
      agentWallet: vi.fn().mockResolvedValue("0xAgent"),
      WRAPPED_NATIVE: vi.fn().mockResolvedValue("0xWrappedNativeAddress"),
      swapExecutor: vi.fn().mockResolvedValue("0xSwapExecutorAddress"),
      emitPulse: vi.fn(),
      MAX_SELL_BPS_VALUE: vi.fn(),
      survivalSell: vi.fn(),
      PULSE_TIMEOUT_SECS: vi.fn().mockResolvedValue(172800),
    },
  };
});

describe("Entry process exit on missing config (E2E)", () => {
  it("exits with code 1 when RPC_URL missing (run after build)", async () => {
    const distIndex = join(process.cwd(), "dist", "index.js");
    if (!existsSync(distIndex)) {
      return; // skip when dist not built
    }
    const childEnv = { ...process.env, RPC_URL: "", TOKEN_ADDRESS: "", AGENT_PRIVATE_KEY_FILE: "", LLM_API_KEY: "" };
    delete childEnv.VITEST; // so child actually runs main() and hits loadConfig()
    return new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [distIndex], {
        env: childEnv,
        stdio: "pipe",
      });
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        if (code === 1) return resolve();
        reject(new Error(`Expected exit 1, got ${code}. stderr: ${stderr}`));
      });
      child.on("error", reject);
    });
  });
});

vi.mock("../../src/survival/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/survival/index.js")>();
  return {
    ...actual,
    ChainMonitor: vi.fn(() => e2eHoisted.mockMonitorInstance),
    runInspectServer: vi.fn(),
  };
});

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn(() => ({ getBalance: vi.fn() })),
      Contract: vi.fn(() => e2eHoisted.mockToken),
      Wallet: vi.fn(function (this: { connect: () => unknown; getAddress: () => Promise<string>; address: string }) {
        this.connect = () => this;
        this.getAddress = () => Promise.resolve("0xMockWallet");
        this.address = "0xMockWallet";
        return this;
      }),
    },
  };
});

describe("Full Core workflow E2E (main loop until DEAD)", () => {
  let dataDir: string;
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "goo-e2e-"));
    const walletDir = join(dataDir, "wallet");
    mkdirSync(walletDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(walletDir, "private-key"),
      "0x0000000000000000000000000000000000000000000000000000000000000001\n",
      { mode: 0o600 },
    );
    envBackup = {
      VITEST: process.env.VITEST,
      RPC_URL: process.env.RPC_URL,
      TOKEN_ADDRESS: process.env.TOKEN_ADDRESS,
      AGENT_PRIVATE_KEY_FILE: process.env.AGENT_PRIVATE_KEY_FILE,
      LLM_API_KEY: process.env.LLM_API_KEY,
      DATA_DIR: process.env.DATA_DIR,
      WORKSPACE_DIR: process.env.WORKSPACE_DIR,
    };
    process.env.VITEST = "true";
    process.env.RPC_URL = "https://bsc-dataseed.test.org";
    process.env.TOKEN_ADDRESS = "0x111111111111111111111111111111111111111111";
    process.env.AGENT_PRIVATE_KEY_FILE = join(walletDir, "private-key");
    process.env.LLM_API_KEY = "test-key";
    process.env.DATA_DIR = dataDir;
    process.env.WORKSPACE_DIR = join(dataDir, "workspace");
    process.env.HEARTBEAT_INTERVAL_MS = "10"; // short interval so multi-heartbeat E2E finishes quickly
    vi.clearAllMocks();
    e2eHoisted.mockMonitorInstance.readState.mockResolvedValue(makeChainState({ status: AgentStatus.DEAD }));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    Object.entries(envBackup).forEach(([k, v]) => {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    });
  });

  it("main() runs full workflow: loadConfig, init monitor/survival/behavior, one heartbeat (DEAD), then exits", async () => {
    const index = await import("../../src/index.js");
    const main = (index as { main?: () => Promise<void> }).main;
    if (!main) {
      throw new Error("index.main not exported");
    }
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main();

    expect(e2eHoisted.mockMonitorInstance.init).toHaveBeenCalled();
    expect(e2eHoisted.mockMonitorInstance.readState).toHaveBeenCalled();
    const logCalls = logSpy.mock.calls.flatMap((c) => c.map(String));
    expect(logCalls.some((s) => s.includes("Goo Agent is Dead") || s.includes("Core stopping"))).toBe(
      true
    );
    logSpy.mockRestore();
  });

  it("main() runs two heartbeats: first ACTIVE then DEAD, then exits (state transition)", async () => {
    const activeState = makeChainState({ status: AgentStatus.ACTIVE });
    const deadState = makeChainState({ status: AgentStatus.DEAD });
    e2eHoisted.mockMonitorInstance.readState
      .mockResolvedValueOnce(activeState)
      .mockResolvedValueOnce(deadState);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "OK" } }],
        }),
    });

    const index = await import("../../src/index.js");
    const main = (index as { main?: () => Promise<void> }).main;
    if (!main) throw new Error("index.main not exported");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main();

    expect(e2eHoisted.mockMonitorInstance.readState).toHaveBeenCalledTimes(2);
    const logCalls = logSpy.mock.calls.flatMap((c) => c.map(String));
    expect(logCalls.some((s) => s.includes("Goo Agent is Dead") || s.includes("Core stopping"))).toBe(
      true
    );
    logSpy.mockRestore();
  }, 15000);

  it("main() continues after heartbeat error: readState throws once then returns DEAD, then exits", async () => {
    const deadState = makeChainState({ status: AgentStatus.DEAD });
    e2eHoisted.mockMonitorInstance.readState.mockReset();
    e2eHoisted.mockMonitorInstance.readState
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce(deadState);

    const index = await import("../../src/index.js");
    const main = (index as { main?: () => Promise<void> }).main;
    if (!main) throw new Error("index.main not exported");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await main();

    expect(e2eHoisted.mockMonitorInstance.readState).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("Heartbeat failed"))).toBe(true);
    const logCalls = logSpy.mock.calls.flatMap((c) => c.map(String));
    expect(logCalls.some((s) => s.includes("Goo Agent is Dead") || s.includes("Core stopping"))).toBe(
      true
    );
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }, 15000);
});
