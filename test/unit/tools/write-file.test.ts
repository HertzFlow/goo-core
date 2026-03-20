import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeFileTool } from "../../../src/tools/write-file.js";
import { makeChainState } from "../../helpers/fixtures.js";

describe("write_file tool", () => {
  let dataDir: string;
  const baseCtx = () => ({ chainState: makeChainState(), config: {} as never, dataDir });

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "goo-writefile-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns Error when path is empty", async () => {
    const out = await writeFileTool.execute({ path: "", content: "x" }, baseCtx());
    expect(out).toContain("path must be");
  });

  it("returns Error when content is not string", async () => {
    const out = await writeFileTool.execute({ path: "a.txt", content: 1 }, baseCtx());
    expect(out).toContain("content must be");
  });

  it("returns Error when content exceeds MAX_CONTENT", async () => {
    const out = await writeFileTool.execute(
      { path: "a.txt", content: "x".repeat(60_000) },
      baseCtx()
    );
    expect(out).toContain("too large");
  });

  it("returns Error for path traversal", async () => {
    const out = await writeFileTool.execute(
      { path: "../../../etc/passwd", content: "x" },
      baseCtx()
    );
    expect(out).toContain("within allowed directory");
  });

  it("writes file and returns Written ... bytes", async () => {
    const out = await writeFileTool.execute(
      { path: "notes.md", content: "hello" },
      baseCtx()
    );
    expect(out).toContain("Written 5 bytes");
    expect(readFileSync(join(dataDir, "notes.md"), "utf-8")).toBe("hello");
  });

  it("append=true appends to file", async () => {
    await writeFileTool.execute({ path: "log.txt", content: "line1\n", append: true }, baseCtx());
    await writeFileTool.execute({ path: "log.txt", content: "line2\n", append: true }, baseCtx());
    expect(readFileSync(join(dataDir, "log.txt"), "utf-8")).toBe("line1\nline2\n");
  });

  it("SOUL.md without ## Learned returns Error", async () => {
    writeFileSync(join(dataDir, "SOUL.md"), "# SOUL\n\nNo Learned section.", "utf-8");
    const out = await writeFileTool.execute(
      { path: "SOUL.md", content: "learned" },
      baseCtx()
    );
    expect(out).toContain("no '## Learned' section");
  });

  it("SOUL.md with ## Learned updates only Learned section", async () => {
    const full = "# SOUL\n\n## Learned\n\n_old_\n";
    writeFileSync(join(dataDir, "SOUL.md"), full, "utf-8");
    const out = await writeFileTool.execute(
      { path: "SOUL.md", content: "new content" },
      baseCtx()
    );
    expect(out).toContain("Updated SOUL.md ## Learned");
    const content = readFileSync(join(dataDir, "SOUL.md"), "utf-8");
    expect(content).toContain("# SOUL");
    expect(content).toContain("## Learned");
    expect(content).toContain("new content");
    expect(content).not.toContain("_old_");
  });
});
