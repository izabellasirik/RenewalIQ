import type { FieldValue } from './common';

export interface BusinessInfo {
  namedInsured: FieldValue<string>;
  legalEntity: FieldValue<string>;
  /** Full raw address as stated in the source document, e.g. "9200 West Commerce Street, Phoenix, AZ 85043". */
  address: FieldValue<string>;
  /** Street portion only, derived from `address` when it parses as "Street, City, State ZIP". */
  city: FieldValue<string>;
  state: FieldValue<string>;
  zip: FieldValue<string>;
  yearsInBusiness: FieldValue<number>;
  annualRevenue: FieldValue<number>;
  descriptionOfOperations: FieldValue<string>;
}
