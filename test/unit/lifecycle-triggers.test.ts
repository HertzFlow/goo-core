import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateLifecycleTriggers } from "../../src/survival/lifecycle-triggers.js";
import { AgentStatus } from "../../src/types.js";
import { makeChainState } from "../helpers/fixtures.js";

const staticCallMock = vi.fn();
const triggerLifecycleMock = Object.assign(vi.fn(), { staticCall: staticCallMock });

const mockContract = {
  triggerLifecycle: triggerLifecycleMock,
};

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ethers")>();
  return {
    ethers: {
      ...actual.ethers,
      Contract: vi.fn(() => mockContract),
    },
  };
});

const mockDeps = {
  tokenAddress: "0x1111111111111111111111111111111111111111",
  signer: {} as any,
};

function txResult(hash = "0xabc") {
  return { hash, wait: () => Promise.resolve({ hash }) };
}

describe("evaluateLifecycleTriggers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when staticCall returns 0 (no-op)", async () => {
    staticCallMock.mockResolvedValue(0n);
    const state = makeChainState({ status: AgentStatus.ACTIVE });
    const result = await evaluateLifecycleTriggers(state, mockDeps);
    expect(result).toBeNull();
    expect(triggerLifecycleMock).not.toHaveBeenCalled();
  });

  it("executes recovery (action=1)", async () => {
    staticCallMock.mockResolvedValue(1n);
    triggerLifecycleMock.mockResolvedValue(txResult("0xrec"));
    const state = makeChainState({ status: AgentStatus.STARVING });
    const result = await evaluateLifecycleTriggers(state, mockDeps);
    expect(result).toContain("triggerRecovery");
    expect(result).toContain("ACTIVE");
    expect(result).toContain("0xrec");
    expect(triggerLifecycleMock).toHaveBeenCalledOnce();
  });

  it("executes starving (action=2)", async () => {
    staticCallMock.mockResolvedValue(2n);
    triggerLifecycleMock.mockResolvedValue(txResult("0xstarv"));
    const state = makeChainState({ status: AgentStatus.ACTIVE });
    const result = await evaluateLifecycleTriggers(state, mockDeps);
    expect(result).toContain("triggerStarving");
    expect(result).toContain("STARVING");
  });

  it("executes dying (action=3)", async () => {
    staticCallMock.mockResolvedValue(3n);
    triggerLifecycleMock.mockResolvedValue(txResult("0xdying"));
    const state = makeChainState({ status: AgentStatus.STARVING });
    const result = await evaluateLifecycleTriggers(state, mockDeps);
    expect(result).toContain("triggerDying");
    expect(result).toContain("DYING");
  });

  it("executes dead (action=4)", async () => {
    staticCallMock.mockResolvedValue(4n);
    triggerLifecycleMock.mockResolvedValue(txResult("0xdead"));
    const state = makeChainState({ status: AgentStatus.DYING });
    const result = await evaluateLifecycleTriggers(state, mockDeps);
    expect(result).toContain("triggerDead");
    expect(result).toContain("DEAD");
  });

  it("returns null when staticCall reverts", async () => {
    staticCallMock.mockRejectedValue(new Error("revert"));
    const state = makeChainState({ status: AgentStatus.ACTIVE });
    const result = await evaluateLifecycleTriggers(state, mockDeps);
    expect(result).toBeNull();
  });

  it("returns null when tx send fails", async () => {
    staticCallMock.mockResolvedValue(2n);
    triggerLifecycleMock.mockRejectedValue(new Error("tx failed"));
    const state = makeChainState({ status: AgentStatus.ACTIVE });
    const result = await evaluateLifecycleTriggers(state, mockDeps);
    expect(result).toBeNull();
  });
});
