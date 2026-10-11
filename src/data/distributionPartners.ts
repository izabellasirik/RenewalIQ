import type { DistributionPartner } from '../types';

/**
 * Built-in distribution partners (MGAs / wholesalers) — none. Which intermediaries an agency uses,
 * and how it reaches each market, is that agency's own information: it lives in the agency's
 * private Market Access Directory (Carrier 101, migration 0049), never in this public dataset.
 */
export const distributionPartners: DistributionPartner[] = [];
