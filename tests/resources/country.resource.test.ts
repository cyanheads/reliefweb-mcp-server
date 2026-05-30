/**
 * @fileoverview Tests for the reliefweb://countries/{iso3} resource.
 * @module tests/resources/country.resource.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// validationError() uses JsonRpcErrorCode.ValidationError (-32007), not InvalidParams (-32602)
const VALIDATION_CODE = JsonRpcErrorCode.ValidationError;

import { countryResource } from '@/mcp-server/resources/definitions/country.resource.js';

const mockGetCountry = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getCountry: mockGetCountry }),
}));

describe('countryResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns country profile for valid ISO3 code', async () => {
    const country = {
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
      status: 'current',
      urlAlias: 'https://reliefweb.int/country/syr',
      profileOverview: 'Overview of the Syria crisis.',
    };
    mockGetCountry.mockResolvedValue(country);

    const ctx = createMockContext({ uri: new URL('reliefweb://countries/SYR') });
    const result = await countryResource.handler({ iso3: 'SYR' }, ctx);

    expect(result).toMatchObject({ id: 10001, name: 'Syrian Arab Republic', iso3: 'SYR' });
    expect(mockGetCountry).toHaveBeenCalledWith('SYR', ctx);
  });

  it('normalizes lowercase ISO3 to uppercase before lookup', async () => {
    mockGetCountry.mockResolvedValue({ id: 10001, name: 'Afghanistan', iso3: 'AFG' });

    const ctx = createMockContext({ uri: new URL('reliefweb://countries/afg') });
    await countryResource.handler({ iso3: 'afg' }, ctx);

    expect(mockGetCountry).toHaveBeenCalledWith('AFG', ctx);
  });

  it('normalizes mixed-case ISO3 to uppercase', async () => {
    mockGetCountry.mockResolvedValue({ id: 10002, name: 'Ukraine', iso3: 'UKR' });

    const ctx = createMockContext({ uri: new URL('reliefweb://countries/Ukr') });
    await countryResource.handler({ iso3: 'Ukr' }, ctx);

    expect(mockGetCountry).toHaveBeenCalledWith('UKR', ctx);
  });

  it('throws ValidationError for ISO3 code shorter than 3 characters', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://countries/AF') });

    await expect(countryResource.handler({ iso3: 'AF' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetCountry).not.toHaveBeenCalled();
  });

  it('throws ValidationError for ISO3 code longer than 3 characters', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://countries/AFGH') });

    await expect(countryResource.handler({ iso3: 'AFGH' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetCountry).not.toHaveBeenCalled();
  });

  it('throws ValidationError for ISO3 code with non-alpha characters', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://countries/1AF') });

    await expect(countryResource.handler({ iso3: '1AF' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetCountry).not.toHaveBeenCalled();
  });

  it('throws NotFound when country does not exist', async () => {
    mockGetCountry.mockResolvedValue(null);

    const ctx = createMockContext({ uri: new URL('reliefweb://countries/ZZZ') });

    await expect(countryResource.handler({ iso3: 'ZZZ' }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('handles sparse country without optional profile fields', async () => {
    mockGetCountry.mockResolvedValue({ id: 999, name: 'Minimal Country' });

    const ctx = createMockContext({ uri: new URL('reliefweb://countries/MIN') });
    const result = await countryResource.handler({ iso3: 'MIN' }, ctx);

    expect(result).toMatchObject({ id: 999, name: 'Minimal Country' });
  });

  it('does not expose service internals in validation error message', async () => {
    const ctx = createMockContext({ uri: new URL('reliefweb://countries/12') });

    try {
      await countryResource.handler({ iso3: '12' }, ctx);
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const message = String((err as { message?: string }).message ?? err);
      expect(message).not.toMatch(/api[_-]?key/i);
      expect(message).not.toMatch(/token/i);
      expect(message).not.toMatch(/secret/i);
      expect(message).not.toMatch(/password/i);
    }
    expect(mockGetCountry).not.toHaveBeenCalled();
  });

  it('does not expose service internals in not-found error message', async () => {
    mockGetCountry.mockResolvedValue(null);

    const ctx = createMockContext({ uri: new URL('reliefweb://countries/XYZ') });

    try {
      await countryResource.handler({ iso3: 'XYZ' }, ctx);
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const message = String((err as { message?: string }).message ?? err);
      expect(message).not.toMatch(/api[_-]?key/i);
      expect(message).not.toMatch(/token/i);
      expect(message).not.toMatch(/secret/i);
    }
  });

  it('strips whitespace from ISO3 before length check', async () => {
    // "  S  " trims to "S" which is 1 char — must reject, not pass 1-char to service
    const ctx = createMockContext({ uri: new URL('reliefweb://countries/%20S%20') });

    await expect(countryResource.handler({ iso3: '  S  ' }, ctx)).rejects.toMatchObject({
      code: VALIDATION_CODE,
    });
    expect(mockGetCountry).not.toHaveBeenCalled();
  });
});
