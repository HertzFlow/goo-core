import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { Observation } from "../types.js";

const MAX_OBSERVATIONS = 200;

/**
 * Append-only observation log.
 * Each heartbeat records what happened: status, balance, tools used, commands run.
 * Persists to JSONL file. Survives restarts.
 */
export class ObservationLog {
  private observations: Observation[] = [];
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "observations.jsonl");
  }

  /** Load existing observations from disk */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      this.observations = lines.map((line) => JSON.parse(line) as Observation);

      // Truncate if over limit
      if (this.observations.length > MAX_OBSERVATIONS) {
        this.observations = this.observations.slice(-MAX_OBSERVATIONS);
        await this.flush();
      }
    } catch {
      // File doesn't exist yet — start fresh
      this.observations = [];
    }
  }

  /** Record a new observation */
  async record(obs: Observation): Promise<void> {
    this.observations.push(obs);

    // Truncate oldest if over limit
    if (this.observations.length > MAX_OBSERVATIONS) {
      this.observations = this.observations.slice(-MAX_OBSERVATIONS);
      await this.flush();
    } else {
      // Append single line
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(
        this.filePath,
        JSON.stringify(obs) + "\n",
        { flag: "a" }
      );
    }
  }

  /** Get recent observations as formatted strings */
  getRecent(count: number = 5): string[] {
    return this.observations.slice(-count).map((obs) => {
      const time = obs.timestamp.split("T")[1]?.split(".")[0] ?? obs.timestamp;
      const tools = obs.toolsCalled.length > 0
        ? obs.toolsCalled.join(", ")
        : "none";
      const shells = obs.shellCommands.length > 0
        ? ` | commands: ${obs.shellCommands.join("; ")}`
        : "";
      return (
        `[${time}] #${obs.heartbeat} Status=${obs.status}, ` +
        `Balance=$${obs.balanceUsd.toFixed(2)}, ` +
        `Runway=${obs.runwayHours}h, Tools: ${tools}${shells}`
      );
    });
  }

  /** Get recent observations as raw structured data */
  getRecentRaw(count: number = 5): Observation[] {
    return this.observations.slice(-count);
  }

  /** Get total heartbeat count */
  get heartbeatCount(): number {
    const last = this.observations[this.observations.length - 1];
    return last ? last.heartbeat : 0;
  }

  /** Flush all observations to disk (rewrite) */
  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const content = this.observations
      .map((obs) => JSON.stringify(obs))
      .join("\n") + "\n";
    await writeFile(this.filePath, content, "utf-8");
  }
}
