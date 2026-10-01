import { describe, expect, it } from 'vitest';
import { addressComponentsFrom, composeFullAddress } from '../fullAddress';

describe('single Address field', () => {
  it('a full address is shown as is', () => {
    expect(composeFullAddress({ address: '12 Main St, Newark, NJ 07102', city: 'Newark', state: 'NJ', zip: '07102' })).toBe('12 Main St, Newark, NJ 07102');
  });
  it('older accounts: street + separate city/state/ZIP become one line', () => {
    expect(composeFullAddress({ address: '12 Main St', city: 'Newark', state: 'NJ', zip: '07102' })).toBe('12 Main St, Newark, NJ 07102');
    expect(composeFullAddress({ address: '12 Main St, Newark', city: 'Newark', state: 'NJ', zip: null })).toBe('12 Main St, Newark, NJ');
    expect(composeFullAddress({ address: null, city: null, state: 'TX', zip: null })).toBe('TX');
    expect(composeFullAddress({ address: null, city: null, state: null, zip: null })).toBe('');
  });
  it('typing a full address keeps City/State/ZIP in step; ambiguous text changes nothing', () => {
    expect(addressComponentsFrom('12 Main St, Newark, NJ 07102')).toEqual({ city: 'Newark', state: 'NJ', zip: '07102' });
    expect(addressComponentsFrom('12 Main St Dallas TX 75001')).toEqual({ state: 'TX' });
    expect(addressComponentsFrom('12 Main St')).toEqual({});
  });
});
