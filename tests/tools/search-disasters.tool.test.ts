/**
 * @fileoverview Tests for the reliefweb_search_disasters tool.
 * @module tests/tools/search-disasters.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
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
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('echoes appliedFilters with normalized country and resolved defaults', async () => {
    mockSearchDisasters.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchDisasters.input.parse({
      country: 'tur',
      disaster_type: 'Earthquake',
      status: 'past',
      limit: 5,
    });
    const result = await reliefwebSearchDisasters.handler(input, ctx);

    expect(result.appliedFilters).toMatchObject({
      country: 'TUR',
      disasterType: 'Earthquake',
      status: 'past',
      sort: 'date.created:desc',
      preset: 'latest',
      limit: 5,
      offset: 0,
    });
  });

  it('populates notice enrichment when no disasters match', async () => {
    mockSearchDisasters.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchDisasters.input.parse({
      text: 'zzznomatch',
      country: 'ZZZ',
      disaster_type: 'Volcano',
    });
    const result = await reliefwebSearchDisasters.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('zzznomatch');
    expect(enrichment.notice).toContain('ZZZ');
  });

  it('empty-result notice echoes glide and date range filters', async () => {
    mockSearchDisasters.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchDisasters.input.parse({
      glide: 'EQ-2023-000053-TUR',
      date_from: '2023-01-01T00:00:00+00:00',
      date_to: '2023-12-31T00:00:00+00:00',
    });
    await reliefwebSearchDisasters.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('glide=EQ-2023-000053-TUR');
    expect(notice).toContain('date_from=2023-01-01T00:00:00+00:00');
    expect(notice).toContain('date_to=2023-12-31T00:00:00+00:00');
  });

  it('throws ctx.fail("upstream_error") when the service rejects', async () => {
    mockSearchDisasters.mockRejectedValue(
      new McpError(JsonRpcErrorCode.RateLimited, 'ReliefWeb returned HTTP 429'),
    );

    const ctx = createMockContext({ errors: reliefwebSearchDisasters.errors });
    const input = reliefwebSearchDisasters.input.parse({ text: 'quake' });

    const err = await reliefwebSearchDisasters.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect((err as McpError).data).toMatchObject({ reason: 'upstream_error' });
    expect((err as McpError).data).toHaveProperty('recovery.hint');
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
      appliedFilters: {
        disasterType: 'Earthquake',
        sort: 'date.created:desc',
        preset: 'latest',
        limit: 10,
        offset: 0,
      },
    };
    const blocks = reliefwebSearchDisasters.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Applied filters:');
    expect(text).toContain('55555');
    expect(text).toContain('Turkey Earthquake');
    expect(text).toContain('EQ-2023-000053-TUR');
    expect(text).toContain('Earthquake');
    expect(text).toContain('2023-02-06');
    expect(text).toContain('Turkey');
  });
});
