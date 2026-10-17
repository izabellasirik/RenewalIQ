import type { DocumentRequest, DriverEntry, LossRun, MarketQuote, MissingItem, RiskProfile, VehicleEntry } from '../../types';
import { isOpenRequest } from '../../types';
import { normalizeDateKey, todayKey } from './dates';
import { outdatedReports, type OutdatedReport } from './freshness';
import { carriersFor } from './requirementKey';

/**
 * The account's missing-documents picture, computed from what is explicitly on the checklist and
 * the client requests — never assumed. One state per requirement:
 *
 *   not_requested       on the list, nobody asked the client yet
 *   prepared            in a request whose email was prepared but never marked sent
 *   sent                asked (request marked sent, or marked requested by hand)
 *   sent_unconfirmed    in a request from before sending was tracked
 *   pending_review      the client uploaded something for it; the broker hasn't accepted it
 *   needs_verification  received, matched automatically — the broker hasn't checked it
 *   expired             received, but past its expiry date
 *   received            received and checked
 *   not_applicable / waived
 */
export type RequirementState =
  | 'not_requested'
  | 'prepared'
  | 'sent'
  | 'sent_unconfirmed'
  | 'pending_review'
  | 'needs_verification'
  | 'expired'
  | 'received'
  | 'not_applicable'
  | 'waived';

export const REQUIREMENT_STATE_LABELS: Record<RequirementState, string> = {
  not_requested: 'Not requested',
  prepared: 'Request prepared — not sent',
  sent: 'Requested',
  sent_unconfirmed: 'Requested (sending unconfirmed)',
  pending_review: 'Uploaded — needs your review',
  needs_verification: 'Received — needs verification',
  expired: 'Expired',
  received: 'Received',
  not_applicable: 'Not applicable',
  waived: 'Waived',
};

export type RequirementGroup = 'missing' | 'review' | 'expired' | 'received' | 'not_needed';

export const STATE_GROUP: Record<RequirementState, RequirementGroup> = {
  not_requested: 'missing',
  prepared: 'missing',
  sent: 'missing',
  sent_unconfirmed: 'missing',
  pending_review: 'review',
  needs_verification: 'review',
  expired: 'expired',
  received: 'received',
  not_applicable: 'not_needed',
  waived: 'not_needed',
};

export interface RequirementRow {
  item: MissingItem;
  state: RequirementState;
  /** Who it was asked of (request contact), when asked. */
  askedOf?: string;
  /** When it was asked (request sent / item requested), YYYY-MM-DD. */
  askedOn?: string;
  /** The open request chasing it, if any. */
  requestId?: string;
  /** Expiry date in force (the broker's, or the license's own), YYYY-MM-DD. */
  expiresOn?: string;
  /** Carriers/markets waiting on it. */
  neededBy: string[];
}

/** A driver's license item carries the driver's id in its templateKey (driver_license:<id>). */
function licenseExpiry(item: MissingItem, drivers: DriverEntry[]): string | undefined {
  const [kind, id] = (item.templateKey ?? '').split(':');
  if (kind !== 'driver_license' || !id) return undefined;
  return normalizeDateKey(drivers.find((d) => d.id === id)?.expirationDate) ?? undefined;
}

export function requirementRows(input: { items: MissingItem[]; requests: DocumentRequest[]; drivers?: DriverEntry[]; quotes?: MarketQuote[] }, today = todayKey()): RequirementRow[] {
  const { items, requests, drivers = [], quotes = [] } = input;
  const open = requests.filter(isOpenRequest).sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : -1));
  const quoteName = (id: string) => quotes.find((q) => q.id === id)?.marketName;
  return items.map((item) => {
    const neededBy = carriersFor(item).map(quoteName).filter((n): n is string => !!n);
    const expiresOn = normalizeDateKey(item.expiresOn) ?? licenseExpiry(item, drivers);
    const base = { item, neededBy, ...(expiresOn ? { expiresOn } : {}) };
    if (item.status === 'waived') return { ...base, state: item.waiveKind === 'not_applicable' ? 'not_applicable' : 'waived' };
    if (item.status === 'received') {
      if (expiresOn && expiresOn < today) return { ...base, state: 'expired' };
      return { ...base, state: item.verification === 'pending' ? 'needs_verification' : 'received' };
    }
    const request = open.find((r) => r.items.some((i) => i.missingItemId === item.id && i.status !== 'waived'));
    const reqItem = request?.items.find((i) => i.missingItemId === item.id);
    if (request && reqItem) {
      const asked = { askedOf: request.contactName, askedOn: (request.sentAt ?? request.requestedAt).slice(0, 10), requestId: request.id };
      if (reqItem.status === 'uploaded' || reqItem.status === 'needs_review') return { ...base, ...asked, state: 'pending_review' };
      if (request.deliveryStatus === 'prepared') return { ...base, requestId: request.id, askedOf: request.contactName, state: 'prepared' };
      return { ...base, ...asked, state: request.deliveryStatus === 'sent' ? 'sent' : 'sent_unconfirmed' };
    }
    if (item.status === 'requested') return { ...base, askedOn: item.requestedAt?.slice(0, 10), state: 'sent' };
    return { ...base, state: 'not_requested' };
  });
}

export interface FollowUpSummary {
  /** Most recent time a request went out or was followed up, YYYY-MM-DD. */
  lastFollowUp?: string;
  /** The next scheduled follow-up on an open, sent request or a requested item. */
  nextFollowUp?: string;
}

export function followUpSummary(items: MissingItem[], requests: DocumentRequest[]): FollowUpSummary {
  const sent = requests.filter((r) => r.deliveryStatus !== 'prepared');
  const last = sent
    .map((r) => r.lastFollowUpAt ?? r.sentAt ?? r.requestedAt)
    .concat(items.filter((i) => i.status === 'requested' && i.requestedAt).map((i) => i.requestedAt!))
    .map((d) => d.slice(0, 10))
    .sort();
  const next = sent
    .filter((r) => isOpenRequest(r) && r.items.some((i) => i.status === 'requested'))
    .map((r) => r.nextFollowUp)
    .concat(items.filter((i) => i.status === 'requested').map((i) => i.followUpDate))
    .filter((d): d is string => !!d)
    .sort();
  return { ...(last.length ? { lastFollowUp: last[last.length - 1] } : {}), ...(next.length ? { nextFollowUp: next[0] } : {}) };
}

/** MVRs and loss runs on the Risk Profile that are older than the freshness policy allows. */
export function outdatedFor(profile: RiskProfile | undefined, lossRuns: LossRun[], today = todayKey()): OutdatedReport[] {
  return outdatedReports(lossRuns, profile?.drivers ?? [], today);
}

/**
 * Documents worth asking for, from what the Risk Profile actually shows — offered, never added on
 * their own: a license per named driver, a medical certificate per CDL driver, a registration per
 * vehicle, the current policy's declarations page.
 */
export function suggestedRequirements(profile: RiskProfile | undefined): { label: string; templateKey: string }[] {
  const out: { label: string; templateKey: string }[] = [];
  const drivers = (profile?.drivers ?? []).filter((d) => d.name?.trim());
  for (const d of drivers) out.push({ label: `Driver’s license — ${d.name!.trim()}`, templateKey: `driver_license:${d.id}` });
  for (const d of drivers.filter(isCdlDriver)) out.push({ label: `Medical certificate — ${d.name!.trim()}`, templateKey: `medical_certificate:${d.id}` });
  for (const v of profile?.vehicles ?? []) {
    const name = vehicleName(v);
    if (name) out.push({ label: `Vehicle registration — ${name}`, templateKey: `vehicle_registration:${v.id}` });
  }
  out.push({ label: 'Prior insurance — current declarations page', templateKey: 'prior_insurance' });
  return out;
}

function isCdlDriver(d: DriverEntry): boolean {
  return d.isCDL === true || /^(?:cdl[-\s]?)?[ab]$/i.test((d.licenseClass ?? '').trim());
}

function vehicleName(v: VehicleEntry): string | null {
  const desc = [v.year, v.make, v.model].filter(Boolean).join(' ');
  const vin = v.vin ? `VIN …${v.vin.slice(-6)}` : '';
  return [desc, vin && (desc ? `(${vin})` : vin)].filter(Boolean).join(' ') || null;
}
