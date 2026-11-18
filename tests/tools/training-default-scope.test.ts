/**
 * @fileoverview `reliefweb_search_training`'s default scope run through the real service: the
 * query ReliefWeb receives and the echo on both surfaces, under a fixed clock.
 * @module tests/tools/training-default-scope.test
 */

import { createInMemoryStorage, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';
import { initReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

const NOW = new Date('2026-11-18T03:55:04.321Z');
const NOW_BOUND = '2026-11-18T03:55:04+00:00';

const UPCOMING_OR_UNDATED = {
  operator: 'OR',
  conditions: [
    { field: 'date.start', value: { from: NOW_BOUND } },
    { field: 'date.start', negate: true },
  ],
};

/** The JSON body of the most recent POST to ReliefWeb. */
function posted(): { filter?: unknown; sort?: string[]; preset?: string } {
  return JSON.parse(String(vi.mocked(fetch).mock.lastCall?.[1]?.body));
}

beforeEach(() => {
  vi.stubEnv('RELIEFWEB_APP_NAME', 'test-app');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          count: 1,
          totalCount: 1,
          status: 200,
          time: 1,
          self: 'x',
          data: [{ id: 4230000, fields: { title: 'Online course' } }],
        }),
      ),
  );
  initReliefWebService({} as never, createInMemoryStorage());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('reliefweb_search_training default scope', () => {
  it('asks for training starting from now or with no start date, soonest first then newest posted', async () => {
    const result = await runToolContract(reliefwebSearchTraining, {});

    expect(posted().filter).toEqual(UPCOMING_OR_UNDATED);
    expect(posted().sort).toEqual(['date.start:asc', 'date.created:desc']);
    expect(result.structuredContent).toMatchObject({
      appliedFilters: {
        dateStartFrom: NOW_BOUND,
        undatedIncluded: true,
        sort: 'date.start:asc,date.created:desc',
      },
    });
    const text = JSON.stringify(result.content);
    expect(text).toContain(`dateStartFrom=${NOW_BOUND}`);
    expect(text).toContain('undatedIncluded=true');
  });

  it('keeps the default scope beside other filters', async () => {
    await runToolContract(reliefwebSearchTraining, { cost: 'free', format: 'online' });

    expect(posted().filter).toEqual({
      operator: 'AND',
      conditions: [
        { field: 'cost', value: 'free' },
        { field: 'format.name', value: 'online' },
        UPCOMING_OR_UNDATED,
      ],
    });
  });

  it.each([
    [{ date_start_from: '2026-12-01' }, { from: '2026-12-01T00:00:00+00:00' }],
    [{ date_start_to: '2027-01-31' }, { to: '2027-01-31T23:59:59+00:00' }],
  ])(
    'sends an explicit bound %j as a plain range that leaves undated listings out',
    async (input, range) => {
      const result = await runToolContract(reliefwebSearchTraining, input);

      expect(posted().filter).toEqual({ field: 'date.start', value: range });
      expect(result.structuredContent).not.toHaveProperty('appliedFilters.undatedIncluded');
      expect(JSON.stringify(result.content)).not.toContain('undatedIncluded');
    },
  );

  it('applies no start-date scope with include_archived', async () => {
    const result = await runToolContract(reliefwebSearchTraining, { include_archived: true });

    expect(posted()).not.toHaveProperty('filter');
    expect(posted().preset).toBe('analysis');
    expect(result.structuredContent).not.toHaveProperty('appliedFilters.dateStartFrom');
    expect(result.structuredContent).not.toHaveProperty('appliedFilters.undatedIncluded');
  });

  it('sends an explicit sort unchanged, keeping the default scope', async () => {
    const result = await runToolContract(reliefwebSearchTraining, { sort: 'date.created:desc' });

    expect(posted().sort).toEqual(['date.created:desc']);
    expect(posted().filter).toEqual(UPCOMING_OR_UNDATED);
    expect(result.structuredContent).toMatchObject({
      appliedFilters: { sort: 'date.created:desc', undatedIncluded: true },
    });
  });

  it('names the undated half of the scope when nothing matched', async () => {
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ count: 0, totalCount: 0, status: 200, time: 1, self: 'x', data: [] }),
        ),
    );
    const result = await runToolContract(reliefwebSearchTraining, { text: 'zzznomatch' });

    for (const text of [JSON.stringify(result.structuredContent), JSON.stringify(result.content)]) {
      expect(text).toContain(`start_from=${NOW_BOUND} or no start date`);
    }
  });
});
