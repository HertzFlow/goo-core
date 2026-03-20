import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentStatus } from "../../src/types.js";
import { makeChainState } from "../helpers/fixtures.js";

const pushSystemEventMock = vi.fn();
const pushWorkspaceRefreshMock = vi.fn();

vi.mock("../../src/autonomy/gateway-push.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/autonomy/gateway-push.js")>();
  return {
    ...actual,
    pushSystemEvent: pushSystemEventMock,
    pushWorkspaceRefresh: pushWorkspaceRefreshMock,
  };
});

const e2eHoisted = vi.hoisted(() => {
  const sandboxCheckMock = vi.fn();
  const sandboxLifecycleMock = {
    provider: "e2b",
    check: sandboxCheckMock,
  };

  const deadState = {
    status: 3, // AgentStatus.DEAD
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
    sandboxCheckMock,
    sandboxLifecycleMock,
    mockMonitorInstance: {
      init: vi.fn().mockResolvedValue(undefined),
      readState: vi.fn().mockResolvedValue(deadState),
      walletAddress: "0xMockWallet",
      setWalletAddress: vi.fn(),
      rpcProvider: {},
      tokenContract: {},
    },
  };
});

vi.mock("../../src/survival/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/survival/index.js")>();
  return {
    ...actual,
    ChainMonitor: vi.fn(() => e2eHoisted.mockMonitorInstance),
    // Don't open an HTTP server during unit/e2e tests.
    runInspectServer: vi.fn(),
    // Drive sandbox actions deterministically from the e2e sandboxCheckMock.
    createSandboxLifecycle: vi.fn(() => e2eHoisted.sandboxLifecycleMock),
  };
});

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn(() => ({ getBalance: vi.fn() })),
      Contract: vi.fn(() => ({
        agentWallet: vi.fn().mockResolvedValue("0xAgent"),
        WRAPPED_NATIVE: vi.fn().mockResolvedValue("0xWrappedNativeAddress"),
        swapExecutor: vi.fn().mockResolvedValue("0xSwapExecutorAddress"),
        emitPulse: vi.fn(),
        MAX_SELL_BPS_VALUE: vi.fn(),
        survivalSell: vi.fn(),
        PULSE_TIMEOUT_SECS: vi.fn().mockResolvedValue(172800),
      })),
      Wallet: vi.fn(function (this: { connect: () => unknown; getAddress: () => Promise<string>; address: string }) {
        this.connect = () => this;
        this.getAddress = () => Promise.resolve("0xMockWallet");
        this.address = "0xMockWallet";
        return this;
      }),
    },
  };
});

describe("goo-core E2E: sandbox + gateway push branches", () => {
  let dataDir: string;
  let walletDir: string;
  let envBackup: Record<string, string | undefined>;
  let workspaceDir: string;

  beforeEach(() => {
    pushSystemEventMock.mockClear();
    pushWorkspaceRefreshMock.mockClear();

    dataDir = mkdtempSync(join(tmpdir(), "goo-sandbox-gateway-e2e-"));
    walletDir = join(dataDir, "wallet");
    mkdirSync(walletDir, { recursive: true, mode: 0o700 });
    workspaceDir = join(dataDir, "workspace");

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
      SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
      SANDBOX_MANAGER_URL: process.env.SANDBOX_MANAGER_URL,
      OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL,
      OPENCLAW_GATEWAY_TOKEN: process.env.OPENCLAW_GATEWAY_TOKEN,
    };

    // Prevent auto-main execution; we call main() manually inside tests.
    process.env.VITEST = "true";
    process.env.RPC_URL = "https://bsc-dataseed.test.org";
    process.env.TOKEN_ADDRESS = "0x1111111111111111111111111111111111111111111111111111111111111111";
    process.env.AGENT_PRIVATE_KEY_FILE = join(walletDir, "private-key");
    process.env.LLM_API_KEY = "test-key";
    process.env.DATA_DIR = dataDir;
    process.env.WORKSPACE_DIR = workspaceDir;
    process.env.HEARTBEAT_INTERVAL_MS = "10"; // finish quickly

    // Enter the sandbox branch.
    process.env.SANDBOX_PROVIDER = "byod";
    vi.clearAllMocks();

    // First heartbeat ACTIVE, second heartbeat DEAD.
    e2eHoisted.mockMonitorInstance.readState
      .mockReset()
      .mockResolvedValueOnce(makeChainState({ status: AgentStatus.ACTIVE }))
      .mockResolvedValueOnce(makeChainState({ status: AgentStatus.DEAD, treasuryBalance: 0n, runwayHours: 0 }));

    // ACTIVE heartbeat: emitPulse is mocked as vi.fn() (undefined return), so pulse will fail and still produce an action.
    // Sandbox lifecycle: return a short remaining time so SurvivalManager pushes `Sandbox: ...`.
    e2eHoisted.sandboxCheckMock.mockReset().mockResolvedValue({
      provider: "e2b",
      healthy: true,
      status: "12min remaining",
      renewed: false,
      remainingSecs: 720,
    });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("main() includes sandbox lifecycle action in survival actions and initializes workspace", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const index = await import("../../src/index.js");
    const main = (index as { main?: () => Promise<void> }).main;
    if (!main) throw new Error("index.main not exported");

    await main();

    const logCalls = logSpy.mock.calls.flatMap((c) => c.map(String));
    expect(logCalls.some((s) => s.includes("[survival] Sandbox: 12min remaining"))).toBe(true);
    expect(existsSync(join(workspaceDir, "SOUL.md"))).toBe(true);
    expect(existsSync(join(workspaceDir, "TOOLS.md"))).toBe(true);

    logSpy.mockRestore();
  }, 15000);

  it("main() pushes heartbeat to gateway when OPENCLAW_GATEWAY_* are set", async () => {
    process.env.OPENCLAW_GATEWAY_URL = "http://127.0.0.1:19789";
    process.env.OPENCLAW_GATEWAY_TOKEN = "gw-token";

    const index = await import("../../src/index.js");
    const main = (index as { main?: () => Promise<void> }).main;
    if (!main) throw new Error("index.main not exported");

    await main();

    expect(pushSystemEventMock).toHaveBeenCalled();

    // Extract the pushed eventText payload.
    const texts: string[] = pushSystemEventMock.mock.calls.map((call) => String(call[1]));

    // We should see both ACTIVE and DEAD in pushed heartbeat events.
    expect(texts.some((t) => t.includes("Status=ACTIVE"))).toBe(true);
    expect(texts.some((t) => t.includes("Status=DEAD"))).toBe(true);
  }, 15000);
});

