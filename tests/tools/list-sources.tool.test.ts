/**
 * @fileoverview Tests for the reliefweb_list_sources tool.
 * @module tests/tools/list-sources.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebListSources } from '@/mcp-server/tools/definitions/list-sources.tool.js';

const mockListSources = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ listSources: mockListSources }),
}));

describe('reliefwebListSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns source organizations on success', async () => {
    const items = [
      {
        id: 1111,
        name: 'UN High Commissioner for Refugees',
        shortname: 'UNHCR',
        types: ['International Organization'],
        url: 'https://reliefweb.int/organization/unhcr',
        homepage: 'https://www.unhcr.org',
      },
    ];
    mockListSources.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({ text: 'UNHCR' });
    const result = await reliefwebListSources.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 1111, shortname: 'UNHCR' });
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('passes type filter correctly', async () => {
    mockListSources.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({
      type: 'Non-governmental Organization',
      limit: 20,
    });
    await reliefwebListSources.handler(input, ctx);

    expect(mockListSources).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Non-governmental Organization', limit: 20 }),
      ctx,
    );
  });

  it('rejects a type outside the ReliefWeb taxonomy at input validation', () => {
    // "United Nations" and "Academia" are not real type.name values — the enum
    // rejects them at parse time instead of returning a confusing empty page.
    expect(() => reliefwebListSources.input.parse({ type: 'United Nations' })).toThrow();
    expect(() => reliefwebListSources.input.parse({ type: 'Academia' })).toThrow();
  });

  it('populates notice enrichment echoing type and text when no sources match', async () => {
    mockListSources.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({
      text: 'zzz',
      type: 'Academic and Research Institution',
    });
    const result = await reliefwebListSources.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('text="zzz"');
    expect(enrichment.notice).toContain('type="Academic and Research Institution"');
  });

  it('does not populate notice when sources are returned', async () => {
    mockListSources.mockResolvedValue({
      items: [{ id: 1, name: 'UNHCR', shortname: 'UNHCR' }],
      totalCount: 1,
    });

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({ text: 'UNHCR' });
    await reliefwebListSources.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('throws ctx.fail("upstream_error") when the service rejects', async () => {
    mockListSources.mockRejectedValue(
      new McpError(JsonRpcErrorCode.ServiceUnavailable, 'ReliefWeb returned HTTP 503'),
    );

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({ type: 'International Organization' });

    const err = await Promise.resolve(reliefwebListSources.handler(input, ctx)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect((err as McpError).data).toMatchObject({ reason: 'upstream_error' });
    expect((err as McpError).data).toHaveProperty('recovery.hint');
  });

  it('handles sparse source without optional fields', async () => {
    const items = [{ id: 999, name: 'Minimal Source' }];
    mockListSources.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({});
    const result = await reliefwebListSources.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 999, name: 'Minimal Source' });
    expect(result.items[0]!.shortname).toBeUndefined();
    expect(result.items[0]!.url).toBeUndefined();
  });

  it('formats output including id and url for each item', () => {
    const output = {
      items: [
        {
          id: 1111,
          name: 'UN High Commissioner for Refugees',
          shortname: 'UNHCR',
          types: ['International Organization'],
          url: 'https://reliefweb.int/organization/unhcr',
          homepage: 'https://www.unhcr.org',
        },
        {
          id: 2222,
          name: 'Médecins Sans Frontières',
          shortname: 'MSF',
          types: ['NGO'],
          url: 'https://reliefweb.int/organization/msf',
        },
      ],
    };
    const blocks = reliefwebListSources.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('1111');
    expect(text).toContain('UNHCR');
    expect(text).toContain('https://reliefweb.int/organization/unhcr');
    expect(text).toContain('https://www.unhcr.org');
    expect(text).toContain('2222');
    expect(text).toContain('MSF');
    expect(text).toContain('https://reliefweb.int/organization/msf');
  });

  it('formats sparse source without url gracefully', () => {
    const output = {
      items: [{ id: 999, name: 'No URL Source' }],
    };
    const blocks = reliefwebListSources.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('999');
    expect(text).toContain('No URL Source');
    expect(text).not.toContain('undefined');
  });
});

// ─── Issue #20: rejected query vs service failure ────────────────────────────

describe('reliefwebListSources — upstream error contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ctx.fail("invalid_query") with the ReliefWeb message when the request is rejected', async () => {
    mockListSources.mockRejectedValue(
      new McpError(JsonRpcErrorCode.InvalidParams, 'ReliefWeb returned HTTP 400.', {
        upstreamMessage: "Invalid filter field 'bogus'.",
      }),
    );

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({ text: 'WFP' });

    const err = (await Promise.resolve(reliefwebListSources.handler(input, ctx)).catch(
      (e: unknown) => e,
    )) as McpError;

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.data).toMatchObject({ reason: 'invalid_query' });
    expect(err.message).toContain("Invalid filter field 'bogus'");
    expect((err.data as { recovery: { hint: string } }).recovery.hint).not.toMatch(/quota/i);
  });
});

// ─── Issue #22: paged past the end of a result set ───────────────────────────

describe('reliefwebListSources — offset past the end of the result set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the offset and the last reachable page instead of claiming no matches', async () => {
    mockListSources.mockResolvedValue({ items: [], totalCount: 7031 });

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({ offset: 99999, limit: 100 });
    await reliefwebListSources.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('99999');
    expect(notice).toContain('7031');
    expect(notice).toContain('offset 7000');
    expect(notice).not.toContain('No sources matched');
  });

  it('keeps the broaden-your-search notice when nothing actually matched', async () => {
    mockListSources.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext({ errors: reliefwebListSources.errors });
    const input = reliefwebListSources.input.parse({ text: 'zzznomatch' });
    await reliefwebListSources.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toContain('No sources matched');
  });
});
