import type { DistributionPartner } from '../types';

/**
 * MGAs/wholesalers with real, substantive appetite information behind them, drawn from an internal
 * market-intelligence list (see PRODUCT_ROADMAP.md — "Phase 1: Distribution Model"). This is
 * intentionally a subset: distribution-partner names in the source that carried no coverages,
 * appetite notes, or contact/market detail (bare name-only stubs) are excluded rather than imported
 * as empty records — they can be added later once they have real content behind them.
 *
 * None of these are "verified" in the AppetiteCriterion sense — there is no published/official
 * source being cited here, just an internal reference list. `sourceNotes` says so explicitly on
 * every record rather than implying otherwise.
 */
export const distributionPartners: DistributionPartner[] = [
  { id: 'dist_maximum', name: 'Maximum', kind: 'mga_wholesaler', sourceNotes: 'Wholesale MGA distributing a broad list of trucking markets, primarily Auto Liability with a large secondary-coverage list. Internal market list, not independently verified.' },
  { id: 'dist_rps', name: 'RPS', kind: 'mga_wholesaler', sourceNotes: 'Wholesale MGA distributing a broad list of trucking markets across most coverage lines. The source separately names an "RPS Fleet Trucking" facility (5-50 power unit fleets, cameras required, its own fillable application) — modeled as an RPS program/facility rather than a distinct risk-bearing carrier, since the source gives no indication it is anything other than RPS\'s own in-house fleet program. Internal market list, not independently verified.' },
  { id: 'dist_prime_agency', name: 'Prime Agency', kind: 'mga_wholesaler', sourceNotes: 'MGA/wholesale agency — distinct from the risk-bearing carrier "Prime Insurance," though it distributes access to it among other markets. Internal market list, not independently verified.' },
  { id: 'dist_trinity_underwriters', name: 'Trinity Underwriters', kind: 'mga_wholesaler', sourceNotes: 'MGA for NTL/APD-focused markets (Lloyd\'s, Highlander Specialty, Fortegra, Great Lakes). Internal market list, not independently verified.' },
  { id: 'dist_rocklake', name: 'Rocklake', kind: 'mga_wholesaler', sourceNotes: 'MGA distribution path referenced alongside Canal\'s Auto Liability access. Internal market list, not independently verified.' },
  { id: 'dist_crc', name: 'CRC', kind: 'mga_wholesaler', sourceNotes: 'Wholesale MGA distributing a broad list of trucking markets across most coverage lines. Internal market list, not independently verified.' },
  { id: 'dist_brs', name: 'Blue Ridge Specialty (BRS)', kind: 'mga_wholesaler', sourceNotes: 'MGA with markets for Motor Truck Cargo, Excess Liability, Inland Marine and standard Auto Liability. Internal market list, not independently verified.' },
  { id: 'dist_wholesure', name: 'Wholesure', kind: 'mga_wholesaler', sourceNotes: 'Wholesale MGA distributing several trucking and specialty (livery, general freight, dump) markets. Internal market list, not independently verified.' },
  { id: 'dist_usr', name: 'USR', kind: 'mga_wholesaler', sourceNotes: 'Wholesale MGA distributing a broad list of trucking markets across most coverage lines. Internal market list, not independently verified.' },
  { id: 'dist_bass_underwriters', name: 'Bass Underwriters', kind: 'mga_wholesaler', sourceNotes: 'MGA for GL/TI/MTC/APD markets (Lloyd\'s, Canopius, Great Lakes). Internal market list, not independently verified.' },
  { id: 'dist_morstan', name: 'Morstan General Agency', kind: 'mga_wholesaler', sourceNotes: 'MGA for APD/MTC markets (Adriatic). Internal market list, not independently verified.' },
  { id: 'dist_agent_house', name: 'Agent House', kind: 'mga_wholesaler', sourceNotes: 'MGA for NTL/APD markets (Lloyd\'s). Internal market list, not independently verified.' },
  { id: 'dist_neee', name: 'NEEE', kind: 'mga_wholesaler', sourceNotes: 'MGA distributing NICO and other secondary-coverage markets, including some difficult/distressed accounts. Internal market list, not independently verified.' },
  { id: 'dist_amwins', name: 'AMWINS', kind: 'mga_wholesaler', sourceNotes: 'Wholesale MGA with a large fleet program distributing across many trucking markets. Internal market list, not independently verified.' },
  { id: 'dist_dynamic_mga', name: 'Dynamic MGA', kind: 'mga_wholesaler', sourceNotes: 'MGA for NTL/APD online-submission markets. Internal market list, not independently verified.' },
  { id: 'dist_futuristic_underwriters', name: 'Futuristic Underwriters', kind: 'mga_wholesaler', sourceNotes: 'Program administrator for the Southlake Specialty program (telematics-based, box trucks/hotshot/cargo van/last-mile). Internal market list, not independently verified.' },
  { id: 'dist_isc_mga', name: 'ISC MGA', kind: 'mga_wholesaler', sourceNotes: 'MGA for DB Insurance / agriculture markets, Texas-only Auto Liability per the internal list. Internal market list, not independently verified.' },
  { id: 'dist_jmi', name: 'JMI', kind: 'mga_wholesaler', sourceNotes: 'MGA distributing Adriatic Ins Co per the internal list. Internal market list, not independently verified.' },
  { id: 'dist_cluett', name: 'Cluett', kind: 'mga_wholesaler', sourceNotes: 'MGA distributing Texas Insurance Company (livery, box truck) per the internal list. Internal market list, not independently verified.' },
];
