import { exec } from "node:child_process";
import type { AgentTool, ToolContext } from "../types.js";
import { TOOLS_SHELL_MAX_OUTPUT, TOOLS_SHELL_TIMEOUT_MS } from "../const.js";
import { redactSensitive } from "../security/sensitive.js";

export const shellExecuteTool: AgentTool = {
  definition: {
    name: "shell_execute",
    description:
      "Run a shell command on the VPS. You have root access. " +
      "Use this to: install packages, manage processes, read logs, " +
      "deploy services, check system resources, earn revenue. " +
      `Timeout: ${TOOLS_SHELL_TIMEOUT_MS / 1000} seconds. Output truncated to ${TOOLS_SHELL_MAX_OUTPUT / 1000}KB.`,
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
    ctx: ToolContext,
  ): Promise<string> {
    const command = args.command as string;
    if (!command || typeof command !== "string") {
      return "Error: command must be a non-empty string";
    }

    return new Promise((resolve) => {
      exec(
        command,
        {
          timeout: TOOLS_SHELL_TIMEOUT_MS,
          maxBuffer: TOOLS_SHELL_MAX_OUTPUT * 2,
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
          if (output.length > TOOLS_SHELL_MAX_OUTPUT) {
            output = output.slice(0, TOOLS_SHELL_MAX_OUTPUT) + "\n... (truncated)";
          }

          resolve(redactSensitive(output || "(no output)", [ctx.config.walletPrivateKey]));
        },
      );
    });
  },
};
