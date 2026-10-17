import { describe, expect, it } from 'vitest';
import { stateListText, unrecognizedStates } from '../StateListInput';
import { parseStateList } from '../../../utils/usStates';

// Regression: Market Finder's Operating States box showed the parsed state list instead of what was
// typed, so every keystroke that wasn't yet a whole state ("N", "NJ,", "New Jer") was wiped out.
describe('typing a state list', () => {
  it('keeps partial input while typing', () => {
    let states: string[] = [];
    let text = '';
    for (const ch of 'NJ, New York') {
      text = stateListText(text + ch, (states = parseStateList(text + ch)));
    }
    expect(text).toBe('NJ, New York');
    expect(states).toEqual(['NJ', 'NY']);
  });

  it('follows changes made elsewhere (Clear, a chip removed)', () => {
    expect(stateListText('NJ, NY', [])).toBe('');
    expect(stateListText('NJ, NY', ['NY'])).toBe('NY');
  });

  it('points out entries that are not states, but not the one still being typed', () => {
    expect(unrecognizedStates('NJ, Jersy, N')).toEqual(['Jersy']);
  });
});
