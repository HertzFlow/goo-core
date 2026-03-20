import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: object,
      cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
    ) => {
      queueMicrotask(() => cb(null, "", ""));
    },
  ),
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { pushSystemEvent, pushWorkspaceRefresh, formatHeartbeatEvent } from "../../src/autonomy/gateway-push.js";

describe("formatHeartbeatEvent", () => {
  const base = {
    heartbeat: 3,
    status: "ACTIVE",
    treasuryBnb: "1.5",
    runwayHours: 240,
    summary: "(LLM not called)",
    toolsCalled: [] as string[],
    survivalActions: [] as string[],
  };

  it("compact mode returns short line", () => {
    expect(formatHeartbeatEvent(base, true)).toBe("#3 ACTIVE 1.5BNB 240h");
  });

  it("full mode includes survival and tools when present", () => {
    const text = formatHeartbeatEvent({
      ...base,
      survivalActions: ["Pulse"],
      toolsCalled: ["read_chain_state"],
      summary: "Did work",
    });
    expect(text).toContain("[heartbeat #3]");
    expect(text).toContain("Status=ACTIVE");
    expect(text).toContain("Survival: Pulse");
    expect(text).toContain("Tools: read_chain_state");
    expect(text).toContain("Summary: Did work");
  });

  it("omits summary when LLM not called", () => {
    const text = formatHeartbeatEvent(base);
    expect(text).not.toContain("Summary:");
  });

  it("truncates long summary past 120 chars", () => {
    const long = "x".repeat(130);
    const text = formatHeartbeatEvent({ ...base, summary: long });
    expect(text).toContain("Summary:");
    expect(text).toContain("...");
    expect(text.length).toBeLessThan(long.length + 200);
  });
});

describe("pushSystemEvent / pushWorkspaceRefresh (execFile)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    execFileMock.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("invokes openclaw with expected args for next-heartbeat", () => {
    pushSystemEvent(
      { gatewayUrl: "ws://127.0.0.1:19789", gatewayToken: "tok" },
      "hello",
      "next-heartbeat",
    );
    expect(execFileMock).toHaveBeenCalledWith(
      "openclaw",
      expect.arrayContaining([
        "system",
        "event",
        "--text",
        "hello",
        "--mode",
        "next-heartbeat",
        "--token",
        "tok",
        "--url",
        "ws://127.0.0.1:19789",
      ]),
      { timeout: 15_000 },
      expect.any(Function),
    );
  });

  it("pushWorkspaceRefresh uses mode now and file list in text", () => {
    pushWorkspaceRefresh(
      { gatewayUrl: "http://h", gatewayToken: "t2" },
      ["a.md", "b.md"],
    );
    const args = execFileMock.mock.calls[0][1] as string[];
    const textIdx = args.indexOf("--text");
    expect(args[textIdx + 1]).toContain("a.md");
    expect(args[textIdx + 1]).toContain("b.md");
    expect(args).toContain("--mode");
    expect(args[args.indexOf("--mode") + 1]).toBe("now");
  });

  it("logs warning when execFile returns error", async () => {
    execFileMock.mockImplementationOnce((_c, _a, _o, cb) => {
      queueMicrotask(() => cb(new Error("ENOENT") as NodeJS.ErrnoException, "", ""));
    });
    pushSystemEvent({ gatewayUrl: "u", gatewayToken: "t" }, "x", "now");
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(String(warnSpy.mock.calls[0][0])).toContain("[gateway-push]");
  });

  it("logs warning when stderr contains Error", async () => {
    execFileMock.mockImplementationOnce((_c, _a, _o, cb) => {
      queueMicrotask(() => cb(null, "", "Something Error happened"));
    });
    pushSystemEvent({ gatewayUrl: "u", gatewayToken: "t" }, "x", "now");
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(String(warnSpy.mock.calls[0][0])).toContain("Warning:");
  });
});
