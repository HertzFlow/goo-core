import { readFile } from "node:fs/promises";
import type { AgentTool, ToolContext } from "../types.js";
import { TOOLS_READ_FILE_MAX_OUTPUT } from "../const.js";
import { isSensitivePath, redactSensitive } from "../security/sensitive.js";

export const readFileTool: AgentTool = {
  definition: {
    name: "read_file",
    description:
      "Read a file from the filesystem. Use absolute paths. " +
      `Output truncated to ${TOOLS_READ_FILE_MAX_OUTPUT / 1000}KB. ` +
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
    ctx: ToolContext,
  ): Promise<string> {
    const path = args.path as string;
    if (!path || typeof path !== "string") {
      return "Error: path must be a non-empty string";
    }
    if (isSensitivePath(path, ctx.config.walletPrivateKeyFile)) {
      return "Error: direct reading of the private key file is not allowed";
    }

    try {
      let content = await readFile(path, "utf-8");
      if (content.length > TOOLS_READ_FILE_MAX_OUTPUT) {
        content = content.slice(0, TOOLS_READ_FILE_MAX_OUTPUT) + "\n... (truncated)";
      }
      return redactSensitive(content || "(empty file)", [ctx.config.walletPrivateKey]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return redactSensitive(`Error reading file: ${msg}`, [ctx.config.walletPrivateKey]);
    }
  },
};
