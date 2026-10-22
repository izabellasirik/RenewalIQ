import { describe, expect, it } from 'vitest';
import { accountsEmptyState } from '../accountsEmptyState';

// Archive showed "Archived (15)" but an empty list with no way out: a search typed on the active list kept
// filtering the archive with its box hidden. Now an archive hidden by search/filters says so and offers Clear.
describe('Accounts empty state: empty vs. hidden by search or filters', () => {
  it('15 archived, all hidden by a search: says so and offers Clear', () => {
    expect(accountsEmptyState({ showArchived: true, inView: 15, searching: true, filtersActive: false })).toEqual({ title: 'No archived accounts match — 15 hidden by your search or filters', hiddenByFilters: true });
  });
  it('15 archived, hidden by a remembered filter: same', () => {
    expect(accountsEmptyState({ showArchived: true, inView: 15, searching: false, filtersActive: true }).hiddenByFilters).toBe(true);
  });
  it('a really empty archive is just empty', () => {
    expect(accountsEmptyState({ showArchived: true, inView: 0, searching: true, filtersActive: true })).toEqual({ title: 'No archived accounts', hiddenByFilters: false });
  });
  it('the active list behaves the same way', () => {
    expect(accountsEmptyState({ showArchived: false, inView: 3, searching: true, filtersActive: false }).hiddenByFilters).toBe(true);
  });
});
