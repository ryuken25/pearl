import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { useWallet } from "../../state/wallet-store";
import { useUI } from "../../state/ui-store";
import { validPearl } from "../../lib/validate";
import { formatGrains, parsePRL } from "../../lib/format";
import { pearlTxExplorerUrl } from "../../chains/pearl/network";
import { tipAddressFor } from "../../chains/pearl/tip";
import {
  composePearlMultiSend,
  broadcastPearlPrecomposed,
  InsufficientFundsError,
  type ComposedPearlTx,
  type MultiRecipient,
} from "../../services/pearl-tx";

type FeeTier = "low" | "normal" | "high";
const FEERATE_BY_TIER: Record<FeeTier, bigint> = { low: 1n, normal: 2n, high: 4n };

interface Row {
  address: string;
  amount: string;
}

// OKX-style batch send: many recipients, ONE signed transaction. Pearl L1
// uses stateless Taproot signatures + UTXO model, so a batch is correctly
// a single multi-output tx (no per-recipient key state to advance, and no
// risk of double-spending the same coin across the batch). The optional
// dev tip is one more output on the same tx.
export default function MultiSend() {
  const navigate = useNavigate();
  const pearlNetwork = useWallet((s) => s.pearlNetwork);
  const pool = useWallet((s) => s.addresses?.pearlPool ?? (s.addresses ? [s.addresses.pearl] : []));
  const tipEnabled = useUI((s) => s.tipEnabled);
  const tipAmountPrl = useUI((s) => s.tipAmountPrl);

  const [rows, setRows] = useState<Row[]>([
    { address: "", amount: "" },
    { address: "", amount: "" },
  ]);
  const [tier, setTier] = useState<FeeTier>("normal");
  const [tipThisTx, setTipThisTx] = useState(tipEnabled);
  const [stage, setStage] = useState<"compose" | "preview" | "sent">("compose");
  const [composed, setComposed] = useState<(ComposedPearlTx & { composedAt: number }) | null>(null);
  const [recipients, setRecipients] = useState<MultiRecipient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);

  let tipGrains = 0n;
  try { tipGrains = parsePRL(String(tipAmountPrl)); } catch { tipGrains = 0n; }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { address: "", amount: "" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i)));
  }

  function validateRows(): { ok: true; recipients: MultiRecipient[] } | { ok: false; reason: string } {
    const out: MultiRecipient[] = [];
    const filled = rows.filter((r) => r.address.trim() !== "" || r.amount.trim() !== "");
    if (filled.length === 0) return { ok: false, reason: "Add at least one recipient." };
    for (let i = 0; i < filled.length; i++) {
      const r = filled[i]!;
      if (!validPearl(r.address.trim(), pearlNetwork)) {
        return { ok: false, reason: `Recipient #${i + 1}: invalid Pearl address.` };
      }
      let grains: bigint;
      try { grains = parsePRL(r.amount); } catch { return { ok: false, reason: `Recipient #${i + 1}: invalid amount.` }; }
      if (grains <= 0n) return { ok: false, reason: `Recipient #${i + 1}: amount must be > 0.` };
      out.push({ address: r.address.trim(), amountGrains: grains });
    }
    return { ok: true, recipients: out };
  }

  async function review() {
    setError(null);
    const v = validateRows();
    if (!v.ok) { setError(v.reason); return; }
    setBusy(true);
    try {
      const c = await composePearlMultiSend({
        network: pearlNetwork,
        pool,
        recipients: v.recipients,
        feerateSatPerVbyte: FEERATE_BY_TIER[tier],
        includeTip: tipThisTx,
        tipGrains,
      });
      setRecipients(v.recipients);
      setComposed({ ...c, composedAt: Date.now() });
      setStage("preview");
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        setError(
          `Not enough spendable PRL. Need ${formatGrains(e.need)} PRL (recipients + fee + tip), found ${formatGrains(e.have)} PRL across ${e.utxoCount} UTXO${e.utxoCount === 1 ? "" : "s"}.`,
        );
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg === "E_NO_UTXOS" ? "No spendable UTXOs found." : `Couldn't compose: ${msg}`);
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
      const { composedAt, ...c } = composed;
      const { txid: hash } = await broadcastPearlPrecomposed({ composed: c, composedAt }, pearlNetwork);
      setTxid(hash);
      setStage("sent");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === "E_PREVIEW_STALE" ? "Selection expired — go back and review again." : `Broadcast failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  const totalRecipients = recipients.reduce((s, r) => s + r.amountGrains, 0n);

  if (stage === "sent") {
    return (
      <Page title="Send to many">
        <div className="card">
          <h2 className="text-lg font-semibold">Broadcast.</h2>
          <p className="mt-2 text-sm text-ink-500">
            One transaction paid {recipients.length} recipient
            {recipients.length === 1 ? "" : "s"}.
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
    return (
      <Page title="Send to many">
        <div className="card">
          <h2 className="text-lg font-semibold">Confirm batch</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {recipients.map((r, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="break-all font-mono text-xs text-ink-500">{r.address}</span>
                <span className="shrink-0">{formatGrains(r.amountGrains)} PRL</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-2 border-t border-ink-200 pt-3 text-sm dark:border-ink-700">
            <div className="flex justify-between">
              <dt className="text-ink-500">Recipients total</dt>
              <dd>{formatGrains(totalRecipients)} PRL</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Fee ({tier})</dt>
              <dd>{formatGrains(composed.feeGrains)} PRL</dd>
            </div>
            {composed.tipGrains > 0n && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Dev tip</dt>
                <dd>{formatGrains(composed.tipGrains)} PRL</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-500">Change back to you</dt>
              <dd>{formatGrains(composed.changeGrains)} PRL</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Inputs</dt>
              <dd>{composed.utxos.length} UTXO{composed.utxos.length === 1 ? "" : "s"}</dd>
            </div>
            <div className="flex justify-between border-t border-ink-200 pt-2 font-medium dark:border-ink-700">
              <dt>Total leaving wallet</dt>
              <dd>{formatGrains(totalRecipients + composed.feeGrains + composed.tipGrains)} PRL</dd>
            </div>
          </dl>
          {composed.tipGrains > 0n && (
            <p className="mt-2 break-all text-xs text-ink-500">
              Tip goes to <span className="font-mono">{tipAddressFor(pearlNetwork)}</span>.
            </p>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">This cannot be undone.</p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStage("compose")} className="btn-secondary" disabled={busy}>Back</button>
            <button onClick={broadcast} className="btn-primary flex-1" disabled={busy} data-testid="multisend-broadcast">
              {busy ? "Sending…" : `Send to ${recipients.length}`}
            </button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Send to many">
      <div className="card flex flex-col gap-3">
        <p className="text-xs text-ink-500">
          Pay several people in a single transaction. One signed tx, one fee.
        </p>
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-ink-200 p-3 dark:border-ink-700" data-testid={`recipient-row-${i}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-500">Recipient #{i + 1}</span>
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(i)} className="text-xs text-red-600 hover:underline">
                  Remove
                </button>
              )}
            </div>
            <input
              className="input mono mt-2"
              placeholder="prl1p..."
              value={r.address}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setRow(i, { address: e.target.value })}
              data-testid={`recipient-address-${i}`}
            />
            <input
              className="input mono mt-2"
              inputMode="decimal"
              placeholder="Amount (PRL)"
              value={r.amount}
              onChange={(e) => setRow(i, { amount: e.target.value })}
              data-testid={`recipient-amount-${i}`}
            />
          </div>
        ))}

        <button type="button" onClick={addRow} className="btn-secondary" data-testid="add-recipient">
          + Add recipient
        </button>

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

        <label className="flex items-start gap-3 rounded-xl border border-ink-200 p-4 text-sm dark:border-ink-700">
          <input
            type="checkbox"
            checked={tipThisTx}
            onChange={(e) => setTipThisTx(e.target.checked)}
            className="mt-0.5 h-5 w-5"
          />
          <span>
            Send <span className="font-medium">{formatGrains(tipGrains)} PRL</span> tip to support the dev
            <span className="ml-1 text-xs text-ink-500"> — one extra output on this batch.</span>
          </span>
        </label>

        {error && <p className="text-sm text-red-600" data-testid="multisend-error">{error}</p>}

        <button onClick={review} className="btn-primary py-4" disabled={busy} data-testid="multisend-review">
          {busy ? "Composing…" : "Review batch"}
        </button>
      </div>
    </Page>
  );
}
