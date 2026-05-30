/**
 * @fileoverview Tests for the reliefweb_list_countries tool.
 * @module tests/tools/list-countries.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebListCountries } from '@/mcp-server/tools/definitions/list-countries.tool.js';

const mockListCountries = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ listCountries: mockListCountries }),
}));

describe('reliefwebListCountries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all countries by default', async () => {
    const items = [
      {
        id: 10001,
        name: 'Afghanistan',
        iso3: 'AFG',
        status: 'current',
        urlAlias: 'https://reliefweb.int/country/afg',
      },
      {
        id: 10002,
        name: 'Syria',
        iso3: 'SYR',
        status: 'current',
        urlAlias: 'https://reliefweb.int/country/syr',
      },
    ];
    mockListCountries.mockResolvedValue({ items, totalCount: 2 });

    const ctx = createMockContext();
    const input = reliefwebListCountries.input.parse({});
    const result = await reliefwebListCountries.handler(input, ctx);

    expect(result.items).toHaveLength(2);
    expect(getEnrichment(ctx).totalCount).toBe(2);
  });

  it('applies default limit of 100', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebListCountries.input.parse({});
    expect(input.limit).toBe(100);
    await reliefwebListCountries.handler(input, ctx);

    expect(mockListCountries).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }), ctx);
  });

  it('passes crisis_only filter when set', async () => {
    mockListCountries.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebListCountries.input.parse({ crisis_only: true });
    await reliefwebListCountries.handler(input, ctx);

    expect(mockListCountries).toHaveBeenCalledWith(
      expect.objectContaining({ crisisOnly: true }),
      ctx,
    );
  });

  it('handles sparse country without iso3 or status', async () => {
    const items = [{ id: 999, name: 'Minimal Country' }];
    mockListCountries.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebListCountries.input.parse({});
    const result = await reliefwebListCountries.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 999, name: 'Minimal Country' });
    expect(result.items[0].iso3).toBeUndefined();
  });

  it('formats output including id for each item', () => {
    const output = {
      items: [
        {
          id: 10001,
          name: 'Afghanistan',
          iso3: 'AFG',
          status: 'current',
          urlAlias: 'https://reliefweb.int/country/afg',
        },
        { id: 10002, name: 'France', iso3: 'FRA' },
      ],
    };
    const blocks = reliefwebListCountries.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('10001');
    expect(text).toContain('Afghanistan');
    expect(text).toContain('AFG');
    expect(text).toContain('10002');
    expect(text).toContain('France');
  });
});
