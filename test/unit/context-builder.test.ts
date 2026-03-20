import { describe, it, expect } from "vitest";
import { buildHeartbeatContext } from "../../src/autonomy/context-builder.js";
import { AgentStatus, type ChainState, type Observation } from "../../src/types.js";
import { makeChainState } from "../helpers/fixtures.js";

describe("buildHeartbeatContext", () => {
  it("includes On-Chain Status for ACTIVE", () => {
    const state = makeChainState({ status: AgentStatus.ACTIVE, runwayHours: 100 });
    const out = buildHeartbeatContext(state, [], []);
    expect(out).toContain("On-Chain Status");
    expect(out).toContain("ACTIVE");
    expect(out).toContain("Treasury Balance");
    expect(out).toContain("Runway");
    expect(out).not.toContain("⚠ Starving");
    expect(out).not.toContain("🚨 Dying");
  });

  it("includes Treasury Balance in BNB format", () => {
    const state = makeChainState({
      treasuryBalance: BigInt("1500000000000000000"), // 1.5 BNB
    });
    const out = buildHeartbeatContext(state, [], []);
    expect(out).toContain("Treasury Balance");
    expect(out).toContain("BNB");
    expect(out).toContain("1.5");
  });

  it("includes Starving section when STARVING", () => {
    const state = makeChainState({ status: AgentStatus.STARVING });
    const out = buildHeartbeatContext(state, [], []);
    expect(out).toContain("⚠ Starving");
    expect(out).toContain("STARVING_GRACE_PERIOD");
  });

  it("includes Dying section when DYING", () => {
    const state = makeChainState({ status: AgentStatus.DYING });
    const out = buildHeartbeatContext(state, [], []);
    expect(out).toContain("🚨 Dying");
    expect(out).toContain("Successor (CTO)");
  });

  it("includes Runway Alert when ACTIVE and runway < 72", () => {
    const state = makeChainState({ status: AgentStatus.ACTIVE, runwayHours: 48 });
    const out = buildHeartbeatContext(state, [], []);
    expect(out).toContain("Runway Alert");
    expect(out).toContain("48");
  });

  it("includes MAINTENANCE LOOP WARNING when most recent commands are df/free/ps", () => {
    const state = makeChainState();
    const obs: Observation[] = [
      {
        heartbeat: 1,
        timestamp: new Date().toISOString(),
        status: AgentStatus.ACTIVE,
        balanceUsd: 10,
        runwayHours: 24,
        summary: "",
        toolsCalled: ["shell_execute"],
        shellCommands: ["df -h"],
      },
      {
        heartbeat: 2,
        timestamp: new Date().toISOString(),
        status: AgentStatus.ACTIVE,
        balanceUsd: 10,
        runwayHours: 24,
        summary: "",
        toolsCalled: ["shell_execute"],
        shellCommands: ["free -m"],
      },
      {
        heartbeat: 3,
        timestamp: new Date().toISOString(),
        status: AgentStatus.ACTIVE,
        balanceUsd: 10,
        runwayHours: 24,
        summary: "",
        toolsCalled: ["shell_execute"],
        shellCommands: ["ps aux"],
      },
    ];
    const out = buildHeartbeatContext(state, obs, []);
    expect(out).toContain("MAINTENANCE LOOP WARNING");
    expect(out).toContain("df/free/ps");
  });

  it("includes Survival Actions when provided", () => {
    const state = makeChainState();
    const actions = ["Pulse sent (tx: 0xabc)", "SurvivalSell executed"];
    const out = buildHeartbeatContext(state, [], actions);
    expect(out).toContain("Survival Actions");
    expect(out).toContain("Pulse sent");
    expect(out).toContain("SurvivalSell executed");
  });

  it("includes Recent Activity when recentObservations provided", () => {
    const state = makeChainState();
    const obs: Observation[] = [
      {
        heartbeat: 1,
        timestamp: "2026-03-05T12:00:00.000Z",
        status: AgentStatus.ACTIVE,
        balanceUsd: 15.5,
        runwayHours: 24,
        summary: "",
        toolsCalled: ["read_chain_state"],
        shellCommands: [],
      },
    ];
    const out = buildHeartbeatContext(state, obs, []);
    expect(out).toContain("Recent Activity");
    expect(out).toContain("15.5000");
  });

  it("includes This Heartbeat prompt", () => {
    const state = makeChainState();
    const out = buildHeartbeatContext(state, [], []);
    expect(out).toContain("This Heartbeat");
    expect(out).toContain("Verified Output");
  });

  it("truncates long observation summary in Recent Activity", () => {
    const state = makeChainState();
    const longSummary = "s".repeat(250);
    const obs: Observation[] = [
      {
        heartbeat: 1,
        timestamp: "2026-03-05T12:00:00.000Z",
        status: AgentStatus.ACTIVE,
        balanceUsd: 1,
        runwayHours: 10,
        summary: longSummary,
        toolsCalled: [],
        shellCommands: [],
      },
    ];
    const out = buildHeartbeatContext(state, obs, []);
    expect(out).toContain("summary:");
    expect(out).toContain("...");
    expect(out).not.toContain(longSummary);
  });
});
