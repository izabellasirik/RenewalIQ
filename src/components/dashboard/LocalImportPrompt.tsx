import { useState } from 'react';
import { CloudUpload, X } from 'lucide-react';
import { Button } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import type { Account } from '../../types';

/**
 * Shown once per signed-in session when there are local-only submissions this browser hasn't
 * pushed to the broker's cloud account yet — never uploads anything automatically. "Not now"
 * (or importing) marks these ids dismissed so this never asks again for the same submissions
 * (see dismissLocalImport/importAccountsToCloud in useAccountsStore).
 */
export function LocalImportPrompt({ accounts }: { accounts: Account[] }) {
  const importAccountsToCloud = useAccountsStore((s) => s.importAccountsToCloud);
  const dismissLocalImport = useAccountsStore((s) => s.dismissLocalImport);
  const [importing, setImporting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (accounts.length === 0 || dismissed) return null;

  const ids = accounts.map((a) => a.id);

  async function handleImport() {
    setImporting(true);
    await importAccountsToCloud(ids);
    setImporting(false);
    setDismissed(true);
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--color-brand-500)]/30 bg-[var(--color-brand-800)]/5 px-4 py-3.5">
      <CloudUpload size={18} className="mt-0.5 shrink-0 text-[var(--color-brand-700)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--color-ink-900)]">Local submissions found</p>
        <p className="mt-0.5 text-sm text-[var(--color-ink-600)]">
          {accounts.length === 1 ? (
            <>
              "<span className="font-medium">{accounts[0].namedInsured}</span>" was created in this browser before you signed in. Save it to your Renewal IQ account so it
              follows you across devices?
            </>
          ) : (
            <>
              {accounts.length} submissions ({accounts.map((a) => a.namedInsured).join(', ')}) were created in this browser before you signed in. Save them to your Renewal IQ
              account so they follow you across devices?
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-[var(--color-ink-400)]">
          Nothing is uploaded until you choose "Import to account." Documents already processed locally bring over their extracted data; the original file bytes for
          documents uploaded before this feature only carry over for images (a small preview is already stored) — everything else keeps its extracted fields, just not the raw file.
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <Button size="sm" icon={<CloudUpload size={13} />} onClick={handleImport} disabled={importing}>
            {importing ? 'Importing…' : 'Import to account'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              dismissLocalImport(ids);
              setDismissed(true);
            }}
            disabled={importing}
          >
            Not now
          </Button>
        </div>
      </div>
      <button onClick={() => setDismissed(true)} className="shrink-0 rounded-md p-1 text-[var(--color-ink-300)] hover:bg-[var(--color-ink-100)] cursor-pointer" aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
