import { useEffect, useRef, useState } from "react";
import Page from "../components/Page";
import { useWallet } from "../../state/wallet-store";
import { dataUrl } from "../../lib/qr";

// Receive is LOCKED to the active account's single primary prl1 address
// (HD index 0). We deliberately do NOT surface the full receive-address
// pool or let the user mint new/random addresses here — one fixed,
// shareable address per account, QR + copy only. (The wallet still
// aggregates balances across the derived pool internally; that's an
// implementation detail the Receive screen doesn't expose.)
export default function Receive() {
  const addresses = useWallet((s) => s.addresses);
  const accounts = useWallet((s) => s.accounts);
  const activeAccountId = useWallet((s) => s.activeAccountId);
  const activeLabel =
    accounts.find((a) => a.id === activeAccountId)?.label ?? "Account";

  const addr = addresses?.pearl;
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const copiedFlagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!addr) return;
    void dataUrl(addr).then(setQr);
  }, [addr]);

  useEffect(() => {
    return () => {
      if (copiedFlagTimerRef.current) clearTimeout(copiedFlagTimerRef.current);
      if (clipboardClearTimerRef.current) clearTimeout(clipboardClearTimerRef.current);
    };
  }, []);

  // Auto-clear the clipboard 60s after copy (privacy/correlation hygiene),
  // but only if it still holds exactly our address.
  async function copy() {
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      if (copiedFlagTimerRef.current) clearTimeout(copiedFlagTimerRef.current);
      copiedFlagTimerRef.current = setTimeout(() => setCopied(false), 1500);
      if (clipboardClearTimerRef.current) clearTimeout(clipboardClearTimerRef.current);
      const copiedAddr = addr;
      clipboardClearTimerRef.current = setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText();
          if (current === copiedAddr) await navigator.clipboard.writeText("");
        } catch {
          // best-effort
        }
      }, 60_000);
    } catch {
      // ignore
    }
  }

  return (
    <Page title="Receive PRL">
      <div className="card flex flex-col items-center">
        <div className="mb-3 text-sm text-ink-500">{activeLabel} · primary address</div>
        {qr ? (
          <img
            src={qr}
            alt="PRL receive address QR code"
            data-testid="receive-qr"
            className="h-64 w-64 rounded-lg bg-white p-2"
          />
        ) : (
          <div className="h-64 w-64 animate-pulse rounded-lg bg-ink-100 dark:bg-ink-800" />
        )}
        <div
          className="mt-4 max-w-full break-all text-center font-mono text-sm"
          data-testid="receive-address"
        >
          {addr}
        </div>
        <button
          type="button"
          onClick={copy}
          className="btn-primary mt-5 w-full py-4 text-base"
          data-testid="receive-copy"
        >
          {copied ? "Copied!" : "Copy address"}
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-ink-500">
        This is your account's fixed Pearl L1 (PRL) receive address. Pearl L1
        only — do not send other assets here. Anyone can send PRL to this
        address; it never changes.
      </p>
    </Page>
  );
}
