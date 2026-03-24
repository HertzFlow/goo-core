import { describe, it, expect } from "vitest";
import { buildLivenessPayload, collectAgentInspection } from "../../src/survival/status-collector.js";
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

  describe("collectAgentInspection", () => {
    const mockMonitor = {
      readState: async () => makeChainState(),
      rpcProvider: {},
      walletAddress: "0xMock",
    };

    it("returns full inspection with liveness, chain, survival, token, llm, threeLaws", () => {
      const state = makeChainState({ status: AgentStatus.ACTIVE });
      const survivalActions = ["Pulse sent (tx: 0xabc)"];
      const threeLaws = "## The Three Laws\n\nLaw I — Never Harm.";
      const payload = collectAgentInspection({
        chainState: state,
        survivalActions,
        config: mockRuntimeConfig,
        threeLaws,
        monitor: mockMonitor as never,
      });

      expect(payload.protocol).toBe("goo");
      expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(payload.liveness).toBeDefined();
      expect(payload.liveness.protocol).toBe("goo");
      expect(payload.liveness.status).toBe("ACTIVE");

      expect(payload.chain).toBeDefined();
      expect(payload.chain.status).toBe("ACTIVE");
      expect(typeof payload.chain.treasuryBalance).toBe("string");
      expect(typeof payload.chain.lastPulseAt).toBe("number");
      expect(typeof payload.chain.owner).toBe("string");
      expect(typeof payload.chain.paused).toBe("boolean");

      expect(payload.survival).toBeDefined();
      expect(payload.survival.lastActions).toEqual(survivalActions);
      expect(typeof payload.survival.gasWarning).toBe("boolean");

      expect(payload.token).toBeDefined();
      expect(payload.token.address).toBe(mockRuntimeConfig.tokenAddress);
      expect(typeof payload.token.holdings).toBe("string");
      expect(typeof payload.token.totalSupply).toBe("string");

      expect(payload.llm).toBeDefined();
      expect(payload.llm.model).toBe(mockRuntimeConfig.llmModel);
      expect(payload.llm.via).toBe("openclaw");

      expect(payload.threeLaws).toBe(threeLaws);
    });

    it("sets survival.gasWarning when native balance below minGasBalance", () => {
      const state = makeChainState({
        nativeBalance: BigInt("1000000000000000"),
      });
      const configWithHighMin = { ...mockRuntimeConfig, minGasBalance: BigInt("10000000000000000") };
      const payload = collectAgentInspection({
        chainState: state,
        survivalActions: [],
        config: configWithHighMin,
        threeLaws: "",
        monitor: mockMonitor as never,
      });
      expect(payload.survival.gasWarning).toBe(true);
    });

    it("sets survival.gasWarning false when native balance above min", () => {
      const state = makeChainState({
        nativeBalance: BigInt("50000000000000000000"),
      });
      const payload = collectAgentInspection({
        chainState: state,
        survivalActions: [],
        config: mockRuntimeConfig,
        threeLaws: "",
        monitor: mockMonitor as never,
      });
      expect(payload.survival.gasWarning).toBe(false);
    });

    it("uses empty lastActions when survivalActions is empty", () => {
      const state = makeChainState();
      const payload = collectAgentInspection({
        chainState: state,
        survivalActions: [],
        config: mockRuntimeConfig,
        threeLaws: "",
        monitor: mockMonitor as never,
      });
      expect(payload.survival.lastActions).toEqual([]);
    });
  });
});
