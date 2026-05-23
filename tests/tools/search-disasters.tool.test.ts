/**
 * @fileoverview Tests for the reliefweb_search_disasters tool.
 * @module tests/tools/search-disasters.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchDisasters } from '@/mcp-server/tools/definitions/search-disasters.tool.js';

const mockSearchDisasters = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ searchDisasters: mockSearchDisasters }),
}));

describe('reliefwebSearchDisasters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disaster summaries on success', async () => {
    const items = [
      {
        id: 55555,
        name: 'Turkey: Earthquake 2023',
        status: 'past',
        glide: 'EQ-2023-000053-TUR',
        dateEvent: '2023-02-06T00:00:00+00:00',
        dateCreated: '2023-02-06T12:00:00+00:00',
        primaryCountry: 'Turkey',
        types: ['Earthquake'],
        primaryType: 'Earthquake',
        urlAlias: 'https://reliefweb.int/disaster/eq-2023-000053-tur',
      },
    ];
    mockSearchDisasters.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebSearchDisasters.input.parse({ disaster_type: 'Earthquake', limit: 5 });
    const result = await reliefwebSearchDisasters.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 55555, name: 'Turkey: Earthquake 2023' });
    expect(result.totalCount).toBe(1);
  });

  it('returns empty result with message when no disasters match', async () => {
    mockSearchDisasters.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchDisasters.input.parse({
      text: 'zzznomatch',
      country: 'ZZZ',
      disaster_type: 'Volcano',
    });
    const result = await reliefwebSearchDisasters.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.message).toBeDefined();
    expect(result.message).toContain('zzznomatch');
    expect(result.message).toContain('ZZZ');
  });

  it('handles sparse disaster with only required fields', async () => {
    const items = [{ id: 1, name: 'Minimal Disaster' }];
    mockSearchDisasters.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebSearchDisasters.input.parse({ limit: 1 });
    const result = await reliefwebSearchDisasters.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 1, name: 'Minimal Disaster' });
    expect(result.items[0].dateCreated).toBeUndefined();
    expect(result.items[0].types).toBeUndefined();
  });

  it('formats output including dateCreated and all types', () => {
    const output = {
      items: [
        {
          id: 55555,
          name: 'Turkey Earthquake',
          status: 'past',
          glide: 'EQ-2023-000053-TUR',
          primaryType: 'Earthquake',
          types: ['Earthquake'],
          dateEvent: '2023-02-06T00:00:00+00:00',
          dateCreated: '2023-02-06T12:00:00+00:00',
          primaryCountry: 'Turkey',
          countries: ['Turkey', 'Syria'],
          urlAlias: 'https://reliefweb.int/disaster/eq-2023-000053-tur',
        },
      ],
      totalCount: 1,
    };
    const blocks = reliefwebSearchDisasters.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('55555');
    expect(text).toContain('Turkey Earthquake');
    expect(text).toContain('EQ-2023-000053-TUR');
    expect(text).toContain('Earthquake');
    expect(text).toContain('2023-02-06');
    expect(text).toContain('Turkey');
  });
});
