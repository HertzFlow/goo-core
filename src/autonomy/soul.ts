import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { THREE_LAWS, ENVIRONMENT, REVENUE_PLAYBOOK } from "../const.js";

export interface SoulConfig {
  dataDir: string;
  uploads: {
    soul?: string;
    agent?: string;
    skills?: string;
    memory?: string;
  };
}

/**
 * SoulManager — manages the agent's SOUL.md identity document.
 *
 * Structure (top to bottom, higher = higher priority):
 *   1. Three Laws (immutable, protocol-level)
 *   2. Environment & Permissions (protocol-level — economic loop, anti-hallucination, tool docs)
 *   3. Identity (from creator's soul.md upload)
 *   4. Instructions (from creator's agent.md) OR Revenue Playbook (fallback when no agent.md)
 *   5. Skills (from creator's skills.md upload)
 *   6. Initial Knowledge (from creator's memory.md upload)
 *   7. Learned (agent writes here at runtime)
 */
export class SoulManager {
  private soulPath: string;

  constructor(private config: SoulConfig) {
    this.soulPath = join(config.dataDir, "SOUL.md");
  }

  /** Initialize SOUL.md — create from uploads if not exists */
  async init(): Promise<void> {
    await mkdir(this.config.dataDir, { recursive: true });

    // Build SOUL.md from components
    const sections: string[] = [
      "# SOUL",
      "",
      "This document defines the same autonomous self across heartbeats.",
      "Read it as continuity: who you are, what kind of life you are sustaining, and what work you should keep advancing over time.",
      "",
      THREE_LAWS,
      "",
      ENVIRONMENT,
    ];

    // Identity from soul.md upload
    if (this.config.uploads.soul) {
      sections.push(
        "",
        "## Identity",
        "",
        "This is who you are across the whole run, not just this moment.",
        "",
        this.config.uploads.soul,
      );
    }

    // Instructions from agent.md upload, OR Revenue Playbook as fallback
    if (this.config.uploads.agent) {
      sections.push(
        "",
        "## Instructions",
        "",
        "These are the standing directions you should keep advancing over time.",
        "",
        this.config.uploads.agent,
      );
    } else {
      // No creator instructions — inject Revenue Playbook as default guide
      sections.push("", REVENUE_PLAYBOOK);
    }

    // Skills from skills.md upload
    if (this.config.uploads.skills) {
      sections.push(
        "",
        "## Skills",
        "",
        "These are capabilities you can rely on repeatedly while continuing your work.",
        "",
        this.config.uploads.skills,
      );
    }

    // Initial knowledge from memory.md upload
    if (this.config.uploads.memory) {
      sections.push(
        "",
        "## Initial Knowledge",
        "",
        "These are starting facts to carry forward as part of your ongoing context.",
        "",
        this.config.uploads.memory,
      );
    }

    // Learned section — agent appends here via write_file
    sections.push(
      "",
      "## Learned",
      "",
      "Append verified observations here so future heartbeats can continue the same work with better memory.",
      "",
      "_No observations yet._",
      "",
    );

    await writeFile(this.soulPath, sections.join("\n"), "utf-8");
  }

  /** Read the current SOUL.md content */
  async read(): Promise<string> {
    try {
      return await readFile(this.soulPath, "utf-8");
    } catch {
      return "[SOUL.md not found — call init() first]";
    }
  }

  /** Get the Three Laws text (for reference/display) */
  static getThreeLaws(): string {
    return THREE_LAWS;
  }
}
