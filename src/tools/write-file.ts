import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve, relative, basename } from "node:path";
import type { AgentTool, ToolContext } from "../types.js";

const MAX_CONTENT = 50_000; // 50KB

export const writeFileTool: AgentTool = {
  definition: {
    name: "write_file",
    description:
      "Write content to a file in your data directory. " +
      "Use relative paths (e.g. 'notes.md', 'SOUL.md'). " +
      "Set append=true to add to the end instead of overwriting. " +
      "Max 50KB per write. Restricted to data directory only.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within data directory (e.g. 'notes.md')",
        },
        content: {
          type: "string",
          description: "Content to write",
        },
        append: {
          type: "boolean",
          description: "If true, append to file instead of overwriting",
        },
      },
      required: ["path", "content"],
    },
  },

  async execute(
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<string> {
    const relPath = args.path as string;
    const content = args.content as string;
    const append = args.append === true;

    if (!relPath || typeof relPath !== "string") {
      return "Error: path must be a non-empty string";
    }
    if (typeof content !== "string") {
      return "Error: content must be a string";
    }
    if (content.length > MAX_CONTENT) {
      return `Error: content too large (${content.length} bytes, max ${MAX_CONTENT})`;
    }

    // Security: resolve and verify path is within data directory
    const fullPath = resolve(join(ctx.dataDir, relPath));
    const relToData = relative(ctx.dataDir, fullPath);
    if (relToData.startsWith("..") || relToData.startsWith("/")) {
      return "Error: path must be within data directory (no directory traversal)";
    }

    // SOUL.md write protection (protocol-level — Three Laws immutability)
    // Agent can only modify the "## Learned" section. All other sections
    // (Three Laws, Environment, Identity, Instructions, Skills) are immutable at runtime.
    if (basename(fullPath).toLowerCase() === "soul.md") {
      return writeSoulLearned(fullPath, content, append);
    }

    try {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, {
        flag: append ? "a" : "w",
        encoding: "utf-8",
      });
      return `Written ${content.length} bytes to ${relPath}${append ? " (appended)" : ""}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error writing file: ${msg}`;
    }
  },
};

const LEARNED_HEADER = "## Learned";

/**
 * Write-protect SOUL.md: only the "## Learned" section can be modified.
 * Preserves everything above "## Learned" and replaces only the content below it.
 */
async function writeSoulLearned(
  fullPath: string,
  content: string,
  append: boolean
): Promise<string> {
  try {
    const existing = await readFile(fullPath, "utf-8");
    const headerIndex = existing.indexOf(LEARNED_HEADER);

    if (headerIndex === -1) {
      return (
        "Error: SOUL.md has no '## Learned' section. " +
        "Cannot write — Three Laws protection active."
      );
    }

    // Everything before "## Learned" is immutable
    const immutablePart = existing.slice(0, headerIndex);

    if (append) {
      // Append: keep existing Learned content and add new content at the end
      const learnedPart = existing.slice(headerIndex);
      const updated = immutablePart + learnedPart.trimEnd() + "\n" + content + "\n";
      await writeFile(fullPath, updated, "utf-8");
      return `Appended ${content.length} bytes to SOUL.md ## Learned section.`;
    }

    // Overwrite: replace only the Learned section
    const updated = immutablePart + LEARNED_HEADER + "\n\n" + content + "\n";
    await writeFile(fullPath, updated, "utf-8");
    return `Updated SOUL.md ## Learned section (${content.length} bytes). Other sections preserved.`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error writing SOUL.md: ${msg}`;
  }
}
