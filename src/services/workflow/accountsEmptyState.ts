/**
 * What the Accounts list says when it shows nothing: an archive (or list) that is really empty, or one
 * whose accounts are all hidden by the search or the filters — then it offers to clear them.
 */
export function accountsEmptyState(opts: { showArchived: boolean; inView: number; searching: boolean; filtersActive: boolean }): {
  title: string;
  hiddenByFilters: boolean;
} {
  const hiddenByFilters = opts.inView > 0 && (opts.searching || opts.filtersActive);
  if (opts.showArchived) return { title: hiddenByFilters ? `No archived accounts match — ${opts.inView} hidden by your search or filters` : 'No archived accounts', hiddenByFilters };
  return { title: hiddenByFilters ? 'No matching accounts' : 'No accounts yet', hiddenByFilters };
}
