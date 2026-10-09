/**
 * @fileoverview Edge case and pagination tests for reliefweb_search_reports.
 * @module tests/tools/search-reports-edge.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';
import { contractError } from '../helpers/contract-error.js';

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

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ country: 'afg' });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'AFG' }),
      ctx,
    );
  });

  it('strips whitespace-only text and does not forward it', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ text: '   ' });
    await reliefwebSearchReports.handler(input, ctx);

    // Whitespace-only text.trim() is falsy — should not include text key
    const callArg = mockSearchReports.mock.calls[0]![0];
    expect(callArg).not.toHaveProperty('text');
  });

  it('passes pagination offset correctly', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 100 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ limit: 10, offset: 20 });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
      ctx,
    );
  });

  it('forwards disaster_id filter when provided', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ disaster_id: 55555 });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ disasterId: 55555 }),
      ctx,
    );
  });

  it('leaves include_archived out of the service call — reports have no archive', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ include_archived: true });
    await reliefwebSearchReports.handler(input, ctx);

    const params = mockSearchReports.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('includeArchived');
  });

  it('forwards raw filter object when provided', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
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

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
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

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
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

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
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
    expect(blocks[0]!.type).toBe('text');
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

// ─── Issue #21: bare YYYY-MM-DD dates ────────────────────────────────────────

describe('reliefwebSearchReports — date normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });
  });

  it('resolves a bare date range to start-of-day and end-of-day before calling the service', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({
      date_from: '2026-07-01',
      date_to: '2026-07-31',
    });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: '2026-07-01T00:00:00+00:00',
        dateTo: '2026-07-31T23:59:59+00:00',
      }),
      ctx,
    );
  });

  it('echoes the resolved bounds in appliedFilters, not the raw input', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({
      date_from: '2026-07-01',
      date_to: '2026-07-31',
    });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(result.appliedFilters).toMatchObject({
      dateFrom: '2026-07-01T00:00:00+00:00',
      dateTo: '2026-07-31T23:59:59+00:00',
    });
  });

  it('renders the resolved bounds into content[] so both response paths agree', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ date_from: '2026-07-01' });
    const result = await reliefwebSearchReports.handler(input, ctx);

    const text = (reliefwebSearchReports.format!(result)[0] as { text: string }).text;
    expect(text).toContain('dateFrom=2026-07-01T00:00:00+00:00');
  });

  it('keeps a datetime already in the accepted UTC form byte-identical', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ date_from: '2026-07-01T09:30:00+00:00' });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-01T09:30:00+00:00' }),
      ctx,
    );
  });

  it('converts a non-UTC offset to the UTC instant ReliefWeb accepts', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ date_from: '2026-07-01T09:30:00+02:00' });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-01T07:30:00+00:00' }),
      ctx,
    );
    expect(result.appliedFilters.dateFrom).toBe('2026-07-01T07:30:00+00:00');
  });

  it('converts a Z-suffixed datetime, which ReliefWeb rejects verbatim', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ date_from: '2026-07-01T00:00:00.500Z' });
    await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-01T00:00:00+00:00' }),
      ctx,
    );
  });

  it('rejects an unparseable date at the schema, naming the accepted formats', () => {
    expect(() => reliefwebSearchReports.input.parse({ date_from: 'last week' })).toThrow(
      /calendar date/i,
    );
    expect(() => reliefwebSearchReports.input.parse({ date_to: '07/31/2026' })).toThrow();
  });

  it('accepts a blank date from form-based clients and treats it as omitted', async () => {
    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ date_from: '' });
    const result = await reliefwebSearchReports.handler(input, ctx);

    expect(mockSearchReports.mock.calls[0]![0]).not.toHaveProperty('dateFrom');
    expect(result.appliedFilters).not.toHaveProperty('dateFrom');
  });
});

// ─── Issue #22: paged past the end of a result set ───────────────────────────

describe('reliefwebSearchReports — offset past the end of the result set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the offset and the last reachable page instead of claiming no matches', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 1779 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({
      country: 'TUV',
      offset: 99999,
      limit: 2,
    });
    await reliefwebSearchReports.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('99999');
    expect(notice).toContain('1779');
    expect(notice).toContain('offset 1778');
    expect(notice).not.toContain('No reports matched');
  });

  it('keeps the broaden-your-search notice when nothing actually matched', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ country: 'TUV', offset: 99999 });
    await reliefwebSearchReports.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('No reports matched');
    expect(notice).not.toContain('past the end');
  });

  it('reports a last-page offset of 0 when the whole result set fits one page', async () => {
    mockSearchReports.mockResolvedValue({ items: [], totalCount: 5 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ offset: 50, limit: 10 });
    await reliefwebSearchReports.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('offset 0');
  });

  it('emits no notice at all when the page carries results', async () => {
    mockSearchReports.mockResolvedValue({ items: [{ id: 1, title: 'A' }], totalCount: 1779 });

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({ offset: 0 });
    await reliefwebSearchReports.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toBeUndefined();
  });
});

// ─── Issue #20: rejected query vs service failure ────────────────────────────

describe('reliefwebSearchReports — upstream error contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a rejected query as invalid_query with the ReliefWeb message in the error message', async () => {
    mockSearchReports.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
        upstreamMessage:
          "Unrecognized sort field 'bogus.field'. Check the entity information for available fields.",
      }),
    );

    const err = await contractError(reliefwebSearchReports, { sort: 'bogus.field:desc' });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.data).toMatchObject({ reason: 'invalid_query' });
    expect(err.message).toContain("Unrecognized sort field 'bogus.field'");
    expect(err.data?.recovery).toMatchObject({
      hint: expect.stringContaining('Correct the value named in the error message'),
    });
  });

  it('does not tell a rejected-query caller to wait out the daily quota', async () => {
    mockSearchReports.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
        upstreamMessage: "Invalid filter field 'bogus'.",
      }),
    );

    const err = await contractError(reliefwebSearchReports, { filter: { bogus: 'nope' } });

    expect(err.data).toMatchObject({ reason: 'invalid_query' });
    expect(err.data?.recovery?.hint).not.toMatch(/quota/i);
  });

  it('keeps the retry-flavored upstream_error contract for a service failure', async () => {
    mockSearchReports.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'ReliefWeb returned HTTP 503.'),
    );

    const err = await contractError(reliefwebSearchReports, { text: 'floods' });

    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(err.data).toMatchObject({ reason: 'upstream_error' });
    expect(err.data?.recovery?.hint).toMatch(/quota/i);
  });

  it('keeps the upstream error and its captured body off the client envelope', async () => {
    mockSearchReports.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'ReliefWeb returned HTTP 503.', {
        body: '{"error":{"message":"upstream detail"}}',
        status: 503,
      }),
    );

    const err = await contractError(reliefwebSearchReports, { text: 'floods' });

    expect(err.data).not.toHaveProperty('cause');
    expect(JSON.stringify(err)).not.toContain('upstream detail');
  });

  it('falls back to upstream_error when a plain network failure has no McpError code', async () => {
    mockSearchReports.mockRejectedValue(new Error('socket hang up'));

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({});

    const err = (await Promise.resolve(reliefwebSearchReports.handler(input, ctx)).catch(
      (e: unknown) => e,
    )) as McpError;

    expect(err.data).toMatchObject({ reason: 'upstream_error' });
  });
});

// ─── Issue #20: which upstream statuses stay on the service contract ─────────

describe('reliefwebSearchReports — auth and rate-limit statuses stay on upstream_error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * These are 4xx a caller cannot fix by editing the query, so routing them to a reason
   * named `invalid_query` would tell the caller to correct input that is already correct.
   * They keep the retry contract — but must still carry ReliefWeb's own explanation on the
   * text path, which is the whole point of the message being reachable at all.
   */
  it.each([
    ['401 Unauthorized', JsonRpcErrorCode.Unauthorized, 'Missing or invalid appname.'],
    [
      '403 Forbidden (unapproved appname)',
      JsonRpcErrorCode.Forbidden,
      'You are not using an approved appname. Kindly request an appname from ReliefWeb here: https://apidoc.reliefweb.int/parameters#appname',
    ],
    ['429 RateLimited', JsonRpcErrorCode.RateLimited, 'Rate limit exceeded.'],
  ])('%s fails as upstream_error carrying the ReliefWeb text', async (_l, code, upstream) => {
    mockSearchReports.mockRejectedValue(
      new McpError(code, 'ReliefWeb returned HTTP error.', { upstreamMessage: upstream }),
    );

    const err = await contractError(reliefwebSearchReports, {});

    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(err.data).toMatchObject({ reason: 'upstream_error' });
    expect(err.message).toContain(upstream);
    const hint = err.data?.recovery?.hint;
    expect(hint).not.toMatch(/correct (the value|your input)/i);
    expect(hint).toMatch(/retry/i);
  });

  it('a network failure with no upstream text keeps the plain tool message', async () => {
    mockSearchReports.mockRejectedValue(new Error('socket hang up'));

    const ctx = createMockContext({ errors: reliefwebSearchReports.errors });
    const input = reliefwebSearchReports.input.parse({});

    const err = (await Promise.resolve(reliefwebSearchReports.handler(input, ctx)).catch(
      (e: unknown) => e,
    )) as McpError;

    expect(err.message).toBe('ReliefWeb API error while searching reports.');
    expect(err.data).toMatchObject({ reason: 'upstream_error' });
  });
});
