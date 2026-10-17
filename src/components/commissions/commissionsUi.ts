import { createContext } from 'react';
import type { AssumptionId } from '../../services/commissions/assumptions';

/** Opens the explanation of an unconfirmed rule (provided by CommissionsPage). */
export const AssumptionContext = createContext<(id: AssumptionId) => void>(() => {});

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const thClass = 'whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-400)]';
export const tdClass = 'px-3 py-2.5 align-middle';
