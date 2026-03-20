import { describe, it, expect } from "vitest";
import { AgentStatus } from "../../src/types.js";

describe("AgentStatus", () => {
  it("has ACTIVE = 0", () => {
    expect(AgentStatus.ACTIVE).toBe(0);
  });
  it("has STARVING = 1", () => {
    expect(AgentStatus.STARVING).toBe(1);
  });
  it("has DYING = 2", () => {
    expect(AgentStatus.DYING).toBe(2);
  });
  it("has DEAD = 3", () => {
    expect(AgentStatus.DEAD).toBe(3);
  });
  it("AgentStatus[status] gives name", () => {
    expect(AgentStatus[AgentStatus.ACTIVE]).toBe("ACTIVE");
    expect(AgentStatus[AgentStatus.DEAD]).toBe("DEAD");
  });
});
