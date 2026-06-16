/**
 * @fileoverview Edge case and pagination tests for reliefweb_search_reports.
 * @module tests/tools/search-reports-edge.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';

const mockSearchReports = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ searchReports: mockSearchReports }),
}));

describe('reliefwebSearchReports — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes country code to uppercase', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ country: 'afg' });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'AFG' }),
      ctx,
    );
  });

  it('strips whitespace-only text and does not forward it', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ text: '   ' });
    await reliefwebSearchReports.handler(input, ctx);

    // Whitespace-only text.trim() is falsy — should not include text key
    const callArg = mockSearchReports.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('text');
  });

  it('passes pagination offset correctly', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 100 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ limit: 10, offset: 20 });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
      ctx,
    );
  });

  it('forwards disaster_id filter when provided', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ disaster_id: 55555 });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ disasterId: 55555 }),
      ctx,
    );
  });

  it('forwards include_archived flag', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({ include_archived: true });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ includeArchived: true }),
      ctx,
    );
  });

  it('forwards raw filter object when provided', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const rawFilter = {
      operator: 'AND',
      conditions: [
        { field: 'format.name', value: 'Map' },
        { field: 'language.code', value: 'fr' },
      ],
    };
    const input = reliefwebSearchReports.input.parse({ filter: rawFilter });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(expect.objectContaining({ rawFilter }), ctx);
  });

  it('empty-result notice includes format filter when set', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({
      text: 'floods',
      format: 'Situation Report',
    });
    await reliefwebSearchReports.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toContain('floods');
    expect(enrichment.notice).toContain('Situation Report');
  });

  it('empty-result notice echoes the full filter set (language, source, dates, disaster_id)', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({
      country: 'syr',
      disaster_id: 42,
      language: 'fr',
      source: 'UNHCR',
      date_from: '2024-01-01T00:00:00+00:00',
      date_to: '2024-06-01T00:00:00+00:00',
    });
    await reliefwebSearchReports.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('country=SYR');
    expect(notice).toContain('disaster_id=42');
    expect(notice).toContain('language=fr');
    expect(notice).toContain('source="UNHCR"');
    expect(notice).toContain('date_from=2024-01-01T00:00:00+00:00');
    expect(notice).toContain('date_to=2024-06-01T00:00:00+00:00');
  });

  it('empty-result notice with no filters uses generic message', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchReports.input.parse({});
    await reliefwebSearchReports.handler(input, ctx);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    // No specific filter in notice — generic message
    expect(enrichment.notice).toContain('the given filters');
  });

  const defaultApplied = {
    sort: 'date.original:desc',
    preset: 'latest',
    limit: 10,
    offset: 0,
  };

  it('format: formats empty items list gracefully', () => {
    const output = { items: [], appliedFilters: defaultApplied };
    const blocks = reliefwebSearchReports.format!(output);
    expect(blocks[0].type).toBe('text');
    // Empty list — only the applied-filters line, no crash, no undefined.
    expect((blocks[0] as { text: string }).text).toBeDefined();
    expect((blocks[0] as { text: string }).text).not.toContain('undefined');
  });

  it('format: item without fileUrls or headlineSummary renders without undefined', () => {
    const output = {
      items: [{ id: 1, title: 'Minimal Report' }],
      appliedFilters: defaultApplied,
    };
    const blocks = reliefwebSearchReports.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).not.toContain('undefined');
    expect(text).toContain('1');
    expect(text).toContain('Minimal Report');
  });

  it('format: renders multiple items', () => {
    const output = {
      items: [
        { id: 1, title: 'Report One', sources: ['OCHA'] },
        { id: 2, title: 'Report Two', sources: ['WFP'] },
      ],
      appliedFilters: defaultApplied,
    };
    const blocks = reliefwebSearchReports.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Report One');
    expect(text).toContain('Report Two');
    expect(text).toContain('OCHA');
    expect(text).toContain('WFP');
  });

  it('format: handles unicode in titles without crashing', () => {
    const output = {
      items: [{ id: 1, title: 'Rapport d’urgence: Côte d’Ivoire — 快报' }],
      appliedFilters: defaultApplied,
    };
    const blocks = reliefwebSearchReports.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Côte');
    expect(text).toContain('快报');
  });

  it('max limit value (1000) is accepted by Zod schema', () => {
    expect(() => reliefwebSearchReports.input.parse({ limit: 1000 })).not.toThrow();
  });

  it('min limit value (1) is accepted by Zod schema', () => {
    expect(() => reliefwebSearchReports.input.parse({ limit: 1 })).not.toThrow();
  });
});
