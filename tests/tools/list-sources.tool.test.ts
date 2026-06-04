/**
 * @fileoverview Tests for the reliefweb_list_sources tool.
 * @module tests/tools/list-sources.tool.test
 */

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

    const ctx = createMockContext();
    const input = reliefwebListSources.input.parse({ text: 'UNHCR' });
    const result = await reliefwebListSources.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 1111, shortname: 'UNHCR' });
    expect(getEnrichment(ctx).totalCount).toBe(1);
  });

  it('passes type filter correctly', async () => {
    mockListSources.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
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

  it('handles sparse source without optional fields', async () => {
    const items = [{ id: 999, name: 'Minimal Source' }];
    mockListSources.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebListSources.input.parse({});
    const result = await reliefwebListSources.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 999, name: 'Minimal Source' });
    expect(result.items[0].shortname).toBeUndefined();
    expect(result.items[0].url).toBeUndefined();
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
    expect(blocks[0].type).toBe('text');
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
