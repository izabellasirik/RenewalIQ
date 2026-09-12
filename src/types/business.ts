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
  /** Requested policy effective date, as a plain string (e.g. "2026-01-01") — not parsed/validated as a real date type, same treatment as every other date-shaped field in this app (DriverEntry.dob, LossEntry.lossDate). */
  effectiveDate: FieldValue<string>;
}
