import { ArrowRight, ExternalLink, Mail, Phone, UserRound } from 'lucide-react';
import type { AccessStatus, CarrierRule, MarketAccess } from '../../types';
import { ACCESS_ROUTE_LABELS, ACCESS_STATUS_HELP, ACCESS_STATUS_LABELS, COVERAGE_LABELS, RULE_ANSWER_LABELS, RULE_STRENGTH_LABELS } from '../../types';
import { Badge, type BadgeTone } from '../ui/Badge';
import { describePredicate, isVerified } from '../../services/appetite/carrierRules';
import { formatDate } from '../../utils/dates';

/** Carrier 101 pieces shared by Market Finder and the Market Access Directory. */

const STATUS_TONE: Record<AccessStatus, BadgeTone> = { ready: 'success', partial: 'warning', not_ready: 'danger', inactive: 'neutral' };

export function AccessStatusBadge({ status }: { status: AccessStatus | null }) {
  if (!status) return <Badge tone="neutral">Access not on file</Badge>;
  return (
    <Badge tone={STATUS_TONE[status]} title={ACCESS_STATUS_HELP[status]} data-testid="access-status" data-status={status}>
      Access: {ACCESS_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Agency → wholesaler → MGA → carrier paper, leaving out the links that aren't on file. */
export function RelationshipChain({ access, marketName, agencyName }: { access: MarketAccess; marketName: string; agencyName?: string | null }) {
  const steps = [
    { role: 'Agency', name: agencyName || 'Your agency' },
    ...(access.wholesaler ? [{ role: 'Wholesaler', name: access.wholesaler }] : []),
    ...(access.mga ? [{ role: 'MGA', name: access.mga }] : []),
    { role: access.mga || access.wholesaler ? 'Market' : 'Market (direct)', name: marketName },
    ...(access.paper && access.paper.toLowerCase() !== marketName.toLowerCase() ? [{ role: 'Carrier paper', name: access.paper }] : []),
  ];
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="relationship-chain">
      {steps.map((s, i) => (
        <li key={`${s.role}-${i}`} className="flex items-center gap-1.5">
          {i > 0 && <ArrowRight size={12} className="text-[var(--color-ink-300)]" aria-hidden />}
          <span className="rounded-md border border-[var(--color-ink-100)] bg-white px-2 py-1">
            <span className="block text-[10px] uppercase tracking-wide text-[var(--color-ink-400)]">{s.role}</span>
            <span className="font-medium text-[var(--color-ink-800)]">{s.name}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const safeUrl = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

/** Carrier 101: how to submit to this market. */
export function HowToSubmit({ access, marketName, agencyName }: { access: MarketAccess; marketName: string; agencyName?: string | null }) {
  const url = safeUrl(access.portalUrl);
  return (
    <div className="flex flex-col gap-3" data-testid="how-to-submit">
      <div className="flex flex-wrap items-center gap-1.5">
        <AccessStatusBadge status={access.status} />
        {access.route && <Badge tone="neutral">{ACCESS_ROUTE_LABELS[access.route]}</Badge>}
      </div>
      {access.status && <p className="text-xs text-[var(--color-ink-500)]">{ACCESS_STATUS_HELP[access.status]}</p>}
      {access.documentedStatus && (
        <p className="text-xs text-[var(--color-ink-600)]" data-testid="documented-access-status">
          Documented status: <span className="font-medium">{access.documentedStatus}</span>
        </p>
      )}
      <RelationshipChain access={access} marketName={marketName} agencyName={agencyName} />
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {(access.portalName || url) && (
          <div>
            <dt className="text-xs text-[var(--color-ink-400)]">Submission portal</dt>
            <dd>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline">
                  {access.portalName || new URL(url).hostname} <ExternalLink size={12} />
                </a>
              ) : (
                <span className="text-[var(--color-ink-800)]">{access.portalName}</span>
              )}
            </dd>
          </div>
        )}
        {access.submissionEmail && (
          <div>
            <dt className="text-xs text-[var(--color-ink-400)]">Submission email</dt>
            <dd>
              <a href={`mailto:${access.submissionEmail}`} className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-700)] hover:underline">
                <Mail size={12} /> {access.submissionEmail}
              </a>
            </dd>
          </div>
        )}
        {(access.appointment || access.producerCode) && (
          <div>
            <dt className="text-xs text-[var(--color-ink-400)]">Appointment</dt>
            <dd className="text-[var(--color-ink-800)]">
              {access.appointment}
              {access.producerCode && <span className="block text-xs text-[var(--color-ink-500)]">Producer code: {access.producerCode}</span>}
            </dd>
          </div>
        )}
        {access.appointmentNotes && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-[var(--color-ink-400)]">Appointment notes</dt>
            <dd className="whitespace-pre-line text-[var(--color-ink-700)]">{access.appointmentNotes}</dd>
          </div>
        )}
      </dl>
      {access.contacts.length > 0 && (
        <div>
          <p className="text-xs text-[var(--color-ink-400)]">Contacts</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {access.contacts.map((c, i) => (
              <li key={i} className="rounded-md border border-[var(--color-ink-100)] px-2.5 py-1.5 text-sm">
                <span className="flex flex-wrap items-center gap-x-2 font-medium text-[var(--color-ink-800)]">
                  <UserRound size={13} className="text-[var(--color-ink-400)]" /> {c.name || 'Contact'}
                  {c.role && <span className="text-xs font-normal text-[var(--color-ink-500)]">{c.role}</span>}
                  {c.coverage && <span className="text-xs font-normal text-[var(--color-ink-500)]">· {c.coverage}</span>}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                  {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-[var(--color-brand-700)] hover:underline"><Mail size={11} /> {c.email}</a>}
                  {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-[var(--color-brand-700)] hover:underline"><Phone size={11} /> {c.phone}</a>}
                </span>
                {c.notes && <span className="mt-0.5 block text-xs text-[var(--color-ink-500)]">{c.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {access.notes && <p className="whitespace-pre-line rounded-md bg-[var(--color-ink-50)] px-2.5 py-2 text-xs text-[var(--color-ink-600)]">{access.notes}</p>}
      <p className="text-[11px] text-[var(--color-ink-400)]">
        {access.source ? `Source: ${access.source}` : 'Source not recorded'}
        {access.sourceDate ? ` (${formatDate(access.sourceDate)})` : ''}
        {' · '}
        {access.verifiedAt ? `Verified ${formatDate(access.verifiedAt)}` : 'Not independently verified yet'}
      </p>
    </div>
  );
}

const ANSWER_TONE: Record<CarrierRule['answer'], BadgeTone> = { yes: 'success', no: 'danger', referral: 'warning', unknown: 'neutral' };

/** One underwriting rule in plain words, with its provenance. */
export function RuleSummary({ rule }: { rule: CarrierRule }) {
  return (
    <div className="flex flex-col gap-1" data-testid="carrier-rule">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <Badge tone={ANSWER_TONE[rule.answer]}>{RULE_ANSWER_LABELS[rule.answer]}</Badge>
        <span className="font-medium text-[var(--color-ink-800)]">{describePredicate(rule)}</span>
        <Badge tone="neutral">{RULE_STRENGTH_LABELS[rule.strength]}</Badge>
        {rule.coverage && <Badge tone="info">{COVERAGE_LABELS[rule.coverage]}</Badge>}
        {rule.documentedStatus && <Badge tone="neutral" data-testid="documented-rule-status">Documented: {rule.documentedStatus}</Badge>}
        {isVerified(rule) ? <Badge tone="success">Verified {formatDate(rule.lastVerifiedAt!)}</Badge> : <Badge tone="warning">Not verified in RenewalIQ</Badge>}
      </div>
      {(rule.conditions.length > 0 || rule.conditionsText) && (
        <p className="text-xs text-[var(--color-ink-500)]">
          Applies when: {[...rule.conditions.map(describePredicate), ...(rule.conditionsText ? [rule.conditionsText] : [])].join('; ')}
        </p>
      )}
      {rule.notes && <p className="text-xs text-[var(--color-ink-500)]">{rule.notes}</p>}
      <p className="text-[11px] text-[var(--color-ink-400)]">
        {rule.source ? `Source: ${rule.source}` : 'Source not recorded'}
        {rule.sourceDate ? ` (${formatDate(rule.sourceDate)})` : ''}
        {rule.verifiedBy ? ` · verified by ${rule.verifiedBy}` : ''}
      </p>
    </div>
  );
}
