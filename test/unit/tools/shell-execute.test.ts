import { describe, it, expect } from "vitest";
import { shellExecuteTool } from "../../../src/tools/shell-execute.js";
import { makeChainState } from "../../helpers/fixtures.js";

describe("shell_execute tool", () => {
  const ctx = { chainState: makeChainState(), config: {} as never, dataDir: "/tmp" };

  it("returns Error when command is empty", async () => {
    const out = await shellExecuteTool.execute({ command: "" }, ctx);
    expect(out).toContain("Error");
    expect(out).toContain("command");
  });

  it("returns Error when command is not string", async () => {
    const out = await shellExecuteTool.execute({ command: 123 }, ctx);
    expect(out).toContain("Error");
  });

  it("returns stdout for successful command", async () => {
    const out = await shellExecuteTool.execute({ command: "echo hello" }, ctx);
    expect(out.trim()).toBe("hello");
  });

  it("returns (no output) when command produces no output", async () => {
    const out = await shellExecuteTool.execute({ command: "true" }, ctx);
    expect(out).toBe("(no output)");
  });
});
