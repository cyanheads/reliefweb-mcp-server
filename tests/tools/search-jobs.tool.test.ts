/**
 * @fileoverview Tests for the reliefweb_search_jobs tool.
 * @module tests/tools/search-jobs.tool.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';

const mockSearchJobs = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ searchJobs: mockSearchJobs }),
}));

describe('reliefwebSearchJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns job listings on success', async () => {
    const items = [
      {
        id: 77777,
        title: 'Emergency Response Officer',
        dateCreated: '2024-03-01T00:00:00+00:00',
        dateClosing: '2024-04-01T00:00:00+00:00',
        sources: ['OCHA'],
        countries: ['Afghanistan'],
        themes: ['Coordination'],
        types: ['International'],
        careerCategories: ['Programme and Project Management'],
        experienceLevels: ['5-9 years'],
        urlAlias: 'https://reliefweb.int/job/test',
      },
    ];
    mockSearchJobs.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebSearchJobs.input.parse({
      career_category: 'Programme and Project Management',
    });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 77777, title: 'Emergency Response Officer' });
    expect(result.totalCount).toBe(1);
  });

  it('returns empty result with message when no jobs match', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchJobs.input.parse({
      text: 'zzznomatch',
      country: 'ZZZ',
      career_category: 'Nonexistent',
    });
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.message).toBeDefined();
    expect(result.message).toContain('zzznomatch');
  });

  it('normalizes country code to uppercase', async () => {
    mockSearchJobs.mockResolvedValue({ items: [], totalCount: 0 });

    const ctx = createMockContext();
    const input = reliefwebSearchJobs.input.parse({ country: 'afg' });
    await reliefwebSearchJobs.handler(input, ctx);

    expect(mockSearchJobs).toHaveBeenCalledWith(expect.objectContaining({ country: 'AFG' }), ctx);
  });

  it('handles sparse job listing without optional fields', async () => {
    const items = [{ id: 1, title: 'Minimal Job' }];
    mockSearchJobs.mockResolvedValue({ items, totalCount: 1 });

    const ctx = createMockContext();
    const input = reliefwebSearchJobs.input.parse({});
    const result = await reliefwebSearchJobs.handler(input, ctx);

    expect(result.items[0]).toMatchObject({ id: 1, title: 'Minimal Job' });
    expect(result.items[0].sources).toBeUndefined();
  });

  it('formats output completely', () => {
    const output = {
      items: [
        {
          id: 77777,
          title: 'Field Coordinator',
          sources: ['WFP'],
          countries: ['Kenya'],
          careerCategories: ['Logistics and Telecommunications'],
          experienceLevels: ['3-4 years'],
          themes: ['Food and Nutrition'],
          types: ['International'],
          dateCreated: '2024-03-01T00:00:00+00:00',
          dateClosing: '2024-04-01T00:00:00+00:00',
          urlAlias: 'https://reliefweb.int/job/test',
        },
      ],
      totalCount: 1,
    };
    const blocks = reliefwebSearchJobs.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('77777');
    expect(text).toContain('Field Coordinator');
    expect(text).toContain('WFP');
    expect(text).toContain('Kenya');
    expect(text).toContain('2024-03-01');
    expect(text).toContain('2024-04-01');
  });
});
