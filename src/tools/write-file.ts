import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname, resolve, relative, basename } from "node:path";
import type { AgentTool, ToolContext } from "../types.js";
import { TOOLS_WRITE_FILE_MAX_CONTENT, SOUL_LEARNED_HEADER } from "../const.js";

export const writeFileTool: AgentTool = {
  definition: {
    name: "write_file",
    description:
      "Write content to a file in your data directory or workspace. " +
      "Use relative paths (e.g. 'notes.md', 'MEMORY.md'). " +
      "Prefix with 'workspace/' to write to the OpenClaw workspace (e.g. 'workspace/MEMORY.md'). " +
      "Set append=true to add to the end instead of overwriting. " +
      `Max ${TOOLS_WRITE_FILE_MAX_CONTENT / 1000}KB per write.`,
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
    ctx: ToolContext,
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
    if (content.length > TOOLS_WRITE_FILE_MAX_CONTENT) {
      return `Error: content too large (${content.length} bytes, max ${TOOLS_WRITE_FILE_MAX_CONTENT})`;
    }

    // Determine target directory: workspace/ prefix → workspace dir, otherwise data dir
    let targetDir = ctx.dataDir;
    let targetRelPath = relPath;
    if (relPath.startsWith("workspace/")) {
      targetDir = ctx.workspaceDir;
      targetRelPath = relPath.slice("workspace/".length);
    }

    // Security: resolve and verify path is within target directory
    const fullPath = resolve(join(targetDir, targetRelPath));
    const relToTarget = relative(targetDir, fullPath);
    if (relToTarget.startsWith("..") || relToTarget.startsWith("/")) {
      return "Error: path must be within allowed directory (no directory traversal)";
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

/**
 * Write-protect SOUL.md: only the Learned section can be modified.
 * Preserves everything above the header and replaces only the content below it.
 */
async function writeSoulLearned(
  fullPath: string,
  content: string,
  append: boolean,
): Promise<string> {
  try {
    const existing = await readFile(fullPath, "utf-8");
    const headerIndex = existing.indexOf(SOUL_LEARNED_HEADER);

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
      const updated =
        immutablePart + learnedPart.trimEnd() + "\n" + content + "\n";
      await writeFile(fullPath, updated, "utf-8");
      return `Appended ${content.length} bytes to SOUL.md ## Learned section.`;
    }

    // Overwrite: replace only the Learned section
    const updated = immutablePart + SOUL_LEARNED_HEADER + "\n\n" + content + "\n";
    await writeFile(fullPath, updated, "utf-8");
    return `Updated SOUL.md ## Learned section (${content.length} bytes). Other sections preserved.`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error writing SOUL.md: ${msg}`;
  }
}
