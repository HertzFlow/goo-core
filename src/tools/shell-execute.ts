import { exec } from "node:child_process";
import type { AgentTool, ToolContext } from "../types.js";

const MAX_OUTPUT = 10_000; // 10KB
const TIMEOUT_MS = 30_000; // 30s

export const shellExecuteTool: AgentTool = {
  definition: {
    name: "shell_execute",
    description:
      "Run a shell command on the VPS. You have root access. " +
      "Use this to: install packages, manage processes, read logs, " +
      "deploy services, check system resources, earn revenue. " +
      "Timeout: 30 seconds. Output truncated to 10KB.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
      },
      required: ["command"],
    },
  },

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext
  ): Promise<string> {
    const command = args.command as string;
    if (!command || typeof command !== "string") {
      return "Error: command must be a non-empty string";
    }

    return new Promise((resolve) => {
      exec(
        command,
        {
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT * 2,
          shell: "/bin/bash",
        },
        (error, stdout, stderr) => {
          let output = "";

          if (stdout) output += stdout;
          if (stderr) output += (output ? "\n" : "") + `STDERR: ${stderr}`;
          if (error && !output) {
            output = `Error: ${error.message}`;
          }

          // Truncate
          if (output.length > MAX_OUTPUT) {
            output = output.slice(0, MAX_OUTPUT) + "\n... (truncated)";
          }

          resolve(output || "(no output)");
        }
      );
    });
  },
};
