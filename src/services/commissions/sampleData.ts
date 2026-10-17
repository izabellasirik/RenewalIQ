import type { CommissionAdjustment, CommissionTransaction, Producer, TransactionType } from './calc';

/**
 * FICTIONAL sample data for the Commissions preview. Every producer, account, policy number,
 * carrier and rate below is made up — none of it is any real agency's or customer's. The producer
 * splits are example rates only, not any agency's actual commission agreements.
 */
export const SAMPLE_PRODUCERS: Producer[] = [
  { id: 'p-alex', name: 'Alex Rivera', splitMilli: 40_000 },
  { id: 'p-jordan', name: 'Jordan Lee', splitMilli: 45_000 },
  { id: 'p-sam', name: 'Sam Patel', splitMilli: 55_000 },
  { id: 'p-casey', name: 'Casey Morgan', splitMilli: 60_000 },
  { id: 'p-riley', name: 'Riley Chen', splitMilli: 35_000 },
];

export const SAMPLE_CARRIERS = ['Prairie Mutual (sample)', 'Gulf Coast Specialty (sample)', 'Summit Casualty (sample)'];

type Row = [id: string, month: string, date: string, account: string, policy: string, carrier: number, type: TransactionType, premium: number, pct: number, producerId: string];
const ROWS: Row[] = [
  ['t01', '2026-09', '2026-09-03', 'Lone Pine Freight LLC', 'SMP-AL-24001', 0, 'new_business', 48000, 12.5, 'p-alex'],
  ['t02', '2026-09', '2026-09-08', 'Red Mesa Logistics', 'SMP-AL-24002', 1, 'renewal', 36500, 10, 'p-jordan'],
  ['t03', '2026-09', '2026-09-12', 'Bayou Cargo Co.', 'SMP-MTC-24003', 2, 'new_business', 22750, 15, 'p-sam'],
  ['t04', '2026-09', '2026-09-15', 'Copper Ridge Transport', 'SMP-AL-24004', 0, 'renewal', 61200, 12, 'p-casey'],
  ['t05', '2026-09', '2026-09-19', 'Trinity Flatbed Inc.', 'SMP-AL-24005', 1, 'new_business', 18400, 10, 'p-riley'],
  ['t06', '2026-09', '2026-09-24', 'Red Mesa Logistics', 'SMP-AL-24002', 1, 'endorsement_add', 4200, 10, 'p-jordan'],
  ['t07', '2026-10', '2026-10-02', 'Lone Pine Freight LLC', 'SMP-AL-24001', 0, 'endorsement_add', 6350, 12.5, 'p-alex'],
  ['t08', '2026-10', '2026-10-05', 'Prairie Wind Haulers', 'SMP-AL-24008', 0, 'new_business', 29900, 12.5, 'p-alex'],
  ['t09', '2026-10', '2026-10-07', 'Red Mesa Logistics', 'SMP-AL-24002', 1, 'cancellation', 27375, 10, 'p-jordan'],
  ['t10', '2026-10', '2026-10-09', 'Mesquite Line Carriers', 'SMP-AL-24010', 1, 'new_business', 5800, 10, 'p-jordan'],
  ['t11', '2026-10', '2026-10-12', 'Bayou Cargo Co.', 'SMP-MTC-24003', 2, 'endorsement_return', 1980, 15, 'p-sam'],
  ['t12', '2026-10', '2026-10-14', 'Pelican State Movers', 'SMP-MTC-24012', 2, 'renewal', 14600, 15, 'p-sam'],
  ['t13', '2026-10', '2026-10-15', 'Silver Creek Tankers', 'SMP-AL-24013', 2, 'new_business', 52000, 8, 'p-casey'],
  ['t14', '2026-10', '2026-10-16', 'Trinity Flatbed Inc.', 'SMP-AL-24005', 1, 'endorsement_add', 2300, 10, 'p-riley'],
];

const split = (id: string) => SAMPLE_PRODUCERS.find((p) => p.id === id)!.splitMilli;

export const SAMPLE_TRANSACTIONS: CommissionTransaction[] = ROWS.map(([id, month, date, account, policy, c, type, premium, pct, producerId]) => ({
  id,
  month,
  date,
  account,
  policy,
  carrier: SAMPLE_CARRIERS[c],
  type,
  premiumCents: Math.round(premium * 100),
  rateMilli: Math.round(pct * 1000),
  producerId,
  splitMilli: split(producerId),
}));

export const SAMPLE_ADJUSTMENTS: CommissionAdjustment[] = [
  { id: 'a01', month: '2026-09', producerId: 'p-casey', amountCents: -12_000, reason: 'Correction: carrier overstated the Copper Ridge renewal commission (sample).', at: '2026-10-01T15:10:00Z', by: 'Sample manager' },
  { id: 'a02', month: '2026-10', producerId: 'p-sam', amountCents: 7_500, reason: 'One-off referral bonus for the Pelican State Movers renewal (sample).', at: '2026-10-15T17:30:00Z', by: 'Sample manager' },
];

/** The month the preview opens on. */
export const SAMPLE_DEFAULT_MONTH = '2026-10';
