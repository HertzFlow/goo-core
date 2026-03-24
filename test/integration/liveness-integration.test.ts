import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import {
  ChainMonitor,
  SurvivalManager,
  createInspectRequestListener,
  buildLivenessApiDeps,
} from "../../src/survival/index.js";
import { AgentStatus } from "../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";

const mockToken = {
  agentWallet: vi.fn().mockResolvedValue("0xAgent"),
  getAgentStatus: vi.fn(),
  treasuryBalance: vi.fn(),
  starvingThreshold: vi.fn(),
  dyingThreshold: vi.fn(),
  owner: vi.fn(),
  paused: vi.fn(),
  lastPulseAt: vi.fn(),
  starvingEnteredAt: vi.fn(),
  dyingEnteredAt: vi.fn(),
  totalSupply: vi.fn(),
  balanceOf: vi.fn(),
  emitPulse: vi.fn(),
  MAX_SELL_BPS_VALUE: vi.fn(),
  survivalSell: vi.fn(),
  PULSE_TIMEOUT_SECS: vi.fn().mockResolvedValue(172800),
};
const mockProvider = { getBalance: vi.fn() };

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn(() => mockProvider),
      Contract: vi.fn(() => mockToken),
      Wallet: vi.fn(function (this: { connect: () => unknown; getAddress: () => Promise<string>; address: string }) {
        this.connect = () => this;
        this.getAddress = () => Promise.resolve("0xMockWallet");
        this.address = "0xMockWallet";
        return this;
      }),
    },
  };
});

describe("Liveness / Inspect API integration", () => {
  let server: import("node:http").Server;
  let baseUrl: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToken.agentWallet.mockResolvedValue("0xAgent");
    mockToken.getAgentStatus.mockResolvedValue(AgentStatus.ACTIVE);
    mockToken.treasuryBalance.mockResolvedValue(BigInt("1500000000000000000"));
    mockToken.starvingThreshold.mockResolvedValue(BigInt("1000000000000000000"));
    mockToken.dyingThreshold.mockResolvedValue(BigInt("20000000000000000"));
    mockToken.owner.mockResolvedValue("0x0000000000000000000000000000000000000001");
    mockToken.paused.mockResolvedValue(false);
    mockToken.lastPulseAt.mockResolvedValue(BigInt(Math.floor(Date.now() / 1000) - 3600));
    mockToken.starvingEnteredAt.mockResolvedValue(0n);
    mockToken.dyingEnteredAt.mockResolvedValue(0n);
    mockToken.totalSupply.mockResolvedValue(BigInt("10000000000000000000000"));
    mockToken.balanceOf.mockResolvedValue(BigInt("1000000000000000000000"));
    mockProvider.getBalance.mockResolvedValue(BigInt("50000000000000000000"));
    mockToken.emitPulse.mockResolvedValue({ hash: "0xp", wait: () => Promise.resolve({}) });
    mockToken.MAX_SELL_BPS_VALUE.mockResolvedValue(5000);
    mockToken.survivalSell.mockResolvedValue({ wait: () => Promise.resolve({ hash: "0xs" }) });
  });

  afterEach(() => {
    if (server) server.close();
  });

  async function startServer(): Promise<void> {
    const monitor = new ChainMonitor(mockRuntimeConfig);
    await monitor.init();
    const survival = new SurvivalManager(monitor as never, mockRuntimeConfig, { getAddress: () => Promise.resolve("0xMockWallet") } as never);
    const deps = buildLivenessApiDeps(monitor as never, survival as never, mockRuntimeConfig);
    deps.lastSurvivalActions = ["Pulse sent (tx: 0xp)"];
    const listener = createInspectRequestListener(deps);
    server = createServer((req, res) => {
      listener(req, res).catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  it("GET /liveness returns valid goo liveness payload", async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/liveness`);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data.protocol).toBe("goo");
    expect(data.status).toBe("ACTIVE");
    expect(typeof data.lastPulseAt).toBe("number");
    expect(data.tokenAddress).toBe(mockRuntimeConfig.tokenAddress);
    expect(data.chainId).toBe(mockRuntimeConfig.chainId);
    expect(data.treasuryBalanceUsd).toBeDefined();
    expect(typeof data.runwayHours).toBe("number");
    expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("GET /inspect is not supported and returns 404", async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/inspect`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
    expect(data.paths).toEqual(["/liveness"]);
  });

  it("GET /liveness validates as Goo Agent (protocol + status + lastPulseAt)", async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/liveness`);
    const data = await res.json();
    expect(data.protocol).toBe("goo");
    expect(typeof data.status).toBe("string");
    expect(typeof data.lastPulseAt).toBe("number");
  });

  it("GET unknown path returns 404", async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Not found");
  });

  it("POST /liveness returns 405", async () => {
    await startServer();
    const res = await fetch(`${baseUrl}/liveness`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
