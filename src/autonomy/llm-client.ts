import type {
  ChatMessage,
  ToolCall,
  ToolDefinition,
  LLMResult,
  AgentTool,
  ToolContext,
} from "../types.js";

interface LLMConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * OpenAI-compatible LLM client with function calling loop.
 * Works with: OpenRouter, OpenAI, DeepSeek, any OpenAI-compatible API.
 */
export class LLMClient {
  constructor(private config: LLMConfig) {}

  /**
   * Chat with tool calling loop.
   * Sends system + user message, executes tool calls, feeds results back,
   * repeats until LLM returns a final response or max rounds reached.
   */
  async chatWithTools(
    systemPrompt: string,
    userMessage: string,
    tools: Map<string, AgentTool>,
    toolContext: ToolContext,
    maxRounds: number = 5
  ): Promise<LLMResult> {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const toolDefinitions = Array.from(tools.values()).map((t) => ({
      type: "function" as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.parameters,
      },
    }));

    const toolsUsed: string[] = [];
    const shellCommands: string[] = [];
    let rounds = 0;

    while (rounds < maxRounds) {
      rounds++;

      const response = await this.callApi(messages, toolDefinitions);

      // If no tool calls, we're done
      if (!response.tool_calls || response.tool_calls.length === 0) {
        return {
          response: response.content ?? "(no response)",
          toolsUsed,
          shellCommands,
          rounds,
        };
      }

      // Add assistant message with tool calls
      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      });

      // Execute each tool call
      for (const tc of response.tool_calls) {
        const toolName = tc.function.name;
        toolsUsed.push(toolName);

        const tool = tools.get(toolName);
        let result: string;

        if (!tool) {
          result = `Error: unknown tool "${toolName}"`;
        } else {
          try {
            const args = JSON.parse(tc.function.arguments);
            // Track shell commands for grounding (Law III enforcement)
            if (toolName === "shell_execute" && typeof args.command === "string") {
              shellCommands.push(args.command);
            }
            result = await tool.execute(args, toolContext);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            result = `Error executing ${toolName}: ${msg}`;
          }
        }

        // Truncate very long results
        if (result.length > 10_000) {
          result = result.slice(0, 10_000) + "\n... (truncated)";
        }

        messages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }
    }

    // Max rounds reached — return last content or summary
    return {
      response: "(max tool rounds reached)",
      toolsUsed,
      shellCommands,
      rounds,
    };
  }

  /** Simple chat without tools */
  async chatSimple(
    systemPrompt: string,
    userMessage: string
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const response = await this.callApi(messages, undefined);
    return response.content ?? "(no response)";
  }

  /** Call the OpenAI-compatible API */
  private async callApi(
    messages: ChatMessage[],
    tools?: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>
  ): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: this.config.maxTokens,
      temperature: 0.7,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      const res = await fetch(this.config.apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`LLM API error ${res.status}: ${errText}`);
      }

      const data = (await res.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: ToolCall[];
          };
        }>;
      };

      const choice = data.choices?.[0]?.message;
      if (!choice) {
        throw new Error("LLM API returned no choices");
      }

      return {
        content: choice.content,
        tool_calls: choice.tool_calls,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
