import { describe, it, expect } from "vitest";
import { buildLivenessPayload } from "../../src/survival/status-collector.js";
import { AgentStatus } from "../../src/types.js";
import { makeChainState, mockRuntimeConfig } from "../helpers/fixtures.js";

describe("status-collector", () => {
  describe("buildLivenessPayload", () => {
    it("returns goo protocol and status from chain state", () => {
      const state = makeChainState({ status: AgentStatus.ACTIVE });
      const payload = buildLivenessPayload(state, {
        tokenAddress: mockRuntimeConfig.tokenAddress,
        chainId: mockRuntimeConfig.chainId,
      });
      expect(payload.protocol).toBe("goo");
      expect(payload.status).toBe("ACTIVE");
      expect(payload.tokenAddress).toBe(mockRuntimeConfig.tokenAddress);
      expect(payload.chainId).toBe(mockRuntimeConfig.chainId);
      expect(typeof payload.lastPulseAt).toBe("number");
      expect(typeof payload.treasuryBalanceUsd).toBe("string");
      expect(typeof payload.runwayHours).toBe("number");
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("formats treasury balance as BNB (18 decimals)", () => {
      const state = makeChainState({
        treasuryBalance: BigInt("1500000000000000000"),
      });
      const payload = buildLivenessPayload(state, {
        tokenAddress: mockRuntimeConfig.tokenAddress,
        chainId: mockRuntimeConfig.chainId,
      });
      expect(payload.treasuryBalanceUsd).toBe("1.5");
    });

    it("reflects DEAD status", () => {
      const state = makeChainState({ status: AgentStatus.DEAD });
      const payload = buildLivenessPayload(state, {
        tokenAddress: mockRuntimeConfig.tokenAddress,
        chainId: mockRuntimeConfig.chainId,
      });
      expect(payload.status).toBe("DEAD");
    });

    it("reflects STARVING and DYING status", () => {
      for (const status of [AgentStatus.STARVING, AgentStatus.DYING]) {
        const state = makeChainState({ status });
        const payload = buildLivenessPayload(state, {
          tokenAddress: mockRuntimeConfig.tokenAddress,
          chainId: mockRuntimeConfig.chainId,
        });
        expect(payload.status).toBe(AgentStatus[status]);
      }
    });
  });

});
