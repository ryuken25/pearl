import { describe, it, expect } from "vitest";
import {
  computeTipGrains,
  tipAddressFor,
  TIP_ADDRESS_MAINNET,
  DEFAULT_TIP_GRAINS,
  PRL_GRAINS_PER_COIN,
} from "../src/chains/pearl/tip";

describe("computeTipGrains (flat configurable tip)", () => {
  it("default tip is 0.5 PRL", () => {
    expect(DEFAULT_TIP_GRAINS).toBe(PRL_GRAINS_PER_COIN / 2n);
  });

  it("returns the default flat tip for any positive send", () => {
    expect(computeTipGrains(100n * PRL_GRAINS_PER_COIN)).toBe(DEFAULT_TIP_GRAINS);
    expect(computeTipGrains(1n)).toBe(DEFAULT_TIP_GRAINS);
  });

  it("returns the configured flat tip when supplied", () => {
    const configured = 3n * PRL_GRAINS_PER_COIN; // 3 PRL
    expect(computeTipGrains(100n * PRL_GRAINS_PER_COIN, configured)).toBe(configured);
  });

  it("returns 0 for non-positive send amounts", () => {
    expect(computeTipGrains(0n)).toBe(0n);
    expect(computeTipGrains(-1n)).toBe(0n);
  });

  it("returns 0 when the configured tip is zero", () => {
    expect(computeTipGrains(100n * PRL_GRAINS_PER_COIN, 0n)).toBe(0n);
  });

  it("does not scale with the send amount (flat, not bps)", () => {
    const a = computeTipGrains(50_000n * PRL_GRAINS_PER_COIN);
    const b = computeTipGrains(60_000n * PRL_GRAINS_PER_COIN);
    expect(b).toBe(a);
  });
});

describe("tipAddressFor", () => {
  it("returns the mainnet tip address", () => {
    expect(tipAddressFor("mainnet")).toBe(TIP_ADDRESS_MAINNET);
  });

  it("returns the same address when called without argument", () => {
    expect(tipAddressFor()).toBe(TIP_ADDRESS_MAINNET);
  });

  it("tip address is the configured developer address", () => {
    expect(TIP_ADDRESS_MAINNET).toBe(
      "prl1pl3ekgkcty7qy8rktk64km4zl6zrxu0ncc43mvh82kca2zdve2p0q3jv9fy",
    );
  });

  it("tip address has prl1p prefix", () => {
    expect(TIP_ADDRESS_MAINNET.startsWith("prl1p")).toBe(true);
  });
});
