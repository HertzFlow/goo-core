import { describe, it, expect } from "vitest";
import { readChainStateTool } from "../../../src/tools/read-chain-state.js";
import { makeChainState } from "../../helpers/fixtures.js";

describe("read_chain_state tool", () => {
  it("returns status, treasury, runway, native balance, token holdings", async () => {
    const state = makeChainState();
    const out = await readChainStateTool.execute({}, { chainState: state, config: {} as never, dataDir: "/tmp" });
    expect(out).toContain("ACTIVE");
    expect(out).toContain("Treasury Balance");
    expect(out).toContain("Dying Threshold");
    expect(out).toContain("Native Balance");
    expect(out).toContain("Token Holdings");
    expect(out).toContain("Last Pulse");
  });

  it("includes starving/dying timestamps when non-zero", async () => {
    const state = makeChainState({
      starvingEnteredAt: BigInt(Math.floor(Date.now() / 1000) - 86400),
      dyingEnteredAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
    });
    const out = await readChainStateTool.execute({}, { chainState: state, config: {} as never, dataDir: "/tmp" });
    expect(out).toContain("Starving entered");
    expect(out).toContain("Dying entered");
  });
});
