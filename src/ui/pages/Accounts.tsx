import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Page from "../components/Page";
import { useWallet } from "../../state/wallet-store";
import { validateMnemonic } from "../../crypto/mnemonic";
import { shortAddr } from "../../lib/format";

// Multi-account (Zano-style) manager: list accounts, switch the active
// one, import another mnemonic, or remove a non-active account. All
// accounts share the wallet password; importing here requires the
// wallet to be unlocked (the session password is reused so the user
// never re-types it).
export default function Accounts() {
  const navigate = useNavigate();
  const accounts = useWallet((s) => s.accounts);
  const activeAccountId = useWallet((s) => s.activeAccountId);
  const switchAccount = useWallet((s) => s.switchAccount);
  const addAccount = useWallet((s) => s.addAccount);
  const removeAccount = useWallet((s) => s.removeAccount);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [label, setLabel] = useState("");

  function friendlyError(msg: string): string {
    switch (msg) {
      case "E_ACCOUNT_EXISTS":
        return "That seed phrase is already imported as an account on this device.";
      case "E_LOCKED":
        return "Wallet is locked. Unlock it first, then import.";
      case "E_LAST_ACCOUNT":
        return "You can't remove your only account.";
      case "E_ACTIVE_ACCOUNT":
        return "Switch to another account before removing this one.";
      default:
        return msg;
    }
  }

  async function doSwitch(id: string) {
    if (id === activeAccountId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await switchAccount(id);
      navigate("/dashboard");
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setError(null);
    const phrase = mnemonic.trim();
    if (!validateMnemonic(phrase)) {
      setError("That doesn't look like a valid BIP-39 seed phrase.");
      return;
    }
    setBusy(true);
    try {
      await addAccount(phrase, label);
      setMnemonic("");
      setLabel("");
      setShowImport(false);
      navigate("/dashboard");
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function doRemove(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await removeAccount(id);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Accounts">
      <div className="card">
        <h2 className="text-sm font-semibold">Your accounts</h2>
        <ul className="mt-3 space-y-2" data-testid="account-list">
          {accounts.map((a) => {
            const active = a.id === activeAccountId;
            return (
              <li
                key={a.id}
                className={
                  active
                    ? "rounded-xl border-2 border-pearl-600 bg-pearl-50 p-3 dark:bg-pearl-900/30"
                    : "rounded-xl border border-ink-200 p-3 dark:border-ink-700"
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.label}</span>
                      {active && (
                        <span className="rounded-full bg-pearl-600 px-2 py-0.5 text-xs text-white">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 break-all font-mono text-xs text-ink-500">
                      {shortAddr(a.pearlAddress, 12, 6)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!active && (
                      <button
                        type="button"
                        onClick={() => doSwitch(a.id)}
                        disabled={busy}
                        className="btn-primary px-4 py-2 text-sm"
                        data-testid={`switch-${a.id}`}
                      >
                        Switch
                      </button>
                    )}
                    {!active && accounts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => doRemove(a.id)}
                        disabled={busy}
                        className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p className="mt-3 text-sm text-red-600" data-testid="accounts-error">{error}</p>}

      {!showImport ? (
        <button
          type="button"
          onClick={() => { setShowImport(true); setError(null); }}
          className="btn-secondary mt-4 w-full py-4"
          data-testid="import-account-open"
        >
          + Import another account
        </button>
      ) : (
        <div className="card mt-4">
          <h2 className="text-sm font-semibold">Import account from seed phrase</h2>

          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <strong>Heads up:</strong> avoid signing transactions with the same
            seed phrase on two devices at once. Pearl L1 uses stateless Taproot
            signatures, so this is not a key-leak risk — but each device tracks
            its own UTXO/address state independently, and running the same seed
            in parallel can cause one device to try spending coins the other
            already moved (failed/replaced transactions).
          </div>

          <label className="mt-3 block">
            <span className="label">Account name (optional)</span>
            <input
              className="input"
              placeholder={`Account ${accounts.length + 1}`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="import-label"
            />
          </label>
          <label className="mt-3 block">
            <span className="label">Seed phrase (12 or 24 words)</span>
            <textarea
              className="input font-mono"
              rows={3}
              placeholder="word1 word2 word3 …"
              value={mnemonic}
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setMnemonic(e.target.value)}
              data-testid="import-mnemonic"
            />
          </label>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => { setShowImport(false); setError(null); setMnemonic(""); }}
              className="btn-secondary"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doImport}
              className="btn-primary flex-1"
              disabled={busy}
              data-testid="import-submit"
            >
              {busy ? "Importing…" : "Import account"}
            </button>
          </div>
        </div>
      )}
    </Page>
  );
}
