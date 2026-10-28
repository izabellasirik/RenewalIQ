import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNDO_SECONDS, commitAllRemovals, removalKey, scheduleRemoval, undoRemoval } from '../pendingRemovals';

describe('deleting with a 15-second Undo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves the deletion only when the Undo window ends', () => {
    const commit = vi.fn();
    scheduleRemoval(removalKey('acct_1', 'p1'), 'Policy PN-1 deleted', commit);
    vi.advanceTimersByTime((UNDO_SECONDS - 1) * 1000);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('Undo: the deletion never happens', () => {
    const commit = vi.fn();
    scheduleRemoval(removalKey('acct_1', 'p2'), 'Policy PN-2 deleted', commit);
    undoRemoval(removalKey('acct_1', 'p2'));
    vi.advanceTimersByTime(UNDO_SECONDS * 2000);
    expect(commit).not.toHaveBeenCalled();
  });
  it('leaving the page saves what is still waiting, once', () => {
    const commit = vi.fn();
    scheduleRemoval(removalKey('acct_1', 'p3'), 'Endorsement deleted', commit);
    commitAllRemovals();
    vi.advanceTimersByTime(UNDO_SECONDS * 1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
