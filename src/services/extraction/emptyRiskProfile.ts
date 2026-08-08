import type { RiskProfile } from '../../types';
import { emptyField } from '../../types';
import { generateId } from '../../utils/id';

export function createEmptyRiskProfile(accountId: string): RiskProfile {
  return {
    id: generateId('risk'),
    accountId,
    business: {
      namedInsured: emptyField(),
      legalEntity: emptyField(),
      address: emptyField(),
      state: emptyField(),
      yearsInBusiness: emptyField(),
      annualRevenue: emptyField(),
      descriptionOfOperations: emptyField(),
    },
    transportation: {
      dotNumber: emptyField(),
      mcNumber: emptyField(),
      fleetSize: emptyField(),
      vehicleTypes: emptyField(),
      operatingRadius: emptyField(),
      statesOfOperation: emptyField(),
      commoditiesHauled: emptyField(),
      driverCount: emptyField(),
      minDriverAge: emptyField(),
      minDriverExperienceYears: emptyField(),
      telematics: emptyField(),
      dashcams: emptyField(),
    },
    lossHistory: [],
    coverage: [],
    vehicles: [],
    drivers: [],
    updatedAt: new Date().toISOString(),
  };
}
