import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { useWallet } from "../../state/wallet-store";
import { validPearl } from "../../lib/validate";
import { formatGrains, shortAddr } from "../../lib/format";
import { pearlTxExplorerUrl } from "../../chains/pearl/network";
import { tipAddressFor } from "../../chains/pearl/tip";
import {
  composePearlMerge,
  broadcastPearlPrecomposed,
  InsufficientFundsError,
  MERGE_TIP_GRAINS,
  type ComposedPearlTx,
} from "../../services/pearl-tx";

type FeeTier = "low" | "normal" | "high";
const FEERATE_BY_TIER: Record<FeeTier, bigint> = { low: 1n, normal: 2n, high: 4n };

// Merge / sweep: gather ALL PRL across the wallet and send the whole
// balance to ONE destination wallet — either one of the user's own
// accounts, or any external prl1 address they paste. Always pays a
// MANDATORY 0.1 PRL dev tip (cannot be turned off for this operation).
export default function Merge() {
  const navigate = useNavigate();
  const pearlNetwork = useWallet((s) => s.pearlNetwork);
  const pool = useWallet((s) => s.addresses?.pearlPool ?? (s.addresses ? [s.addresses.pearl] : []));
  const primary = useWallet((s) => s.addresses?.pearl);
  const accounts = useWallet((s) => s.accounts);
  const activeAccountId = useWallet((s) => s.activeAccountId);

  // Other accounts (besides the active one) the user can sweep into.
  const otherAccounts = accounts.filter((a) => a.id !== activeAccountId);

  // Destination mode: own primary, another own account, or a custom addr.
  type DestMode = "self" | "account" | "custom";
  const [destMode, setDestMode] = useState<DestMode>("self");
  const [destAccountAddr, setDestAccountAddr] = useState<string>(otherAccounts[0]?.pearlAddress ?? "");
  const [customAddr, setCustomAddr] = useState("");

  const [tier, setTier] = useState<FeeTier>("normal");
  const [stage, setStage] = useState<"intro" | "preview" | "sent">("intro");
  const [composed, setComposed] = useState<(ComposedPearlTx & { composedAt: number; dest: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);

  function resolveDestination(): { ok: true; dest: string } | { ok: false; reason: string } {
    if (destMode === "self") return { ok: true, dest: primary ?? pool[0]! };
    if (destMode === "account") {
      if (!destAccountAddr) return { ok: false, reason: "Pick an account to merge into." };
      return { ok: true, dest: destAccountAddr };
    }
    const a = customAddr.trim();
    if (!validPearl(a, pearlNetwork)) {
      return { ok: false, reason: "That doesn't look like a valid Pearl address." };
    }
    return { ok: true, dest: a };
  }

  async function review() {
    setError(null);
    const d = resolveDestination();
    if (!d.ok) { setError(d.reason); return; }
    setBusy(true);
    try {
      const c = await composePearlMerge({
        network: pearlNetwork,
        pool,
        destination: d.dest,
        feerateSatPerVbyte: FEERATE_BY_TIER[tier],
      });
      setComposed({ ...c, composedAt: Date.now(), dest: d.dest });
      setStage("preview");
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        setError(
          `Not enough to merge. Need at least ${formatGrains(e.need)} PRL (fee + mandatory 0.1 PRL tip), found ${formatGrains(e.have)} PRL across ${e.utxoCount} UTXO${e.utxoCount === 1 ? "" : "s"}.`,
        );
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg === "E_NO_UTXOS" ? "No spendable UTXOs to merge." : `Couldn't compose: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function broadcast() {
    if (!composed) return;
    setBusy(true);
    setError(null);
    try {
      const { composedAt, dest, ...c } = composed;
      const { txid: hash } = await broadcastPearlPrecomposed({ composed: c, composedAt }, pearlNetwork);
      setTxid(hash);
      setStage("sent");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "E_PREVIEW_STALE" ? "Selection expired — review again." : `Broadcast failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  if (stage === "sent") {
    return (
      <Page title="Merge PRL">
        <div className="card">
          <h2 className="text-lg font-semibold">Merged.</h2>
          <p className="mt-2 text-sm text-ink-500">
            Your entire PRL balance is being swept into a single wallet.
          </p>
          <p className="mt-2 break-all font-mono text-sm">{txid}</p>
          {txid && (
            <a
              href={pearlTxExplorerUrl(pearlNetwork, txid)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-pearl-700 underline dark:text-pearl-300"
            >
              View on explorer →
            </a>
          )}
          <button onClick={() => navigate("/dashboard")} className="btn-primary mt-4 w-full py-4">
            Back to dashboard
          </button>
        </div>
      </Page>
    );
  }

  if (stage === "preview" && composed) {
    const swept = composed.outputs[0]?.amountGrains ?? 0n;
    return (
      <Page title="Merge PRL">
        <div className="card">
          <h2 className="text-lg font-semibold">Confirm merge</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Coins gathered</dt>
              <dd>{composed.utxos.length} UTXO{composed.utxos.length === 1 ? "" : "s"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Total balance</dt>
              <dd>{formatGrains(composed.spendableGrains)} PRL</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Fee ({tier})</dt>
              <dd>{formatGrains(composed.feeGrains)} PRL</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Dev tip (mandatory)</dt>
              <dd>{formatGrains(MERGE_TIP_GRAINS)} PRL</dd>
            </div>
            <div className="flex justify-between border-t border-ink-200 pt-2 font-medium dark:border-ink-700">
              <dt>Sent to 1 wallet</dt>
              <dd>{formatGrains(swept)} PRL</dd>
            </div>
          </dl>
          <p className="mt-2 break-all text-xs text-ink-500">
            Destination wallet: <span className="font-mono">{composed.dest}</span>
          </p>
          <p className="mt-1 break-all text-xs text-ink-500">
            Mandatory tip to <span className="font-mono">{tipAddressFor(pearlNetwork)}</span>.
          </p>
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">This cannot be undone.</p>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStage("intro")} className="btn-secondary" disabled={busy}>Back</button>
            <button onClick={broadcast} className="btn-primary flex-1" disabled={busy} data-testid="merge-broadcast">
              {busy ? "Merging…" : "Merge & send"}
            </button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Merge PRL">
      <div className="card flex flex-col gap-3">
        <p className="text-sm text-ink-500">
          Sweep your <strong>entire</strong> PRL balance (all coins across your
          wallet) into a single destination wallet.
        </p>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          A <strong>mandatory {formatGrains(MERGE_TIP_GRAINS)} PRL developer tip</strong>{" "}
          is included in every merge (you cannot turn this one off). Normal
          sending stays free beyond network fees.
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="label">Merge into</legend>

          {/* Own primary address */}
          <label className={
            destMode === "self"
              ? "cursor-pointer rounded-xl border-2 border-pearl-700 bg-pearl-50 p-3 dark:bg-pearl-900/30"
              : "cursor-pointer rounded-xl border border-ink-300 p-3 dark:border-ink-700"
          }>
            <div className="flex items-center gap-2">
              <input type="radio" checked={destMode === "self"} onChange={() => setDestMode("self")} data-testid="merge-dest-self" />
              <span className="font-medium text-sm">My primary address (this account)</span>
            </div>
            <div className="mt-1 break-all pl-6 font-mono text-xs text-ink-500">{primary}</div>
          </label>

          {/* Another of the user's own accounts */}
          {otherAccounts.length > 0 && (
            <label className={
              destMode === "account"
                ? "cursor-pointer rounded-xl border-2 border-pearl-700 bg-pearl-50 p-3 dark:bg-pearl-900/30"
                : "cursor-pointer rounded-xl border border-ink-300 p-3 dark:border-ink-700"
            }>
              <div className="flex items-center gap-2">
                <input type="radio" checked={destMode === "account"} onChange={() => setDestMode("account")} data-testid="merge-dest-account" />
                <span className="font-medium text-sm">Another of my accounts</span>
              </div>
              <select
                className="input mt-2 ml-6 w-[calc(100%-1.5rem)]"
                value={destAccountAddr}
                onChange={(e) => { setDestAccountAddr(e.target.value); setDestMode("account"); }}
              >
                {otherAccounts.map((a) => (
                  <option key={a.id} value={a.pearlAddress}>
                    {a.label} — {shortAddr(a.pearlAddress, 10, 6)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Any custom address */}
          <label className={
            destMode === "custom"
              ? "cursor-pointer rounded-xl border-2 border-pearl-700 bg-pearl-50 p-3 dark:bg-pearl-900/30"
              : "cursor-pointer rounded-xl border border-ink-300 p-3 dark:border-ink-700"
          }>
            <div className="flex items-center gap-2">
              <input type="radio" checked={destMode === "custom"} onChange={() => setDestMode("custom")} data-testid="merge-dest-custom" />
              <span className="font-medium text-sm">Another wallet address</span>
            </div>
            <input
              className="input mono mt-2 ml-6 w-[calc(100%-1.5rem)]"
              placeholder="prl1p..."
              value={customAddr}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => { setCustomAddr(e.target.value); setDestMode("custom"); }}
              data-testid="merge-custom-addr"
            />
          </label>
        </fieldset>

        <fieldset>
          <legend className="label">Fee tier</legend>
          <div className="grid grid-cols-3 gap-2">
            {(["low", "normal", "high"] as FeeTier[]).map((t) => (
              <label
                key={t}
                className={
                  tier === t
                    ? "cursor-pointer rounded-xl border-2 border-pearl-700 bg-pearl-50 p-3 text-center text-sm dark:bg-pearl-900/30"
                    : "cursor-pointer rounded-xl border border-ink-300 p-3 text-center text-sm dark:border-ink-700"
                }
              >
                <input type="radio" className="sr-only" checked={tier === t} onChange={() => setTier(t)} />
                <div className="font-medium capitalize">{t}</div>
                <div className="text-xs text-ink-500">{FEERATE_BY_TIER[t].toString()} sat/vB</div>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="text-sm text-red-600" data-testid="merge-error">{error}</p>}

        <button onClick={review} className="btn-primary py-4" disabled={busy} data-testid="merge-review">
          {busy ? "Gathering coins…" : "Review merge"}
        </button>
      </div>
    </Page>
  );
}
