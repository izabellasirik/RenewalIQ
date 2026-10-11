import { useMemo, useState } from 'react';
import { Ban, CalendarClock, ChevronDown, ChevronRight, ClipboardList, FilePlus2, Mail, PackageCheck, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import type { MissingItem } from '../../types';
import { Badge, Button, Card, CardBody, Modal, OverflowMenu, type BadgeTone, type OverflowMenuItem } from '../ui';
import { useAccountsStore } from '../../state/useAccountsStore';
import { useAccountWorkflow } from '../../hooks/useAccountWorkflow';
import { formatShortDate, todayKey } from '../../services/workflow/dates';
import { REQUIREMENT_STATE_LABELS, STATE_GROUP, followUpSummary, outdatedFor, requirementRows, type RequirementGroup, type RequirementRow, type RequirementState } from '../../services/workflow/missingDocuments';
import { RequestItemsDialog } from './RequestItemsDialog';
import { ReceiveItemDialog } from './ReceiveItemDialog';
import { AddMissingDocumentsDialog } from './AddMissingDocumentsDialog';
import { DocumentPreviewLink } from './DocumentPreviewLink';
import { DateInput } from './DateInput';
import { inputClass, labelClass, smallInputClass } from './formStyles';

const STATE_TONE: Record<RequirementState, BadgeTone> = {
  not_requested: 'danger',
  prepared: 'neutral',
  sent: 'warning',
  sent_unconfirmed: 'warning',
  pending_review: 'info',
  needs_verification: 'info',
  expired: 'danger',
  received: 'success',
  not_applicable: 'neutral',
  waived: 'neutral',
};

const GROUPS: { key: RequirementGroup; title: string; collapsed?: boolean }[] = [
  { key: 'missing', title: 'Missing' },
  { key: 'review', title: 'Needs your review' },
  { key: 'expired', title: 'Expired or outdated' },
  { key: 'received', title: 'Received', collapsed: true },
  { key: 'not_needed', title: 'Not applicable / waived', collapsed: true },
];

/**
 * Workspace → Overview: what this account still needs from the client, in one place — what's
 * missing (and whether it was asked for, and of whom), what came back and needs checking, what's
 * expired, what's in. Only explicit requirements count; nothing is assumed to be required.
 */
export function MissingDocumentsPanel({ accountId, onOpenChecklist }: { accountId: string; onOpenChecklist: () => void }) {
  const { profile, items, quotes, documentRequests, documents, account } = useAccountWorkflow(accountId);
  const markClientRequestSent = useAccountsStore((s) => s.markClientRequestSent);
  const verifyItem = useAccountsStore((s) => s.verifyItem);
  const setItemStatus = useAccountsStore((s) => s.setItemStatus);
  const [requestIds, setRequestIds] = useState<string[] | null>(null);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ item: MissingItem; mode: 'not_applicable' | 'expiry' } | null>(null);
  const [open, setOpen] = useState<Partial<Record<RequirementGroup, boolean>>>({});
  const [error, setError] = useState<string | null>(null);

  const today = todayKey();
  const rows = useMemo(() => requirementRows({ items, requests: documentRequests, drivers: profile?.drivers, quotes }, today), [items, documentRequests, profile?.drivers, quotes, today]);
  const outdated = useMemo(() => outdatedFor(profile, account?.lossRuns ?? [], today), [profile, account?.lossRuns, today]);
  const followUps = useMemo(() => followUpSummary(items, documentRequests), [items, documentRequests]);
  const byGroup = (g: RequirementGroup) => rows.filter((r) => STATE_GROUP[r.state] === g);
  const unrequested = rows.filter((r) => r.state === 'not_requested').map((r) => r.item.id);
  const counts = { missing: byGroup('missing').length, review: byGroup('review').length, expired: byGroup('expired').length + outdated.length, received: byGroup('received').length };

  function rowActions(r: RequirementRow) {
    const id = r.item.id;
    switch (r.state) {
      case 'not_requested':
        return (
          <Button size="sm" variant="secondary" icon={<Mail size={13} />} onClick={() => setRequestIds([id])}>
            Request
          </Button>
        );
      case 'prepared':
        return (
          <Button size="sm" icon={<Send size={13} />} onClick={() => r.requestId && void markClientRequestSent(r.requestId).then((res) => !res.ok && setError(res.message ?? 'Could not record it.'))}>
            Mark as sent
          </Button>
        );
      case 'sent':
      case 'sent_unconfirmed':
        return (
          <Button size="sm" variant="secondary" icon={<PackageCheck size={13} />} onClick={() => setReceiveId(id)}>
            Received
          </Button>
        );
      case 'pending_review':
        return (
          <Button size="sm" variant="secondary" onClick={onOpenChecklist}>
            Review upload
          </Button>
        );
      case 'needs_verification':
        return (
          <Button size="sm" icon={<ShieldCheck size={13} />} onClick={() => verifyItem(accountId, id)}>
            Verify
          </Button>
        );
      case 'expired':
        return (
          <Button
            size="sm"
            variant="secondary"
            icon={<Mail size={13} />}
            onClick={() => {
              setItemStatus(accountId, id, 'missing');
              setRequestIds([id]);
            }}
          >
            Request new copy
          </Button>
        );
      default:
        return null;
    }
  }

  function menu(r: RequirementRow): OverflowMenuItem[] {
    const id = r.item.id;
    const out: OverflowMenuItem[] = [];
    if (STATE_GROUP[r.state] === 'missing') out.push({ key: 'received', label: 'Mark received', icon: <PackageCheck size={14} />, onSelect: () => setReceiveId(id) });
    if (r.state !== 'not_applicable') out.push({ key: 'na', label: 'Not applicable…', icon: <Ban size={14} />, onSelect: () => setEditing({ item: r.item, mode: 'not_applicable' }) });
    out.push({ key: 'expiry', label: r.item.expiresOn ? 'Change expiry date…' : 'Set expiry date…', icon: <CalendarClock size={14} />, onSelect: () => setEditing({ item: r.item, mode: 'expiry' }) });
    if (r.state === 'not_applicable' || r.state === 'waived' || r.state === 'received' || r.state === 'needs_verification')
      out.push({ key: 'back', label: 'Move back to missing', icon: <RotateCcw size={14} />, onSelect: () => setItemStatus(accountId, id, 'missing') });
    return out;
  }

  function meta(r: RequirementRow): string {
    const parts: string[] = [];
    if (r.askedOn && (r.state === 'sent' || r.state === 'sent_unconfirmed' || r.state === 'pending_review')) parts.push(`Asked ${r.askedOf ? `${r.askedOf} ` : ''}${formatShortDate(r.askedOn)}`);
    else if (r.state === 'prepared' && r.askedOf) parts.push(`For ${r.askedOf}`);
    if (r.state === 'not_requested') parts.push('From: the client');
    if (r.neededBy.length) parts.push(`Needed by ${r.neededBy.join(', ')}`);
    if (r.expiresOn) parts.push(`${r.expiresOn < today ? 'Expired' : 'Expires'} ${formatShortDate(r.expiresOn)}`);
    if (r.state === 'not_applicable' && r.item.waiveReason) parts.push(r.item.waiveReason);
    if (r.state === 'needs_verification') parts.push('Matched automatically — check it before relying on it');
    return parts.join(' · ');
  }

  return (
    <Card data-testid="missing-documents">
      <CardBody className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-900)]">
              <ClipboardList size={16} className="text-[var(--color-ink-500)]" />
              Missing documents
            </h3>
            {rows.length > 0 || outdated.length > 0 ? (
              <p className="mt-0.5 text-xs text-[var(--color-ink-500)]" data-testid="missing-documents-summary">
                {counts.missing} missing · {counts.review} to review · {counts.expired} expired · {counts.received} received
                {' · '}
                {followUps.lastFollowUp ? `Last asked ${formatShortDate(followUps.lastFollowUp)}` : 'Not asked yet'}
                {followUps.nextFollowUp ? (
                  followUps.nextFollowUp < today ? (
                    <span className="font-medium text-[var(--color-danger-600)]"> · Follow-up overdue since {formatShortDate(followUps.nextFollowUp)}</span>
                  ) : (
                    ` · Next follow-up ${formatShortDate(followUps.nextFollowUp)}`
                  )
                ) : (
                  ''
                )}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-[var(--color-ink-500)]">No documents listed for this account yet. Add the ones you need — nothing is assumed to be required.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unrequested.length > 0 && (
              <Button size="sm" icon={<Mail size={14} />} onClick={() => setRequestIds(unrequested)}>
                Request missing documents{unrequested.length > 1 ? ` (${unrequested.length})` : ''}
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<FilePlus2 size={14} />} onClick={() => setAdding(true)}>
              Add documents
            </Button>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-[var(--color-danger-600)]">{error}</p>}

        <div className="mt-3 flex flex-col gap-3">
          {GROUPS.map((g) => {
            const list = byGroup(g.key);
            const extra = g.key === 'expired' ? outdated : [];
            if (list.length === 0 && extra.length === 0) return null;
            const collapsed = g.collapsed && !open[g.key];
            return (
              <section key={g.key} data-testid={`missing-group-${g.key}`}>
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-500)]"
                  onClick={() => g.collapsed && setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                >
                  {g.collapsed && (collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />)}
                  {g.title} ({list.length + extra.length})
                </button>
                {!collapsed && (
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {list.map((r) => {
                      const doc = r.item.documentId ? documents.find((d) => d.id === r.item.documentId) : undefined;
                      return (
                        <li key={r.item.id} className="flex flex-col gap-2 rounded-lg border border-[var(--color-ink-100)] px-3 py-2 sm:flex-row sm:items-center" data-testid="missing-row" data-state={r.state}>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-ink-900)]">
                              {r.item.label}
                              <Badge tone={STATE_TONE[r.state]} className="px-2 py-0.5 text-[11px]">
                                {REQUIREMENT_STATE_LABELS[r.state]}
                              </Badge>
                            </p>
                            {meta(r) && <p className="text-xs text-[var(--color-ink-500)]">{meta(r)}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {doc && <DocumentPreviewLink doc={doc} />}
                            {rowActions(r)}
                            <OverflowMenu items={menu(r)} />
                          </div>
                        </li>
                      );
                    })}
                    {extra.map((o) => (
                      <li key={`${o.kind}:${o.sourceId}`} className="flex flex-col gap-1 rounded-lg border border-[var(--color-ink-100)] px-3 py-2" data-testid="outdated-report">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-ink-900)]">
                          {o.kind === 'mvr' ? `MVR — ${o.subject}` : `Loss run — ${o.subject}`}
                          <Badge tone="danger" className="px-2 py-0.5 text-[11px]">
                            Outdated
                          </Badge>
                        </p>
                        <p className="text-xs text-[var(--color-ink-500)]">
                          Dated {formatShortDate(o.age.reportDate)} — {o.age.ageDays} days old (must be within {o.age.maxAgeDays} days)
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </CardBody>

      <RequestItemsDialog accountId={accountId} itemIds={requestIds ?? []} open={!!requestIds} onClose={() => setRequestIds(null)} />
      <ReceiveItemDialog accountId={accountId} itemId={receiveId} open={!!receiveId} onClose={() => setReceiveId(null)} />
      <AddMissingDocumentsDialog accountId={accountId} open={adding} onClose={() => setAdding(false)} />
      {editing && <EditRequirementDialog accountId={accountId} item={editing.item} mode={editing.mode} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function EditRequirementDialog({ accountId, item, mode, onClose }: { accountId: string; item: MissingItem; mode: 'not_applicable' | 'expiry'; onClose: () => void }) {
  const markItemNotApplicable = useAccountsStore((s) => s.markItemNotApplicable);
  const setItemExpiry = useAccountsStore((s) => s.setItemExpiry);
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState(item.expiresOn ?? '');
  const notApplicable = mode === 'not_applicable';
  return (
    <Modal
      open
      onClose={onClose}
      title={notApplicable ? `Not applicable: ${item.label}` : `Expiry date: ${item.label}`}
      subtitle={notApplicable ? 'Say why, for the record — it’s kept in the account’s activity.' : 'When this document stops being valid. Expired documents are flagged.'}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {!notApplicable && item.expiresOn && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setItemExpiry(accountId, item.id, undefined);
                onClose();
              }}
            >
              Clear date
            </Button>
          )}
          <Button
            size="sm"
            disabled={notApplicable ? !reason.trim() : !expires}
            onClick={() => {
              if (notApplicable) markItemNotApplicable(accountId, item.id, reason);
              else setItemExpiry(accountId, item.id, expires);
              onClose();
            }}
          >
            {notApplicable ? 'Mark not applicable' : 'Save'}
          </Button>
        </div>
      }
    >
      {notApplicable ? (
        <div>
          <label className={labelClass} htmlFor="na-reason">
            Reason
          </label>
          <input id="na-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No CDL drivers on this account" autoFocus />
        </div>
      ) : (
        <div>
          <label className={labelClass}>Expires on</label>
          <DateInput value={expires} onCommit={(v) => setExpires(v ?? '')} className={smallInputClass} aria-label="Expires on" />
        </div>
      )}
    </Modal>
  );
}
