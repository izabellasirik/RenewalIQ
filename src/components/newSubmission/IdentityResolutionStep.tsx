import { useState } from 'react';
import { CircleCheck, TriangleAlert, CircleHelp } from 'lucide-react';
import type { FieldValue } from '../../types';
import { US_STATES } from '../../utils/usStates';

type InputKind = 'text' | 'state';

function IdentityField({
  label,
  field,
  inputKind,
  onResolve,
}: {
  label: string;
  field: FieldValue<string>;
  inputKind: InputKind;
  onResolve: (value: string) => void;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');

  if (!field.isMissing && !field.isConflicting) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--color-success-100)] bg-[var(--color-success-100)]/30 px-4 py-3">
        <CircleCheck size={16} className="shrink-0 text-[var(--color-success-600)]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[var(--color-ink-500)]">{label}</p>
          <p className="text-sm font-semibold text-[var(--color-ink-900)]">{field.value}</p>
        </div>
        {field.source && <span className="shrink-0 text-xs text-[var(--color-ink-400)]">from {field.source.documentName}</span>}
      </div>
    );
  }

  const candidates = field.isConflicting
    ? [
        ...(field.value !== null ? [{ value: field.value, source: field.source }] : []),
        ...(field.alternateValues ?? []),
      ]
    : [];

  function submitManual() {
    const trimmed = manualValue.trim();
    if (trimmed) onResolve(trimmed);
  }

  return (
    <div className="rounded-lg border border-[var(--color-warning-100)] bg-[var(--color-warning-100)]/30 px-4 py-4">
      <div className="flex items-start gap-2">
        {field.isConflicting ? (
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" />
        ) : (
          <CircleHelp size={16} className="mt-0.5 shrink-0 text-[var(--color-warning-600)]" />
        )}
        <p className="text-sm font-medium text-[var(--color-ink-800)]">
          {field.isConflicting
            ? `We found multiple possible ${label} values.`
            : `We couldn't determine the ${label.toLowerCase()} from the uploaded documents.`}
        </p>
      </div>

      {candidates.length > 0 && (
        <div className="mt-3 space-y-2">
          {candidates.map((opt, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-ink-900)]">{opt.value}</p>
                {opt.source && <p className="text-xs text-[var(--color-ink-500)]">{opt.source.documentName}</p>}
              </div>
              <button
                onClick={() => onResolve(opt.value as string)}
                className="shrink-0 cursor-pointer rounded-md bg-[var(--color-brand-800)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-brand-700)]"
              >
                Use this value
              </button>
            </div>
          ))}
        </div>
      )}

      {!manualOpen ? (
        <button
          onClick={() => setManualOpen(true)}
          className="mt-3 text-xs font-medium text-[var(--color-brand-700)] underline decoration-dotted underline-offset-2 cursor-pointer"
        >
          {inputKind === 'state' ? 'Select state manually' : 'Enter manually'}
        </button>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          {inputKind === 'state' ? (
            <select
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              className="flex-1 rounded-md border border-[var(--color-brand-500)] px-2.5 py-2 text-sm outline-none"
            >
              <option value="">Select state…</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitManual()}
              placeholder={`Enter ${label.toLowerCase()}`}
              className="flex-1 rounded-md border border-[var(--color-brand-500)] px-2.5 py-2 text-sm outline-none"
            />
          )}
          <button
            onClick={submitManual}
            disabled={!manualValue.trim()}
            className="shrink-0 cursor-pointer rounded-md bg-[var(--color-brand-800)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--color-brand-700)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Confirms (or asks for) the two fields an account can't exist without — reuses the same
 * FieldValue/FieldSource provenance and "pick a sourced candidate or enter manually" interaction
 * as the Risk Profile conflict resolver, just presented as a focused pre-creation step rather than
 * a dense table row.
 */
export function IdentityResolutionStep({
  namedInsured,
  domicileState,
  onResolveNamedInsured,
  onResolveState,
}: {
  namedInsured: FieldValue<string>;
  domicileState: FieldValue<string>;
  onResolveNamedInsured: (value: string) => void;
  onResolveState: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <IdentityField label="Named Insured" field={namedInsured} inputKind="text" onResolve={onResolveNamedInsured} />
      <IdentityField label="Domicile State" field={domicileState} inputKind="state" onResolve={onResolveState} />
    </div>
  );
}
