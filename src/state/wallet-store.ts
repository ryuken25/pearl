import { create } from "zustand";
import type { PearlNetwork } from "../chains/pearl/network";
import type { EthNetwork } from "../chains/ethereum/network";
import { cryptoWorker } from "../crypto/worker-client";
import { monotonicNow } from "../lib/monotonic";
import {
  db,
  loadKeystore,
  saveKeystore,
  wipeKeystore,
  listAccounts,
  loadAccountById,
  setActiveAccountId,
  getActiveAccountId,
  deleteAccount,
  type KeystoreRecord,
  type KeystoreBlobJSON,
} from "../storage/db";

// Idle window before the wallet auto-locks. Exported so the TopBar
// countdown and the App-level interval check stay in lockstep — if one
// side hardcodes a different value the user sees "1:23 until lock"
// while the wallet is already locked, which is exactly the v0.1.0
// Low-#2 audit finding this constant addresses.
export const AUTO_LOCK_MS = 5 * 60 * 1000;

// "initializing" is the boot state before init() has read the on-disk
// keystore. Splash renders a placeholder for it instead of the
// "Create a new wallet" funnel — otherwise a user with an existing
// wallet sees the create CTA flash on every cold load before
// auto-route bumps them to /unlock, which looks broken.
export type WalletStatus = "initializing" | "no-wallet" | "locked" | "unlocked";

interface Addresses {
  // Primary Pearl receive address (index 0).
  pearl: string;
  // Full external receive pool — RECEIVE_GAP_LIMIT entries, index 0..N-1.
  // Funds discovered at any of these is "ours" because the seed derives them
  // all. UTXO scans aggregate balances across this pool.
  pearlPool: string[];
  eth: string;
}

// Public, non-secret summary of an account for the switcher UI. Holds
// only the label + the primary receive address (both public). The
// encrypted blob never leaves the keystore record.
export interface AccountSummary {
  id: string;
  label: string;
  pearlAddress: string;
}

interface WalletState {
  status: WalletStatus;
  addresses: Addresses | null;
  pearlNetwork: PearlNetwork;
  ethNetwork: EthNetwork;
  blob: KeystoreBlobJSON | null;
  lastActivity: number;
  // Multi-account: every account on this device + which one is active.
  accounts: AccountSummary[];
  activeAccountId: string | null;

  init(): Promise<void>;
  createWallet(
    strength: 128 | 256,
    password: string,
    opts?: { allowOverwrite?: boolean },
  ): Promise<{ mnemonic: string; addresses: Addresses }>;
  restoreWallet(
    mnemonic: string,
    password: string,
    opts?: { allowOverwrite?: boolean },
  ): Promise<{ addresses: Addresses }>;
  unlock(password: string): Promise<{ addresses: Addresses }>;
  lock(): Promise<void>;
  // Wipe requires the password so an attacker with brief physical access
  // can't nuke the on-device keystore (and the user's only copy of the
  // mnemonic-encrypted-at-rest) by clicking through Settings. Caller MUST
  // pass the current password; we verify by attempting to decrypt the blob.
  wipe(password: string): Promise<void>;
  exportMnemonic(password: string): Promise<string>;
  changePassword(oldPw: string, newPw: string): Promise<void>;
  touch(): void;
  setEthNetwork(net: EthNetwork): void;
  // --- Multi-account (Zano-style) ---
  // Import a mnemonic as an ADDITIONAL account (wallet must be unlocked).
  // Encrypted with the current session password; becomes the active
  // account. Rejects a seed already imported on this device.
  addAccount(mnemonic: string, label?: string): Promise<{ id: string }>;
  // Generate a brand-new account (fresh mnemonic) while unlocked.
  createAccount(strength: 128 | 256, label?: string): Promise<{ id: string; mnemonic: string }>;
  // Switch the active account. Re-derives keys in the worker from the
  // retained session password.
  switchAccount(id: string): Promise<void>;
  // Remove a non-active account. Refuses to remove the last/active one.
  removeAccount(id: string): Promise<void>;
}

// Session-only copy of the wallet password, retained in memory ONLY
// while the wallet is unlocked so the user can switch / import accounts
// without re-typing it. Deliberate tradeoff: multi-account UX vs. the
// upstream "retain nothing" posture. It is NEVER persisted, NEVER
// broadcast cross-tab, and is wiped on lock / auto-lock / wipe. All
// accounts share this one password.
let sessionPassword: string | null = null;

// Build the public account-summary list from the keystore. Used to
// refresh the switcher after create/import/switch/remove.
async function accountSummaries(): Promise<AccountSummary[]> {
  const recs = await listAccounts();
  return recs.map((r, i) => ({
    id: r.id,
    label: r.label ?? (r.id === "primary" ? "Account 1" : `Account ${i + 1}`),
    pearlAddress: r.publicData.pearlAddress,
  }));
}

function recordFromAddresses(
  id: string,
  label: string,
  blob: KeystoreBlobJSON,
  addresses: Addresses,
  pearlNetwork: PearlNetwork,
  ethNetwork: EthNetwork,
): KeystoreRecord {
  return {
    id,
    version: 1,
    label,
    blob,
    publicData: {
      pearlAddress: addresses.pearl,
      pearlAddressPool: addresses.pearlPool,
      ethAddress: addresses.eth,
      pearlNetwork,
      ethNetwork,
      createdAt: Date.now(),
    },
  };
}

// Cross-tab notification when the keystore blob is rewritten (currently:
// changePassword). Other tabs reload the on-disk record so a subsequent
// changePassword-from-Tab-B doesn't race-overwrite Tab-A's new password.
const KEYSTORE_BROADCAST_CHANNEL = "pearl-wallet-keystore";

// Per-tab sender id. Every KeystoreEvent we broadcast carries this id so
// the persistent receive handler can ignore our own messages — without
// it, a `changePassword` in Tab A broadcasts `blob-updated`, the same
// tab's listener receives it back, force-locks the freshly-rotated
// session, and the user sees "wallet locked itself after I changed my
// password" as flagged by the v0.1.7 audit (opus2 H3). crypto.randomUUID
// is fine here — it's a tag, not a secret.
const SENDER_ID: string =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type KeystoreEvent =
  | { type: "blob-updated"; sender: string }
  | { type: "wiped"; sender: string };

// Module-scope channel handle. Owned by init() to make BroadcastChannel
// allocation idempotent across React.StrictMode double-effects, and so a
// future dispose hook can close it.
let keystoreChannel: BroadcastChannel | null = null;
let storeInitialized = false;

function broadcastKeystoreEvent(ev: Omit<KeystoreEvent, "sender">): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const payload = { ...ev, sender: SENDER_ID } as KeystoreEvent;
    // Reuse the persistent channel if init() has wired it; otherwise
    // fall through to an ephemeral channel (covers wipe() called before
    // init() resolves in edge cases).
    if (keystoreChannel) {
      keystoreChannel.postMessage(payload);
      return;
    }
    const ch = new BroadcastChannel(KEYSTORE_BROADCAST_CHANNEL);
    ch.postMessage(payload);
    ch.close();
  } catch {
    // BroadcastChannel unsupported (older Safari) — silent fallback.
  }
}

/** Test-only export of the per-tab sender id. */
export function __broadcastSenderIdForTests(): string {
  return SENDER_ID;
}

/** Test-only export of the broadcast channel name. */
export function __broadcastChannelNameForTests(): string {
  return KEYSTORE_BROADCAST_CHANNEL;
}

// Test-only reset hook. The Zustand store is process-global so a vitest
// suite that exercises init() repeatedly needs a way to undo the
// once-only guard. Production code never calls this.
export function __resetWalletStoreForTests(): void {
  if (keystoreChannel) {
    try { keystoreChannel.close(); } catch { /* noop */ }
  }
  keystoreChannel = null;
  storeInitialized = false;
}

// Serializes mutating store operations against broadcast handlers so a
// cross-tab `wiped` event can't interleave with a local unlock/restore/
// changePassword. Without this, a peer-tab wipe can leave Tab A with
// status="unlocked", blob=null but addresses populated — the next refresh
// nukes the in-memory mnemonic the user just exfilable via Settings.
function makeAsyncLock() {
  let chain: Promise<unknown> = Promise.resolve();
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = chain;
    let release!: () => void;
    chain = new Promise<void>((res) => (release = res));
    try {
      await prev;
    } catch {
      // prior operation failed — that's the prior caller's problem
    }
    try {
      return await fn();
    } finally {
      release();
    }
  };
}
const walletLock = makeAsyncLock();

export const useWallet = create<WalletState>((set, get) => ({
  status: "initializing",
  addresses: null,
  pearlNetwork: "mainnet",
  ethNetwork: "mainnet",
  blob: null,
  accounts: [],
  activeAccountId: null,
  // monotonicNow() — see lib/monotonic.ts. Date.now() would be subject
  // to wall-clock manipulation that defeats the auto-lock window.
  lastActivity: monotonicNow(),

  async init() {
    // Idempotent: under React.StrictMode dev, App's useEffect mounts
    // twice and would otherwise (a) re-overwrite an in-flight unlock
    // back to "locked" and (b) leak a duplicate BroadcastChannel
    // listener for every reload.
    if (storeInitialized) return;
    storeInitialized = true;
    const rec = await loadKeystore();
    if (rec) {
      // Self-heal the active pointer if it's missing/dangling so the
      // switcher highlights the right account on first paint.
      const storedActive = await getActiveAccountId();
      if (storedActive !== rec.id) await setActiveAccountId(rec.id);
      set({
        status: "locked",
        blob: rec.blob,
        addresses: {
          pearl: rec.publicData.pearlAddress,
          pearlPool: rec.publicData.pearlAddressPool ?? [rec.publicData.pearlAddress],
          eth: rec.publicData.ethAddress,
        },
        pearlNetwork: "mainnet",
        ethNetwork: rec.publicData.ethNetwork,
        accounts: await accountSummaries(),
        activeAccountId: rec.id,
      });
    } else {
      set({ status: "no-wallet", accounts: [], activeAccountId: null });
    }
    // Multi-tab keystore sync. Wired at init() instead of module-scope so
    // a test environment without BroadcastChannel doesn't blow up at
    // import time.
    if (typeof BroadcastChannel !== "undefined" && !keystoreChannel) {
      try {
        keystoreChannel = new BroadcastChannel(KEYSTORE_BROADCAST_CHANNEL);
        keystoreChannel.onmessage = (ev: MessageEvent<KeystoreEvent>) => {
          // Ignore our own broadcasts. BroadcastChannel delivers to every
          // listener bound to the channel name in the same origin —
          // including the very tab that posted the message. Without this
          // self-filter, Tab A's own `changePassword` would trigger Tab
          // A's force-lock handler. SENDER_ID is unique per tab so this
          // discriminator is exact (no false positives across tabs).
          if (ev.data && (ev.data as KeystoreEvent).sender === SENDER_ID) return;
          // Wrap inside the async lock so we cannot interleave with an
          // in-flight unlock/restoreWallet/changePassword. Without this,
          // a peer-tab wipe between `cryptoWorker.call("unlock")` resolving
          // and the post-resolve `set({status:"unlocked"})` would leave
          // status=unlocked but blob=null — wallet "works" until refresh
          // then loses the mnemonic.
          void walletLock(async () => {
            if (ev.data.type === "blob-updated") {
              const fresh = await loadKeystore();
              if (fresh) {
                // Lock this tab on a foreign password change — the in-memory
                // session was derived from the OLD password; using it against
                // the new blob would fail anyway, and the cleanest UX is to
                // require an unlock with the new password.
                sessionPassword = null;
                cryptoWorker.reset();
                set({ status: "locked", blob: fresh.blob });
              } else {
                // Foreign update with no row — likely a wipe arrived first.
                // Treat as wiped so we don't dangle in stale "unlocked".
                sessionPassword = null;
                cryptoWorker.reset();
                set({ status: "no-wallet", addresses: null, blob: null, accounts: [], activeAccountId: null });
              }
            } else if (ev.data.type === "wiped") {
              sessionPassword = null;
              cryptoWorker.reset();
              set({ status: "no-wallet", addresses: null, blob: null, accounts: [], activeAccountId: null });
            }
          });
        };
      } catch {
        // BroadcastChannel unsupported — single-tab mode is still safe.
      }
    }
  },

  async createWallet(strength, password, opts) {
    return walletLock(async () => {
      // Existing-wallet guard — prevents the v0.1.5 fund-loss footgun where
      // clicking "Create a new wallet" from Splash silently overwrites the
      // existing encrypted keystore. Caller must explicitly opt-in by passing
      // allowOverwrite (the UI requires "wipe my wallet" confirmation).
      const existing = await loadKeystore();
      if (existing && !opts?.allowOverwrite) {
        throw new Error("E_WALLET_EXISTS");
      }
      const { pearlNetwork, ethNetwork } = get();
      const out = await cryptoWorker.call<"createWallet", {
        mnemonic: string;
        blob: KeystoreBlobJSON;
        addresses: Addresses;
      }>("createWallet", { strength, password, network: pearlNetwork });

      const rec = recordFromAddresses(
        "primary",
        "Account 1",
        out.blob,
        out.addresses,
        pearlNetwork,
        ethNetwork,
      );
      await saveKeystore(rec);
      await setActiveAccountId("primary");
      // Retain the password for the unlocked session (multi-account
      // switching). Cleared on lock.
      sessionPassword = password;
      set({
        status: "unlocked",
        addresses: out.addresses,
        blob: out.blob,
        activeAccountId: "primary",
        accounts: await accountSummaries(),
        lastActivity: monotonicNow(),
      });
      return { mnemonic: out.mnemonic, addresses: out.addresses };
    });
  },

  async restoreWallet(mnemonic, password, opts) {
    return walletLock(async () => {
      const existing = await loadKeystore();
      if (existing && !opts?.allowOverwrite) {
        throw new Error("E_WALLET_EXISTS");
      }
      const { pearlNetwork, ethNetwork } = get();
      const out = await cryptoWorker.call<"restoreWallet", {
        mnemonic: string;
        blob: KeystoreBlobJSON;
        addresses: Addresses;
      }>("restoreWallet", { mnemonic, password, network: pearlNetwork });

      const rec = recordFromAddresses(
        "primary",
        "Account 1",
        out.blob,
        out.addresses,
        pearlNetwork,
        ethNetwork,
      );
      await saveKeystore(rec);
      await setActiveAccountId("primary");
      sessionPassword = password;
      set({
        status: "unlocked",
        addresses: out.addresses,
        blob: out.blob,
        activeAccountId: "primary",
        accounts: await accountSummaries(),
        lastActivity: monotonicNow(),
      });
      return { addresses: out.addresses };
    });
  },

  async unlock(password) {
    return walletLock(async () => {
      const { blob, pearlNetwork } = get();
      if (!blob) throw new Error("E_NO_WALLET");
      const out = await cryptoWorker.call<"unlock", { addresses: Addresses }>("unlock", {
        blob,
        password,
        network: pearlNetwork,
      });
      // Cross-tab race guard: another tab may have wiped the keystore
      // between our `unlock` call landing and this resume. If the row is
      // gone now, the in-memory worker session would dangle without a
      // matching on-disk blob — clean up and surface E_WALLET_WIPED.
      const rec = await loadKeystore();
      if (!rec) {
        cryptoWorker.reset();
        set({ status: "no-wallet", addresses: null, blob: null });
        throw new Error("E_WALLET_WIPED");
      }
      // Persist the freshly-derived pool back to the keystore so a record
      // saved by an older build (without pearlAddressPool) gets upgraded
      // without requiring a wipe-and-restore.
      const needsUpdate =
        !Array.isArray(rec.publicData.pearlAddressPool) ||
        rec.publicData.pearlAddressPool.length !== out.addresses.pearlPool.length ||
        rec.publicData.pearlAddressPool.some((a, i) => a !== out.addresses.pearlPool[i]);
      if (needsUpdate) {
        rec.publicData.pearlAddressPool = out.addresses.pearlPool;
        rec.publicData.pearlAddress = out.addresses.pearl;
        await saveKeystore(rec);
      }
      // Retain password for multi-account switching this session.
      sessionPassword = password;
      set({
        status: "unlocked",
        addresses: out.addresses,
        activeAccountId: rec.id,
        accounts: await accountSummaries(),
        lastActivity: monotonicNow(),
      });
      return { addresses: out.addresses };
    });
  },

  async lock() {
    // Drop the retained session password first — an auto-lock must not
    // leave it resident for an account-switch to silently re-derive keys.
    sessionPassword = null;
    await cryptoWorker.call<"lock">("lock", {}).catch(() => undefined);
    cryptoWorker.reset();
    // v0.2.4 (SEC, pass-2 M-2): clear addresses on lock. They survive
    // re-load because they sit in publicData on the keystore row, but
    // holding them in the live store while status="locked" means a
    // useQuery with `enabled: !!addresses` can fire one balance/activity
    // RPC during the lock-transition tick. Clearing them shuts that
    // window: addresses come back on the next successful unlock(),
    // which is the only path that legitimately needs them.
    set({ status: "locked", addresses: null });
  },

  async wipe(password) {
    return walletLock(async () => {
      const { blob, status } = get();
      // No-wallet wipe is a UX trap: clicking "Wipe" against an empty
      // keystore would silently "succeed" with any password, which can
      // lull a user into thinking they wiped something they didn't.
      // Refuse explicitly.
      if (status === "no-wallet" || !blob) {
        throw new Error("E_NO_WALLET");
      }
      // Password-gate the wipe by attempting to decrypt the blob. A wrong
      // password throws E_PASSWORD_WRONG and we keep the keystore intact.
      await cryptoWorker.call<"exportMnemonic", { mnemonic: string }>(
        "exportMnemonic",
        { password, blob },
      );
      sessionPassword = null;
      cryptoWorker.reset();
      await wipeKeystore();
      broadcastKeystoreEvent({ type: "wiped" });
      set({ status: "no-wallet", addresses: null, blob: null, accounts: [], activeAccountId: null });
    });
  },

  async exportMnemonic(password) {
    const { blob } = get();
    if (!blob) throw new Error("E_NO_WALLET");
    const out = await cryptoWorker.call<"exportMnemonic", { mnemonic: string }>(
      "exportMnemonic",
      { password, blob },
    );
    return out.mnemonic;
  },

  async changePassword(oldPw, newPw) {
    return walletLock(async () => {
      const { blob, activeAccountId } = get();
      if (!blob) throw new Error("E_NO_WALLET");
      // Multi-account: ALL accounts share one password, so a change must
      // re-encrypt every account's blob — otherwise the others become
      // unusable (their old password is gone). We decrypt+re-encrypt each
      // via the worker. The first failure (wrong old password) aborts
      // before any record is written: we stage the new blobs, then commit.
      const all = await listAccounts();
      if (all.length === 0) {
        cryptoWorker.reset();
        set({ status: "no-wallet", addresses: null, blob: null, accounts: [], activeAccountId: null });
        throw new Error("E_WALLET_WIPED");
      }
      const staged: KeystoreRecord[] = [];
      for (const rec of all) {
        const out = await cryptoWorker.call<"changePassword", { blob: KeystoreBlobJSON }>(
          "changePassword",
          { oldPassword: oldPw, newPassword: newPw, blob: rec.blob },
        );
        staged.push({ ...rec, blob: out.blob });
      }
      // Commit all re-encrypted blobs.
      for (const rec of staged) {
        await db.keystore.put(rec);
      }
      const active = staged.find((r) => r.id === activeAccountId) ?? staged[0]!;
      // Update the retained session password so switching keeps working.
      sessionPassword = newPw;
      set({ blob: active.blob });
      // Multi-tab safety: another open tab loaded the old blob into its
      // closure at init() time. Tell it the on-disk record changed so it
      // refreshes — otherwise that tab's next operation reads stale
      // ciphertext and either fails with E_PASSWORD_WRONG (confusing) or
      // races a saveKeystore that resurrects the old password.
      broadcastKeystoreEvent({ type: "blob-updated" });
    });
  },

  touch() {
    set({ lastActivity: monotonicNow() });
  },

  setEthNetwork(net) {
    set({ ethNetwork: net });
  },

  async addAccount(mnemonic, label) {
    return walletLock(async () => {
      if (!sessionPassword) throw new Error("E_LOCKED");
      const { pearlNetwork, ethNetwork } = get();
      // Reuse the upstream restore primitive verbatim — it derives the
      // BIP-39 seed + Taproot keys and returns a fresh encrypted blob.
      // After this call the worker session holds THIS account's keys.
      const out = await cryptoWorker.call<"restoreWallet", {
        blob: KeystoreBlobJSON;
        addresses: Addresses;
      }>("restoreWallet", { mnemonic, password: sessionPassword, network: pearlNetwork });

      // Reject a duplicate import: same primary address ⇒ same seed.
      const existing = await listAccounts();
      if (existing.some((r) => r.publicData.pearlAddress === out.addresses.pearl)) {
        // Re-derive the active account back into the worker so the
        // session isn't left pointing at the rejected import's keys.
        const active = existing.find((r) => r.id === get().activeAccountId);
        if (active) {
          await cryptoWorker.call("unlock", {
            blob: active.blob,
            password: sessionPassword,
            network: pearlNetwork,
          }).catch(() => undefined);
        }
        throw new Error("E_ACCOUNT_EXISTS");
      }

      const id = crypto.randomUUID();
      const finalLabel = label?.trim() || `Account ${existing.length + 1}`;
      const rec = recordFromAddresses(id, finalLabel, out.blob, out.addresses, pearlNetwork, ethNetwork);
      await saveKeystore(rec);
      await setActiveAccountId(id);
      set({
        status: "unlocked",
        addresses: out.addresses,
        blob: out.blob,
        activeAccountId: id,
        accounts: await accountSummaries(),
        lastActivity: monotonicNow(),
      });
      return { id };
    });
  },

  async createAccount(strength, label) {
    return walletLock(async () => {
      if (!sessionPassword) throw new Error("E_LOCKED");
      const { pearlNetwork, ethNetwork } = get();
      const out = await cryptoWorker.call<"createWallet", {
        mnemonic: string;
        blob: KeystoreBlobJSON;
        addresses: Addresses;
      }>("createWallet", { strength, password: sessionPassword, network: pearlNetwork });
      const existing = await listAccounts();
      const id = crypto.randomUUID();
      const finalLabel = label?.trim() || `Account ${existing.length + 1}`;
      const rec = recordFromAddresses(id, finalLabel, out.blob, out.addresses, pearlNetwork, ethNetwork);
      await saveKeystore(rec);
      await setActiveAccountId(id);
      set({
        status: "unlocked",
        addresses: out.addresses,
        blob: out.blob,
        activeAccountId: id,
        accounts: await accountSummaries(),
        lastActivity: monotonicNow(),
      });
      return { id, mnemonic: out.mnemonic };
    });
  },

  async switchAccount(id) {
    return walletLock(async () => {
      if (!sessionPassword) throw new Error("E_LOCKED");
      if (id === get().activeAccountId) return;
      const rec = await loadAccountById(id);
      if (!rec) throw new Error("E_NO_ACCOUNT");
      const { pearlNetwork } = get();
      const out = await cryptoWorker.call<"unlock", { addresses: Addresses }>("unlock", {
        blob: rec.blob,
        password: sessionPassword,
        network: pearlNetwork,
      });
      await setActiveAccountId(id);
      set({
        addresses: out.addresses,
        blob: rec.blob,
        activeAccountId: id,
        lastActivity: monotonicNow(),
      });
    });
  },

  async removeAccount(id) {
    return walletLock(async () => {
      const { activeAccountId } = get();
      const all = await listAccounts();
      if (all.length <= 1) throw new Error("E_LAST_ACCOUNT");
      if (id === activeAccountId) throw new Error("E_ACTIVE_ACCOUNT");
      await deleteAccount(id);
      set({ accounts: await accountSummaries() });
    });
  },
}));
