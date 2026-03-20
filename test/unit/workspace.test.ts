import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initWorkspace, updateWorkspace } from "../../src/autonomy/workspace.js";
import { mockRuntimeConfig } from "../helpers/fixtures.js";

function baseWs(dir: string) {
  return {
    workspaceDir: dir,
    walletAddress: "0x00000000000000000000000000000000000000aa",
    config: { ...mockRuntimeConfig },
    inspectPort: 19791,
  };
}

describe("initWorkspace", () => {
  let dir: string;
  const prevManaged = process.env.WORKSPACE_MANAGED;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "goo-ws-"));
    delete process.env.WORKSPACE_MANAGED;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevManaged === undefined) delete process.env.WORKSPACE_MANAGED;
    else process.env.WORKSPACE_MANAGED = prevManaged;
  });

  it("writes core markdown files and memory dir", async () => {
    const written = await initWorkspace(baseWs(dir));
    expect(written).toContain("SOUL.md");
    expect(written).toContain("TOOLS.md");
    expect(written).toContain("HEARTBEAT.md");
    expect(written).toContain("BOOTSTRAP.md");
    expect(existsSync(join(dir, "memory"))).toBe(true);
    const soul = readFileSync(join(dir, "SOUL.md"), "utf-8");
    expect(soul).toContain(mockRuntimeConfig.tokenAddress);
    expect(soul).toContain("0x00000000000000000000000000000000000000aa");
  });

  it("writes USER.md when agent upload present", async () => {
    const cfg = {
      ...baseWs(dir),
      config: {
        ...mockRuntimeConfig,
        uploads: { ...mockRuntimeConfig.uploads, agent: "  Do things  " },
      },
    };
    const written = await initWorkspace(cfg);
    expect(written).toContain("USER.md");
    expect(readFileSync(join(dir, "USER.md"), "utf-8")).toBe("Do things");
  });

  it("writes MEMORY.md only when missing and memory upload set", async () => {
    const cfg = {
      ...baseWs(dir),
      config: {
        ...mockRuntimeConfig,
        uploads: { memory: "seed knowledge" },
      },
    };
    const w1 = await initWorkspace(cfg);
    expect(w1).toContain("MEMORY.md");
    const w2 = await initWorkspace(cfg);
    expect(w2).not.toContain("MEMORY.md");
    expect(readFileSync(join(dir, "MEMORY.md"), "utf-8")).toBe("seed knowledge");
  });

  it("with WORKSPACE_MANAGED=1 returns empty list and ensures memory dir", async () => {
    process.env.WORKSPACE_MANAGED = "1";
    const written = await initWorkspace(baseWs(dir));
    expect(written).toEqual([]);
    expect(existsSync(join(dir, "memory"))).toBe(true);
  });
});

describe("updateWorkspace", () => {
  let dir: string;
  const prevManaged = process.env.WORKSPACE_MANAGED;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "goo-ws-up-"));
    delete process.env.WORKSPACE_MANAGED;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevManaged === undefined) delete process.env.WORKSPACE_MANAGED;
    else process.env.WORKSPACE_MANAGED = prevManaged;
  });

  it("writes SOUL/TOOLS/HEARTBEAT when missing", async () => {
    const r = await updateWorkspace(baseWs(dir));
    expect(r.changed.sort()).toEqual(["HEARTBEAT.md", "SOUL.md", "TOOLS.md"].sort());
    expect(r.unchanged).toEqual([]);
  });

  it("marks unchanged when content hash matches", async () => {
    await updateWorkspace(baseWs(dir));
    const r2 = await updateWorkspace(baseWs(dir));
    expect(r2.changed).toEqual([]);
    expect(r2.unchanged.sort()).toEqual(["HEARTBEAT.md", "SOUL.md", "TOOLS.md"].sort());
  });

  it("detects change when wallet address changes", async () => {
    await updateWorkspace(baseWs(dir));
    const r2 = await updateWorkspace({
      ...baseWs(dir),
      walletAddress: "0x00000000000000000000000000000000000000bb",
    });
    expect(r2.changed).toContain("SOUL.md");
  });

  it("returns empty when WORKSPACE_MANAGED=1", async () => {
    process.env.WORKSPACE_MANAGED = "1";
    const r = await updateWorkspace(baseWs(dir));
    expect(r).toEqual({ changed: [], unchanged: [] });
  });

  it("includes creator skills in TOOLS.md content", async () => {
    await initWorkspace({
      ...baseWs(dir),
      config: {
        ...mockRuntimeConfig,
        uploads: { skills: "My custom skill" },
      },
    });
    const tools = readFileSync(join(dir, "TOOLS.md"), "utf-8");
    expect(tools).toContain("My custom skill");
  });

  it("SOUL.md includes ## Genesis when soul upload is present", async () => {
    await initWorkspace({
      ...baseWs(dir),
      config: {
        ...mockRuntimeConfig,
        uploads: { soul: "  Custom genesis line  " },
      },
    });
    const soul = readFileSync(join(dir, "SOUL.md"), "utf-8");
    expect(soul).toContain("## Genesis");
    expect(soul).toContain("Custom genesis line");
    expect(soul).toMatch(/^# Agent\n/m);
  });
});
