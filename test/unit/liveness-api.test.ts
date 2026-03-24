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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadState.mockResolvedValue(makeChainState({ status: AgentStatus.ACTIVE }));
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
      expect(body.paths).toEqual(["/liveness"]);
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
    it("returns deps with monitor, survival, and config", () => {
      const built = buildLivenessApiDeps(
        mockMonitor as never,
        mockSurvival as never,
        mockRuntimeConfig
      );
      expect(built.monitor).toBe(mockMonitor);
      expect(built.survival).toBe(mockSurvival);
      expect(built.config).toBe(mockRuntimeConfig);
    });
  });
});
