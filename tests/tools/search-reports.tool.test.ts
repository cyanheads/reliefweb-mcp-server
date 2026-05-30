/**
 * @fileoverview Tests for the reliefweb_search_reports tool.
 * @module tests/tools/search-reports.tool.test
 */

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
});
