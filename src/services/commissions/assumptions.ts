/**
 * Commission rules the agency has NOT confirmed yet. The preview applies them so the figures can be
 * shown, but they are assumptions — never approved business logic. Each figure that depends on one
 * is marked with its id in the UI. The `ref` is the matching open question in CARRIER_103_PLAN (D1–D14).
 */
export type AssumptionId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10' | 'A11';

export interface Assumption {
  id: AssumptionId;
  ref: string;
  topic: string;
  question: string;
  current: string;
  why: string;
}

export const ASSUMPTIONS: Assumption[] = [
  { id: 'A1', ref: 'D2', topic: 'Rounding', question: 'How are commissions rounded?', current: 'Each line is rounded to the cent, half away from zero: first the gross commission, then the agent payout. Agency retained is the difference, so every line ties exactly.', why: 'Totals must match the agency’s books to the cent.' },
  { id: 'A2', ref: 'D8', topic: 'Sign of premium', question: 'Is the premium in the export already negative for returns?', current: 'The transaction type decides the sign. Cancellations and return-premium endorsements are always negative, so they create a chargeback.', why: 'Depends on whether the QQCatalyst export is already signed.' },
  { id: 'A3', ref: 'D4', topic: 'Chargeback rate and split', question: 'Which commission % and split does a chargeback use?', current: 'The commission % and split entered on the cancellation line (by default the producer’s current split).', why: 'It could instead be the rate and split of the original sale, which matters when a split changed or the producer left.' },
  { id: 'A4', ref: 'D5', topic: 'Negative month', question: 'What happens when a producer’s month is negative?', current: 'Nothing is paid; the shortfall is carried forward and netted against the next month. Nothing is owed back to the agency.', why: 'Changes the statement and what payroll pays.' },
  { id: 'A5', ref: 'D9', topic: 'Commissionable premium', question: 'What counts as commissionable premium?', current: 'The premium entered is taken as commissionable premium: excluding taxes, policy fees, broker fees and surplus-lines fees.', why: 'Fees included in the premium would overstate every commission.' },
  { id: 'A6', ref: 'D1', topic: 'Carrier commission %', question: 'Where does the carrier commission % come from?', current: 'Entered by hand on each transaction; there is no carrier or MGA rate table.', why: 'If the QQCatalyst export doesn’t carry the rate, a rate table is needed.' },
  { id: 'A7', ref: 'D3', topic: 'Which split applies', question: 'Which date or agreement decides the split?', current: 'The split is fixed when a transaction is entered (from the producer’s default, editable on the line). Changing a default affects new transactions only.', why: 'Matters for mid-month split changes.' },
  { id: 'A8', ref: '—', topic: 'Manual adjustments', question: 'What does a manual adjustment change?', current: 'Only the producer’s payout: gross commission is unchanged and agency retained absorbs the difference. A reason is required, and an adjustment can only be reversed, never edited or deleted.', why: 'Some adjustments may be corrections of the carrier commission, which would change gross as well.' },
  { id: 'A9', ref: 'D11', topic: 'Commission month', question: 'Which month does a commission belong to?', current: 'The month of the transaction’s effective date.', why: 'It could be when the premium is billed, collected or paid by the carrier.' },
  { id: 'A10', ref: 'D7', topic: 'What producers may see', question: 'What may producers see on their statement?', current: 'This is the manager view: it shows gross commission and agency retained. A producer’s own copy would hide agency retained.', why: 'Decides the producer statement layout and access.' },
  { id: 'A11', ref: 'D13', topic: 'Approval', question: 'Who approves statements before payroll?', current: 'Not modelled: statements are marked DRAFT.', why: 'The owner only, or a second manager as well.' },
];

/** What the agency HAS confirmed — shown as confirmed, everything else stays an assumption. */
export const CONFIRMED_RULES = [
  'Gross commission = premium × carrier commission %.',
  'Agent payout = gross commission × producer split %; agency retained = gross − agent payout.',
  'A negative premium creates negative commission (a chargeback).',
  'A monthly statement per producer, with manual adjustments and a permanent history.',
];
