// Mobile Pearl Wallet developer-tip configuration.
//
// When the user sends PRL (and opts in), the wallet adds an extra
// output to the developer tip address as part of the SAME transaction.
// The tip is a FLAT amount (default 0.5 PRL) configurable in Settings.
// Opt-in is ON by default but every send shows a checkbox the user can
// uncheck — when unchecked the wallet sends nothing extra and using the
// wallet costs nothing beyond on-chain fees.
//
// NOTE: Pearl L1 here is a btcd/Bitcoin-fork using BIP-340 Schnorr /
// BIP-86 Taproot (secp256k1), UTXO-based. Signatures are STATELESS —
// there is no XMSS / one-time-key state to advance. The tip is just an
// extra Taproot output; it shares the send's inputs and is atomic with
// the principal transfer.

import type { PearlNetwork } from "./network";

const PRL_GRAINS_PER_COIN = 100_000_000n;

// Tip recipient address is PUBLIC — it only ever receives. The spending
// key is held by the developer; nothing secret lives in this repo.
// Shown transparently in the Send UI so the user always sees where the
// tip goes.
export const TIP_ADDRESS_MAINNET =
  "prl1pl3ekgkcty7qy8rktk64km4zl6zrxu0ncc43mvh82kca2zdve2p0q3jv9fy";

// Default flat tip: 0.5 PRL. Configurable in Settings (tipAmountGrains).
export const DEFAULT_TIP_GRAINS = PRL_GRAINS_PER_COIN / 2n; // 0.5 PRL

export { PRL_GRAINS_PER_COIN };

/**
 * The tip is a flat configured amount. We never tip when the send
 * principal is zero/negative or when the configured amount is zero.
 * The configured amount comes from Settings (defaults to
 * DEFAULT_TIP_GRAINS). The caller is responsible for ensuring
 * amount + tip + fee <= balance before broadcasting; this function only
 * decides the tip magnitude.
 */
export function computeTipGrains(
  sendAmountGrains: bigint,
  configuredTipGrains: bigint = DEFAULT_TIP_GRAINS,
): bigint {
  if (sendAmountGrains <= 0n) return 0n;
  if (configuredTipGrains <= 0n) return 0n;
  return configuredTipGrains;
}

export function tipAddressFor(_net: PearlNetwork = "mainnet"): string {
  return TIP_ADDRESS_MAINNET;
}
