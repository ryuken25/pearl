import { create } from "zustand";

export type Theme = "system" | "light" | "dark";

// Pearl RPC override allowlist. CSP `connect-src` already restricts which
// hosts the browser can fetch from, but the override field is persisted
// to localStorage — a stray bookmarklet or malicious extension could
// write arbitrary URLs there. Validating at the store boundary makes the
// allowlist single-sourced (CSP + here) and gives the Settings UI a
// machine-readable rejection reason. Empty string = use the default.
// v0.2.5: extended to cover the sentry-fleet hostnames used by the
// auto-rotating RPC pool (see chains/pearl/network.ts PEARL_RPC_POOL).
// Must stay in sync with public/_headers CSP `connect-src`.
const PEARL_RPC_OVERRIDE_ALLOWED_HOSTS: readonly string[] = [
  "rpc.pearlwallet.xyz",
  "pearlbridge.xyz",
  "pearl-sentry-fsn1-1.pearlbridge.xyz",
  "pearl-sentry-nbg1-1.pearlbridge.xyz",
  "pearl-sentry-hel1-1.pearlbridge.xyz",
];

// Ethereum RPC override allowlist. Same model as Pearl side. Restricted
// to hosts CSP allows so a saved override never points at something the
// browser would refuse to load (silent breakage = worst UX).
const ETH_RPC_OVERRIDE_ALLOWED_HOSTS: readonly string[] = [
  "ethereum-rpc.publicnode.com",
  "eth.drpc.org",
];

export function isAllowedRpcOverride(url: string): boolean {
  if (url === "") return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return PEARL_RPC_OVERRIDE_ALLOWED_HOSTS.includes(u.host);
  } catch {
    return false;
  }
}

export function isAllowedEthRpcOverride(url: string): boolean {
  if (url === "") return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return ETH_RPC_OVERRIDE_ALLOWED_HOSTS.includes(u.host);
  } catch {
    return false;
  }
}

interface UIState {
  theme: Theme;
  // Empty string = use the built-in default sentry RPC.
  pearlRpcOverride: string;
  // Empty string = use the built-in default Ethereum RPC (publicnode +
  // drpc fallback). v0.2.0 surfaces this so a user running their own
  // archive node can point the wallet at it.
  ethRpcOverride: string;
  // Developer tip — opt-in by default. Disabling sends no extra output
  // and costs nothing beyond on-chain fees.
  tipEnabled: boolean;
  // Flat tip amount in PRL (default 0.5). Configurable here in Settings.
  // Stored as a decimal number of PRL (not grains) so it round-trips
  // through JSON without bigint-serialisation gymnastics.
  tipAmountPrl: number;
  // Experimental multisig surface. Default OFF — flips on a Vaults entry
  // in the nav and exposes the multisig flows behind it. Off means the
  // wallet behaves exactly as singlesig has shipped since v0.1.x. v0.2.0
  // ships the full user flows behind this toggle.
  multisigEnabled: boolean;
  // Ethereum surface (WPRL + ETH gas + PearlBridge). Default OFF in
  // v0.2.0 — a Pearl-native user who never touches Eth shouldn't be
  // forced to look at WPRL/ETH columns. Off hides the WPRL/ETH balance
  // tiles, the Send WPRL / Send ETH / Bridge buttons, the Eth address
  // line on Dashboard, and bounces the corresponding routes back to
  // /dashboard. Singlesig PRL only stays the default-on experience.
  ethEnabled: boolean;
  // Experimental: Armory-style offline signing. Off (default) hides
  // the entire "Offline signing" page + nav entry. On exposes the
  // watcher / signer / broadcaster flows and QR data-transfer UX.
  // Marked experimental because the wire format is v1 and may evolve;
  // do NOT rely on a payload encoded today being decodable by a future
  // major version. See src/lib/offline-signing/payload.ts.
  offlineSigningEnabled: boolean;
  setTheme(t: Theme): void;
  setPearlRpcOverride(url: string): void;
  setEthRpcOverride(url: string): void;
  setTipEnabled(v: boolean): void;
  setTipAmountPrl(v: number): void;
  setMultisigEnabled(v: boolean): void;
  setEthEnabled(v: boolean): void;
  setOfflineSigningEnabled(v: boolean): void;
}

// Bump the storage key whenever the shape changes so a stale persisted
// blob doesn't carry forward a field that no longer exists (or worse,
// is type-different). v4 → v5 in v0.2.0 for ethEnabled + ethRpcOverride.
// v5 → v6 in v0.2.8 for offlineSigningEnabled.
// v6 → v7 in Mobile Pearl Wallet for tipAmountPrl (flat configurable tip).
const STORAGE_KEY = "pearl-wallet-ui-v7";

interface PersistedUI {
  theme: Theme;
  pearlRpcOverride: string;
  ethRpcOverride: string;
  tipEnabled: boolean;
  tipAmountPrl: number;
  multisigEnabled: boolean;
  ethEnabled: boolean;
  offlineSigningEnabled: boolean;
}

const DEFAULT_UI: PersistedUI = {
  theme: "system",
  pearlRpcOverride: "",
  ethRpcOverride: "",
  tipEnabled: true,
  tipAmountPrl: 0.5,
  multisigEnabled: false,
  ethEnabled: false,
  offlineSigningEnabled: false,
};

function loadUI(): PersistedUI {
  if (typeof localStorage === "undefined") return DEFAULT_UI;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI;
    const parsed = JSON.parse(raw) as Partial<PersistedUI>;
    const merged = { ...DEFAULT_UI, ...parsed };
    // Defense in depth: a stale localStorage value (or one tampered by a
    // bookmarklet) bypasses the setter's allowlist. Re-validate on load.
    if (!isAllowedRpcOverride(merged.pearlRpcOverride)) {
      merged.pearlRpcOverride = "";
    }
    if (!isAllowedEthRpcOverride(merged.ethRpcOverride)) {
      merged.ethRpcOverride = "";
    }
    // Clamp a tampered/garbage tip amount back to the default. A
    // non-finite or non-positive value would otherwise either disable
    // tipping silently or (if negative) corrupt the send math.
    if (
      typeof merged.tipAmountPrl !== "number" ||
      !Number.isFinite(merged.tipAmountPrl) ||
      merged.tipAmountPrl < 0
    ) {
      merged.tipAmountPrl = DEFAULT_UI.tipAmountPrl;
    }
    return merged;
  } catch {
    return DEFAULT_UI;
  }
}

function saveUI(s: PersistedUI): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const initial = loadUI();

export const useUI = create<UIState>((set, get) => ({
  theme: initial.theme,
  pearlRpcOverride: initial.pearlRpcOverride,
  ethRpcOverride: initial.ethRpcOverride,
  tipEnabled: initial.tipEnabled,
  tipAmountPrl: initial.tipAmountPrl,
  multisigEnabled: initial.multisigEnabled,
  ethEnabled: initial.ethEnabled,
  offlineSigningEnabled: initial.offlineSigningEnabled,
  setTheme(t) {
    set({ theme: t });
    saveUI({ ...persistedSnapshot(get()), theme: t });
  },
  setPearlRpcOverride(url) {
    // Reject non-allowlisted hosts at the boundary. The Settings UI
    // should validate before calling, but a programmatic call (devtools,
    // legacy migration, future deeplink handler) must not silently
    // persist a sentry URL that CSP will block at runtime anyway.
    if (!isAllowedRpcOverride(url)) {
      throw new Error("E_RPC_OVERRIDE_NOT_ALLOWED");
    }
    set({ pearlRpcOverride: url });
    saveUI({ ...persistedSnapshot(get()), pearlRpcOverride: url });
  },
  setEthRpcOverride(url) {
    if (!isAllowedEthRpcOverride(url)) {
      throw new Error("E_ETH_RPC_OVERRIDE_NOT_ALLOWED");
    }
    set({ ethRpcOverride: url });
    saveUI({ ...persistedSnapshot(get()), ethRpcOverride: url });
  },
  setTipEnabled(v) {
    set({ tipEnabled: v });
    saveUI({ ...persistedSnapshot(get()), tipEnabled: v });
  },
  setTipAmountPrl(v) {
    // Guard at the boundary: a non-finite or negative tip would corrupt
    // the send math. Reject silently-bad input by clamping to 0 (no tip)
    // rather than persisting garbage.
    const safe = Number.isFinite(v) && v >= 0 ? v : 0;
    set({ tipAmountPrl: safe });
    saveUI({ ...persistedSnapshot(get()), tipAmountPrl: safe });
  },
  setMultisigEnabled(v) {
    set({ multisigEnabled: v });
    saveUI({ ...persistedSnapshot(get()), multisigEnabled: v });
  },
  setEthEnabled(v) {
    set({ ethEnabled: v });
    saveUI({ ...persistedSnapshot(get()), ethEnabled: v });
  },
  setOfflineSigningEnabled(v) {
    set({ offlineSigningEnabled: v });
    saveUI({ ...persistedSnapshot(get()), offlineSigningEnabled: v });
  },
}));

function persistedSnapshot(s: UIState): PersistedUI {
  return {
    theme: s.theme,
    pearlRpcOverride: s.pearlRpcOverride,
    ethRpcOverride: s.ethRpcOverride,
    tipEnabled: s.tipEnabled,
    tipAmountPrl: s.tipAmountPrl,
    multisigEnabled: s.multisigEnabled,
    ethEnabled: s.ethEnabled,
    offlineSigningEnabled: s.offlineSigningEnabled,
  };
}
