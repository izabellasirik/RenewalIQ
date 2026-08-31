import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { MessageSquarePlus, CheckCircle2, CircleAlert } from 'lucide-react';
import type { FeedbackType } from '../../types';
import { FEEDBACK_TYPE_LABELS } from '../../types';
import { Drawer, Button } from '../ui';
import { submitProductFeedback } from '../../services/feedback/feedbackService';

const FEEDBACK_TYPES = Object.keys(FEEDBACK_TYPE_LABELS) as FeedbackType[];

const inputClass =
  'w-full rounded-lg border border-[var(--color-ink-200)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-ink-400)] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/15';

type SubmitState = { status: 'idle' } | { status: 'submitting' } | { status: 'success' } | { status: 'error'; message: string };

export function FeedbackWidget() {
  const location = useLocation();
  const { accountId } = useParams();

  const [open, setOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('general');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });

  function resetAndClose() {
    setOpen(false);
    // Small delay so the drawer's close animation doesn't visibly reset the form mid-exit.
    setTimeout(() => {
      setFeedbackType('general');
      setMessage('');
      setName('');
      setEmail('');
      setSubmitState({ status: 'idle' });
    }, 300);
  }

  async function handleSubmit() {
    if (!message.trim()) return;
    setSubmitState({ status: 'submitting' });
    const result = await submitProductFeedback({
      feedbackType,
      message: message.trim(),
      name: name.trim(),
      email: email.trim(),
      pagePath: location.pathname,
      accountId,
    });

    if (!result.ok) {
      setSubmitState({ status: 'error', message: result.message });
      return;
    }
    setSubmitState({ status: 'success' });
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

      <Drawer open={open} onClose={resetAndClose} title="Send Feedback" subtitle="General feedback about Renewal IQ — bugs, ideas, anything on your mind.">
        {submitState.status === 'success' ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 size={32} className="text-[var(--color-success-500)]" />
            <p className="text-sm font-medium text-[var(--color-ink-800)]">Thanks for the feedback. We've received it.</p>
            <Button variant="secondary" size="sm" onClick={resetAndClose}>
              Close
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">What would you like to tell us?</label>
              <div className="grid grid-cols-2 gap-2">
                {FEEDBACK_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setFeedbackType(t)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium cursor-pointer ${
                      feedbackType === t
                        ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-500)]/10 text-[var(--color-brand-800)]'
                        : 'border-[var(--color-ink-200)] text-[var(--color-ink-600)] hover:bg-[var(--color-ink-50)]'
                    }`}
                  >
                    {FEEDBACK_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--color-ink-700)]">Message</label>
              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="What happened, or what would make this better?"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-[var(--color-ink-400)]">
                Captured automatically: page {location.pathname}
                {accountId ? ` · submission ${accountId}` : ''}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Name (optional)</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-ink-600)]">Email (optional)</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </div>
            </div>

            {submitState.status === 'error' && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] px-3 py-2.5 text-sm text-[var(--color-danger-700)]">
                <CircleAlert size={16} className="mt-0.5 shrink-0" />
                <p>
                  <strong>Your feedback was not submitted.</strong> {submitState.message}
                </p>
              </div>
            )}

            <Button disabled={!message.trim() || submitState.status === 'submitting'} onClick={handleSubmit}>
              {submitState.status === 'submitting' ? 'Submitting…' : 'Submit Feedback'}
            </Button>
          </div>
        )}
      </Drawer>
    </>
  );
}
