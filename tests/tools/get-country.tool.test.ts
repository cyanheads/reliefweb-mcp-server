/**
 * @fileoverview Tests for the reliefweb_get_country tool.
 * @module tests/tools/get-country.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetCountry } from '@/mcp-server/tools/definitions/get-country.tool.js';

const mockGetCountry = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getCountry: mockGetCountry }),
}));

describe('reliefwebGetCountry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns country profile on success', async () => {
    const country = {
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
      status: 'current',
      urlAlias: 'https://reliefweb.int/country/syr',
      profileOverview: 'Overview of the Syria crisis.',
      keyContent: [{ title: 'Syria Response', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [
        { title: 'Humanitarian Response', url: 'https://reliefweb.int/appeal', date: '2024-01-01' },
      ],
      usefulLinks: [{ title: 'OCHA Syria', url: 'https://www.unocha.org/syria' }],
    };
    mockGetCountry.mockResolvedValue(country);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'SYR' });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result).toMatchObject({ id: 10001, name: 'Syrian Arab Republic', iso3: 'SYR' });
  });

  it('normalizes ISO3 code to uppercase before lookup', async () => {
    mockGetCountry.mockResolvedValue({ id: 10001, name: 'Syrian Arab Republic', iso3: 'SYR' });

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'syr' });
    await reliefwebGetCountry.handler(input, ctx);

    expect(mockGetCountry).toHaveBeenCalledWith('SYR', ctx);
  });

  it('throws not_found when country does not exist', async () => {
    mockGetCountry.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'ZZZ' });

    await expect(reliefwebGetCountry.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('handles sparse country without profile data', async () => {
    const country = { id: 999, name: 'Minimal Country' };
    mockGetCountry.mockResolvedValue(country);

    const ctx = createMockContext({ errors: reliefwebGetCountry.errors });
    const input = reliefwebGetCountry.input.parse({ iso3: 'MIN' });
    const result = await reliefwebGetCountry.handler(input, ctx);

    expect(result.id).toBe(999);
    expect(result.keyContent).toBeUndefined();
    expect(result.appealsResponsePlans).toBeUndefined();
  });

  it('formats output including id, iso3, and profile sections', () => {
    const output = {
      id: 10001,
      name: 'Syrian Arab Republic',
      iso3: 'SYR',
      status: 'current',
      urlAlias: 'https://reliefweb.int/country/syr',
      profileOverview: 'Syria crisis overview.',
      keyContent: [{ title: 'Key Report', url: 'https://reliefweb.int/key' }],
      appealsResponsePlans: [
        { title: 'HRP 2024', url: 'https://reliefweb.int/hrp', date: '2024-01-01' },
      ],
      usefulLinks: [{ title: 'OCHA', url: 'https://ocha.org' }],
    };
    const blocks = reliefwebGetCountry.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('10001');
    expect(text).toContain('Syrian Arab Republic');
    expect(text).toContain('SYR');
    expect(text).toContain('Syria crisis overview.');
    expect(text).toContain('Key Report');
    expect(text).toContain('HRP 2024');
    expect(text).toContain('OCHA');
  });
});
