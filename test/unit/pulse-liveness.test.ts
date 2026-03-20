import { describe, it, expect } from "vitest";
import { getLivenessPayload } from "../../src/survival/pulse.js";
import { AgentStatus } from "../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";

describe("pulse getLivenessPayload", () => {
  it("returns same shape as buildLivenessPayload (re-export)", () => {
    const state = makeChainState({ status: AgentStatus.ACTIVE });
    const payload = getLivenessPayload(state, {
      tokenAddress: mockRuntimeConfig.tokenAddress,
      chainId: mockRuntimeConfig.chainId,
    });
    expect(payload.protocol).toBe("goo");
    expect(payload.status).toBe("ACTIVE");
    expect(typeof payload.lastPulseAt).toBe("number");
    expect(payload.tokenAddress).toBe(mockRuntimeConfig.tokenAddress);
    expect(payload.chainId).toBe(mockRuntimeConfig.chainId);
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
