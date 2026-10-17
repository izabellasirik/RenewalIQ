import { useCallback, useEffect, useState } from 'react';
import { clearSampleLedger, freshSampleLedger, loadSampleLedger, saveSampleLedger, type Result, type SampleLedger } from '../../services/commissions/sampleLedger';

/**
 * This admin's working copy of the fictional sample ledger, kept in this browser (per user) so a
 * reload keeps the demo where it was. Never sent to Supabase.
 */
export function useSampleLedger(userId: string) {
  const [ledger, setLedger] = useState<SampleLedger>(() => loadSampleLedger(userId));
  const [status, setStatus] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);

  useEffect(() => setLedger(loadSampleLedger(userId)), [userId]);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status]);

  /** Applies a change; returns its errors (empty when it was saved). */
  const apply = useCallback(
    (r: Result): string[] => {
      if (!r.ok) {
        setStatus({ message: r.errors[0], tone: 'danger' });
        return r.errors;
      }
      if (r.ledger !== ledger) {
        setLedger(r.ledger);
        saveSampleLedger(userId, r.ledger);
      }
      setStatus({ message: r.message, tone: 'success' });
      return [];
    },
    [ledger, userId]
  );

  const reset = useCallback(() => {
    clearSampleLedger(userId);
    setLedger(freshSampleLedger());
    setStatus({ message: 'Sample data restored.', tone: 'success' });
  }, [userId]);

  return { ledger, apply, reset, status };
}
