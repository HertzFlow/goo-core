import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFileTool } from "../../../src/tools/read-file.js";
import { makeChainState } from "../../helpers/fixtures.js";

describe("read_file tool", () => {
  let dir: string;
  const ctx = { chainState: makeChainState(), config: {} as never, dataDir: "/tmp" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "goo-readfile-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns Error when path is empty", async () => {
    const out = await readFileTool.execute({ path: "" }, ctx);
    expect(out).toContain("Error");
    expect(out).toContain("path");
  });

  it("returns Error when path is not a string", async () => {
    const out = await readFileTool.execute({ path: 123 }, ctx);
    expect(out).toContain("Error");
  });

  it("returns file content when file exists", async () => {
    const f = join(dir, "f.txt");
    writeFileSync(f, "hello world", "utf-8");
    const out = await readFileTool.execute({ path: f }, ctx);
    expect(out).toBe("hello world");
  });

  it("returns (empty file) when file is empty", async () => {
    const f = join(dir, "empty.txt");
    writeFileSync(f, "", "utf-8");
    const out = await readFileTool.execute({ path: f }, ctx);
    expect(out).toBe("(empty file)");
  });

  it("returns Error when file does not exist", async () => {
    const out = await readFileTool.execute({ path: join(dir, "nonexistent") }, ctx);
    expect(out).toContain("Error reading file");
  });
});
