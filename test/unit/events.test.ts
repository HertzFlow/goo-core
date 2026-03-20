import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ENV } from "../../src/const.js";

describe("emitEvent", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    fetchMock = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = fetchMock as typeof fetch;
    delete process.env[ENV.EVENT_CALLBACK_URL];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    writeSpy.mockRestore();
    delete process.env[ENV.EVENT_CALLBACK_URL];
  });

  it("writes JSON line to stdout with goo_event shape", async () => {
    const { emitEvent } = await import("../../src/events.js");
    emitEvent("test_type", "info", "hello");
    expect(writeSpy).toHaveBeenCalled();
    const line = writeSpy.mock.calls[0][0] as string;
    expect(line.endsWith("\n")).toBe(true);
    const obj = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(obj.goo_event).toBe(true);
    expect(obj.type).toBe("test_type");
    expect(obj.severity).toBe("info");
    expect(obj.message).toBe("hello");
    expect(obj.data).toBeUndefined();
    expect(typeof obj.ts).toBe("string");
  });

  it("includes data when provided", async () => {
    const { emitEvent } = await import("../../src/events.js");
    emitEvent("x", "warn", "m", { foo: 1 });
    const line = (writeSpy.mock.calls[0][0] as string).trim();
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(obj.data).toEqual({ foo: 1 });
  });

  it("POSTs to EVENT_CALLBACK_URL when set (fire-and-forget)", async () => {
    process.env[ENV.EVENT_CALLBACK_URL] = "https://example.test/events";
    vi.resetModules();
    const { emitEvent } = await import("../../src/events.js");
    emitEvent("cb", "error", "msg");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/events",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = fetchMock.mock.calls[0][1] as RequestInit;
    expect(typeof body.body).toBe("string");
    expect((body.body as string).includes('"type":"cb"')).toBe(true);
  });

  it("ignores fetch rejection (stdout still primary)", async () => {
    process.env[ENV.EVENT_CALLBACK_URL] = "https://fail.test/x";
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    vi.resetModules();
    const { emitEvent } = await import("../../src/events.js");
    emitEvent("t", "info", "ok");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
    expect(writeSpy).toHaveBeenCalled();
  });
});
