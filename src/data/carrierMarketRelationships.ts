import type { CarrierMarketRelationship } from '../types';

/**
 * Built-in carrier ↔ intermediary paths — none. An agency's access routes (direct, through an
 * MGA or wholesaler) are recorded in its private Market Access Directory (Carrier 101, migration
 * 0049), never in this public dataset.
 */
export const carrierMarketRelationships: CarrierMarketRelationship[] = [];
