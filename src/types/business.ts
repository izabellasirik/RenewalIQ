import type { FieldValue } from './common';

export interface BusinessInfo {
  namedInsured: FieldValue<string>;
  legalEntity: FieldValue<string>;
  address: FieldValue<string>;
  state: FieldValue<string>;
  yearsInBusiness: FieldValue<number>;
  annualRevenue: FieldValue<number>;
  descriptionOfOperations: FieldValue<string>;
}
