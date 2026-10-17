import { useEffect, useState } from 'react';
import { parseStateList, parseStateName } from '../../utils/usStates';

/**
 * The text a state-list box shows. What the broker typed is kept as-is while it still means the
 * same states (so "N", "NJ, " and "New Jer…" can be typed); it's only replaced when the list was
 * changed from outside — Clear, or removing a state chip.
 */
export function stateListText(typed: string, states: string[]): string {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);
  return same(parseStateList(typed), states) ? typed : states.join(', ');
}

/** Entries that aren't a state (shown so nothing is silently ignored). A last, still-being-typed entry is left alone. */
export function unrecognizedStates(typed: string): string[] {
  const tokens = typed.split(/,|\band\b/i).map((t) => t.trim());
  return tokens.slice(0, -1).filter((t) => t && !parseStateName(t));
}

export function StateListInput({ value, onChange, className, placeholder }: { value: string[]; onChange: (states: string[]) => void; className?: string; placeholder?: string }) {
  const [text, setText] = useState(value.join(', '));
  // Follow changes made elsewhere (Clear filters, chip removed) without fighting the broker's typing.
  useEffect(() => setText((t) => stateListText(t, value)), [value]);
  const bad = unrecognizedStates(text);
  return (
    <>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseStateList(e.target.value));
        }}
        onBlur={() => setText(value.join(', '))}
        placeholder={placeholder}
        className={className}
        aria-label="Operating states"
      />
      {bad.length > 0 && <p className="mt-1 text-xs text-[var(--color-danger-600)]">Not a state: {bad.join(', ')}</p>}
    </>
  );
}
