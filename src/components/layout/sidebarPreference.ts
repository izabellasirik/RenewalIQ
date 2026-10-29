/** Whether the desktop sidebar is collapsed to its icon rail — remembered in this browser. Storage can be unavailable (private windows, blocked site data), so every read and write is guarded. */
const KEY = 'renewaliq:sidebar-collapsed';

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    // Not remembered this time; the sidebar still works.
  }
}
