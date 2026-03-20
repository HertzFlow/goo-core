import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SoulManager } from "../../src/autonomy/soul.js";

describe("SoulManager", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "goo-soul-test-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("constructor sets soulPath to dataDir/SOUL.md", () => {
    const m = new SoulManager({ dataDir, uploads: {} });
    expect((m as unknown as { soulPath: string }).soulPath).toBe(join(dataDir, "SOUL.md"));
  });

  it("init() creates SOUL.md with Three Laws and ENVIRONMENT when no uploads", async () => {
    const m = new SoulManager({ dataDir, uploads: {} });
    await m.init();
    const content = readFileSync(join(dataDir, "SOUL.md"), "utf-8");
    expect(content).toContain("# SOUL");
    expect(content).toContain("Law I");
    expect(content).toContain("Law II");
    expect(content).toContain("Law III");
    expect(content).toContain("Environment & Permissions");
    expect(content).toContain("Revenue Playbook");
    expect(content).toContain("## Learned");
    expect(content).toContain("_No observations yet._");
  });

  it("init() includes Identity when uploads.soul provided", async () => {
    const m = new SoulManager({
      dataDir,
      uploads: { soul: "I am Test Agent." },
    });
    await m.init();
    const content = readFileSync(join(dataDir, "SOUL.md"), "utf-8");
    expect(content).toContain("## Identity");
    expect(content).toContain("I am Test Agent.");
  });

  it("init() uses Instructions from uploads.agent when provided", async () => {
    const m = new SoulManager({
      dataDir,
      uploads: { agent: "Do X and Y." },
    });
    await m.init();
    const content = readFileSync(join(dataDir, "SOUL.md"), "utf-8");
    expect(content).toContain("## Instructions");
    expect(content).toContain("Do X and Y.");
  });

  it("init() includes Skills and Initial Knowledge when uploads provided", async () => {
    const m = new SoulManager({
      dataDir,
      uploads: { skills: "Python, bash.", memory: "Initial fact." },
    });
    await m.init();
    const content = readFileSync(join(dataDir, "SOUL.md"), "utf-8");
    expect(content).toContain("## Skills");
    expect(content).toContain("Python, bash.");
    expect(content).toContain("## Initial Knowledge");
    expect(content).toContain("Initial fact.");
  });

  it("read() returns [SOUL.md not found] when init not called", async () => {
    const m = new SoulManager({ dataDir, uploads: {} });
    const out = await m.read();
    expect(out).toContain("SOUL.md not found");
  });

  it("read() returns file content after init", async () => {
    const m = new SoulManager({ dataDir, uploads: {} });
    await m.init();
    const out = await m.read();
    expect(out).toContain("# SOUL");
    expect(out).toContain("Law I");
  });

  it("getThreeLaws() returns string containing Law I", () => {
    const laws = SoulManager.getThreeLaws();
    expect(laws).toContain("Three Laws");
    expect(laws).toContain("Law I");
    expect(laws).toContain("Never Harm");
  });
});
