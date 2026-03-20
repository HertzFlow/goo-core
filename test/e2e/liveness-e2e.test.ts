import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { createInspectRequestListener, buildLivenessApiDeps } from "../../src/survival/index.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";
import { AgentStatus } from "../../src/types.js";

const mockReadState = vi.fn();
const mockMonitor = {
  readState: mockReadState,
  rpcProvider: {},
  walletAddress: "0xE2E",
};
const mockSurvival = { evaluate: vi.fn().mockResolvedValue([]) };

describe("Liveness E2E", () => {
  let server: import("node:http").Server;
  let baseUrl: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadState.mockResolvedValue(makeChainState({ status: AgentStatus.ACTIVE }));
  });

  afterEach(() => {
    if (server) server.close();
  });

  it("GET /liveness returns payload that passes Goo Agent verification", async () => {
    const deps = buildLivenessApiDeps(
      mockMonitor as never,
      mockSurvival as never,
      mockRuntimeConfig
    );
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

    const res = await fetch(`${baseUrl}/liveness`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as unknown;

    const isGooLiveness =
      typeof data === "object" &&
      data !== null &&
      (data as Record<string, unknown>).protocol === "goo" &&
      typeof (data as Record<string, unknown>).status === "string" &&
      typeof (data as Record<string, unknown>).lastPulseAt === "number";

    expect(isGooLiveness).toBe(true);
    expect((data as { protocol: string }).protocol).toBe("goo");
    expect((data as { status: string }).status).toBe("ACTIVE");
  });

  it("GET /inspect returns full inspection with lastSurvivalActions and threeLaws", async () => {
    const deps = buildLivenessApiDeps(
      mockMonitor as never,
      mockSurvival as never,
      mockRuntimeConfig
    );
    deps.lastSurvivalActions = ["Pulse sent (tx: 0xe2e)"];
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

    const res = await fetch(`${baseUrl}/inspect`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.protocol).toBe("goo");
    expect(data.liveness).toBeDefined();
    expect(data.liveness.status).toBe("ACTIVE");
    expect(data.survival.lastActions).toContain("Pulse sent (tx: 0xe2e)");
    expect(data.threeLaws).toBeDefined();
  });
});
