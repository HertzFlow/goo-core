import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInspectRequestListener, buildLivenessApiDeps } from "../../src/survival/liveness-api.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";
import { AgentStatus } from "../../src/types.js";

const mockReadState = vi.fn();
const mockMonitor = {
  readState: mockReadState,
  rpcProvider: {},
  walletAddress: "0xMock",
};
const mockSurvival = {
  evaluate: vi.fn().mockResolvedValue([]),
};
const getThreeLaws = vi.fn().mockReturnValue("## The Three Laws\n\nLaw I.");

function createMockReq(method: string, url: string): import("node:http").IncomingMessage {
  return { method, url } as import("node:http").IncomingMessage;
}

function createMockRes() {
  const writeHead = vi.fn();
  const end = vi.fn();
  return {
    res: { writeHead, end } as unknown as import("node:http").ServerResponse,
    writeHead,
    end,
  };
}

describe("liveness-api", () => {
  const deps = {
    monitor: mockMonitor as never,
    survival: mockSurvival as never,
    config: mockRuntimeConfig,
    getThreeLaws,
    lastSurvivalActions: ["Pulse sent (tx: 0x1)"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadState.mockResolvedValue(makeChainState({ status: AgentStatus.ACTIVE }));
    getThreeLaws.mockReturnValue("## The Three Laws");
  });

  describe("createInspectRequestListener", () => {
    it("GET /liveness returns 200 and JSON liveness payload", async () => {
      const listener = createInspectRequestListener(deps);
      const { res, writeHead, end } = createMockRes();
      await listener(createMockReq("GET", "/liveness"), res);

      expect(mockReadState).toHaveBeenCalled();
      expect(writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      expect(end).toHaveBeenCalledTimes(1);
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.protocol).toBe("goo");
      expect(body.status).toBe("ACTIVE");
      expect(typeof body.lastPulseAt).toBe("number");
      expect(body.tokenAddress).toBe(mockRuntimeConfig.tokenAddress);
      expect(body.chainId).toBe(mockRuntimeConfig.chainId);
    });

    it("GET /liveness/ (trailing slash) returns liveness", async () => {
      const listener = createInspectRequestListener(deps);
      const { res, writeHead, end } = createMockRes();
      await listener(createMockReq("GET", "/liveness/"), res);
      expect(writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.protocol).toBe("goo");
    });

    it("GET /inspect returns 200 and full inspection payload", async () => {
      const listener = createInspectRequestListener(deps);
      const { res, writeHead, end } = createMockRes();
      await listener(createMockReq("GET", "/inspect"), res);

      expect(mockReadState).toHaveBeenCalled();
      expect(getThreeLaws).toHaveBeenCalled();
      expect(writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.protocol).toBe("goo");
      expect(body.liveness).toBeDefined();
      expect(body.liveness.status).toBe("ACTIVE");
      expect(body.chain).toBeDefined();
      expect(body.survival).toBeDefined();
      expect(body.survival.lastActions).toEqual(["Pulse sent (tx: 0x1)"]);
      expect(body.token).toBeDefined();
      expect(body.llm).toBeDefined();
      expect(body.threeLaws).toBe("## The Three Laws");
    });

    it("GET /inspect uses lastSurvivalActions from deps", async () => {
      const listener = createInspectRequestListener({ ...deps, lastSurvivalActions: ["Action A"] });
      const { res, end } = createMockRes();
      await listener(createMockReq("GET", "/inspect"), res);
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.survival.lastActions).toEqual(["Action A"]);
    });

    it("GET /inspect uses empty lastActions when lastSurvivalActions not set", async () => {
      const depsNoActions = { ...deps };
      delete (depsNoActions as { lastSurvivalActions?: string[] }).lastSurvivalActions;
      const listener = createInspectRequestListener(depsNoActions);
      const { res, end } = createMockRes();
      await listener(createMockReq("GET", "/inspect"), res);
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.survival.lastActions).toEqual([]);
    });

    it("non-GET returns 405", async () => {
      const listener = createInspectRequestListener(deps);
      const { res, writeHead, end } = createMockRes();
      await listener(createMockReq("POST", "/liveness"), res);
      expect(writeHead).toHaveBeenCalledWith(405, { "Content-Type": "application/json" });
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.error).toBe("Method not allowed");
    });

    it("unknown path returns 404 with paths hint", async () => {
      const listener = createInspectRequestListener(deps);
      const { res, writeHead, end } = createMockRes();
      await listener(createMockReq("GET", "/unknown"), res);
      expect(writeHead).toHaveBeenCalledWith(404, { "Content-Type": "application/json" });
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.error).toBe("Not found");
      expect(body.paths).toEqual(["/liveness", "/inspect"]);
    });

    it("when monitor.readState throws returns 500", async () => {
      mockReadState.mockRejectedValueOnce(new Error("RPC down"));
      const listener = createInspectRequestListener(deps);
      const { res, writeHead, end } = createMockRes();
      await listener(createMockReq("GET", "/liveness"), res);
      expect(writeHead).toHaveBeenCalledWith(500, { "Content-Type": "application/json" });
      const body = JSON.parse(end.mock.calls[0][0]);
      expect(body.error).toBe("Internal error");
      expect(body.message).toContain("RPC down");
    });
  });

  describe("buildLivenessApiDeps", () => {
    it("returns deps with getThreeLaws from SoulManager", () => {
      const built = buildLivenessApiDeps(
        mockMonitor as never,
        mockSurvival as never,
        mockRuntimeConfig
      );
      expect(built.monitor).toBe(mockMonitor);
      expect(built.survival).toBe(mockSurvival);
      expect(built.config).toBe(mockRuntimeConfig);
      expect(typeof built.getThreeLaws).toBe("function");
      expect(built.getThreeLaws().length).toBeGreaterThan(0);
    });
  });
});
