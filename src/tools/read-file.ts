import { readFile } from "node:fs/promises";
import type { AgentTool, ToolContext } from "../types.js";

const MAX_OUTPUT = 100_000; // 100KB

export const readFileTool: AgentTool = {
  definition: {
    name: "read_file",
    description:
      "Read a file from the filesystem. Use absolute paths. " +
      "Output truncated to 100KB. " +
      "Use this to read logs, configs, SOUL.md, or any file on the VPS.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the file (e.g. /opt/data/SOUL.md)",
        },
      },
      required: ["path"],
    },
  },

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext
  ): Promise<string> {
    const path = args.path as string;
    if (!path || typeof path !== "string") {
      return "Error: path must be a non-empty string";
    }

    try {
      let content = await readFile(path, "utf-8");
      if (content.length > MAX_OUTPUT) {
        content = content.slice(0, MAX_OUTPUT) + "\n... (truncated)";
      }
      return content || "(empty file)";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error reading file: ${msg}`;
    }
  },
};
