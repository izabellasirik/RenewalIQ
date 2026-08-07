import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { MessageSquarePlus, CheckCircle2 } from 'lucide-react';
import type { FeedbackSeverity } from '../../types';
import { Drawer, Button } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';

const SEVERITIES: { key: FeedbackSeverity; label: string }[] = [
  { key: 'bug', label: 'Something broken' },
  { key: 'idea', label: 'Idea / suggestion' },
  { key: 'question', label: 'Question' },
  { key: 'other', label: 'Other' },
];

export function FeedbackWidget() {
  const location = useLocation();
  const { accountId } = useParams();
  const submitFeedback = useAccountsStore((s) => s.submitFeedback);

  const [open, setOpen] = useState(false);
  const [severity, setSeverity] = useState<FeedbackSeverity>('bug');
  const [message, setMessage] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);

  function handleSubmit() {
    if (!message.trim()) return;
    submitFeedback({ page: location.pathname, accountId, severity, message: message.trim() });
    setJustSubmitted(true);
    setMessage('');
    setTimeout(() => {
      setJustSubmitted(false);
      setOpen(false);
    }, 1400);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-[var(--color-brand-800)] px-4 py-3 text-sm font-medium text-white shadow-lg transition-transform hover:scale-105 hover:bg-[var(--color-brand-700)] cursor-pointer"
      >
        <MessageSquarePlus size={17} />
        Feedback
      </button>

      <Drawer open={open} onClose={() => setOpen(false)} title="Send Feedback" subtitle="Design-partner preview — help us improve Renewal IQ.">
        {justSubmitted ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 size={32} className="text-[var(--color-success-500)]" />
            <p className="text-sm font-medium text-[var(--color-ink-800)]">Thanks — logged.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-[var(--color-ink-500)]">
              Stored locally in this browser for this preview — not sent anywhere else. We'll review it with you directly.
            </p>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">What's this about?</label>
              <div className="grid grid-cols-2 gap-2">
                {SEVERITIES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSeverity(s.key)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer ${
                      severity === s.key
                        ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-500)]/10 text-[var(--color-brand-800)]'
                        : 'border-[var(--color-ink-200)] text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">Details</label>
              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="What happened, or what would make this better?"
                className="w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15"
              />
              <p className="mt-1 text-xs text-[var(--color-ink-400)]">
                Captured automatically: page {location.pathname}
                {accountId ? ` · submission ${accountId}` : ''}
              </p>
            </div>

            <Button disabled={!message.trim()} onClick={handleSubmit}>
              Submit Feedback
            </Button>
          </div>
        )}
      </Drawer>
    </>
  );
}
