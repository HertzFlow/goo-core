import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
describe("emitEvent", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    fetchMock = vi.fn(() => Promise.resolve(new Response("ok", { status: 200 })));
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    writeSpy.mockRestore();
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

});
