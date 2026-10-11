/** "Sep 22, 3:14 PM" — for dated notes. */
export function formatTimestampShort(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${date}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
