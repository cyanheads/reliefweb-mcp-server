/**
 * @fileoverview Tests for the reliefweb_search_reports tool.
 * @module tests/tools/search-reports.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';

const mockSearchReports = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ searchReports: mockSearchReports }),
}));

describe('reliefwebSearchReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated report summaries on success', async () => {
    const items = [
      {
        id: 1234567,
        title: 'Syria Situation Report',
        dateOriginal: '2024-03-15T00:00:00+00:00',
        dateCreated: '2024-03-16T00:00:00+00:00',
        primaryCountry: 'Syrian Arab Republic',
        countries: ['Syrian Arab Republic'],
        sources: ['UNHCR'],
        formats: ['Situation Report'],
        themes: ['Refugees and Internally Displaced Persons'],
        languages: ['en'],
        urlAlias: 'https://reliefweb.int/report/syrian-arab-republic/test',
      },
    ];
    mockSearchReports.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ text: 'syria', limit: 10 });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 1234567, title: 'Syria Situation Report' });
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('echoes appliedFilters with normalized values and resolved defaults', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({
      text: 'flood',
      country: 'syr',
      format: 'Map',
      limit: 25,
    });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(result.appliedFilters).toMatchObject({
      text: 'flood',
      country: 'SYR', // uppercased
      format: 'Map',
      sort: 'date.original:desc', // resolved default
      preset: 'latest', // resolved default (include_archived off)
      limit: 25,
      offset: 0,
    });
  });

  it('appliedFilters reflects include_archived=true as analysis preset and rawFilter flag', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({
      include_archived: true,
      sort: 'score:desc',
      filter: { field: 'language.code', value: 'fr' },
    });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(result.appliedFilters.preset).toBe('analysis');
    expect(result.appliedFilters.sort).toBe('score:desc');
    expect(result.appliedFilters.rawFilter).toBe(true);
  });

  it('throws ctx.fail("upstream_error") when the service rejects', async () => {
    mockSearchReports.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'ReliefWeb returned HTTP 502'),
    );

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ text: 'syria' });

    const err = await reliefwebSearchReports.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect((err as McpError).data).toMatchObject({ reason: 'upstream_error' });
    expect((err as McpError).data).toHaveProperty('recovery.hint');
    expect(((err as McpError).data as { recovery: { hint: string } }).recovery.hint).toContain(
      '1,000 calls/day',
    );
  });

  it('populates notice enrichment when no reports match', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ text: 'zzznomatch', country: 'XYZ' });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('zzznomatch');
  });

  it('applies defaults for limit and offset', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({});

    expect(input.limit).toBe(10);
    expect(input.offset).toBe(0);
    await reliefwebSearchReports.handler(input, ctx);
    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0 }),
      ctx,
    );
  });

  it('handles sparse upstream payload gracefully', async () => {
    // Sparse item: only required fields, everything else omitted.
    const items = [{ id: 999, title: 'Minimal Report' }];
    mockSearchReports.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ limit: 1 });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 999, title: 'Minimal Report' });
    expect(result.items[0].dateCreated).toBeUndefined();
    expect(result.items[0].countries).toBeUndefined();
  });

  it('formats output completely including dateCreated and id', () => {
    const output = {
      items: [
        {
          id: 1234567,
          title: 'Test Report',
          dateOriginal: '2024-01-01T00:00:00+00:00',
          dateCreated: '2024-01-02T00:00:00+00:00',
          primaryCountry: 'Afghanistan',
          countries: ['Afghanistan'],
          sources: ['OCHA'],
          formats: ['Situation Report'],
          themes: ['Food and Nutrition'],
          languages: ['en'],
          urlAlias: 'https://reliefweb.int/report/afghanistan/test',
          fileUrls: ['https://example.com/file.pdf'],
          headlineSummary: 'Key humanitarian update.',
        },
      ],
      appliedFilters: {
        country: 'AFG',
        sort: 'date.original:desc',
        preset: 'latest',
        limit: 10,
        offset: 0,
      },
    };
    const blocks = reliefwebSearchReports.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('1234567');
    expect(text).toContain('Test Report');
    expect(text).toContain('2024-01-02');
    expect(text).toContain('2024-01-01');
    expect(text).toContain('Afghanistan');
    expect(text).toContain('OCHA');
  });

  it('format renders the applied filters line', () => {
    const output = {
      items: [{ id: 1, title: 'R' }],
      appliedFilters: {
        text: 'flood',
        country: 'SYR',
        sort: 'date.original:desc',
        preset: 'latest',
        limit: 10,
        offset: 0,
      },
    };
    const text = (reliefwebSearchReports.format!(output)[0] as { text: string }).text;
    expect(text).toContain('Applied filters:');
    expect(text).toContain('country=SYR');
    expect(text).toContain('preset=latest');
    expect(text).toContain('limit=10');
  });
});
