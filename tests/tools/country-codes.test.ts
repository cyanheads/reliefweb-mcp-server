/**
 * @fileoverview The country-code inputs: the search tools' `country`, `reliefweb_get_country`'s
 * `iso3`, and their wiring into each tool's service call, filter echo, and error envelope.
 * @module tests/tools/country-codes.test
 */

import { z } from '@cyanheads/mcp-ts-core';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTRY_CODES_PATTERN,
  countryCodesInput,
  ISO3_PATTERN,
  iso3Input,
  parseCountryCodes,
} from '@/mcp-server/tools/country-codes.js';
import { reliefwebGetCountry } from '@/mcp-server/tools/definitions/get-country.tool.js';
import { reliefwebSearchDisasters } from '@/mcp-server/tools/definitions/search-disasters.tool.js';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';

const { service } = vi.hoisted(() => ({
  service: {
    searchReports: vi.fn(),
    searchDisasters: vi.fn(),
    searchJobs: vi.fn(),
    searchTraining: vi.fn(),
    getCountry: vi.fn(),
  },
}));
vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => service,
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const search of [
    service.searchReports,
    service.searchDisasters,
    service.searchJobs,
    service.searchTraining,
  ]) {
    search.mockResolvedValue({ items: [], totalCount: 0 });
  }
});

const SEARCH_TOOLS = [
  [reliefwebSearchReports.name, reliefwebSearchReports, service.searchReports],
  [reliefwebSearchDisasters.name, reliefwebSearchDisasters, service.searchDisasters],
  [reliefwebSearchJobs.name, reliefwebSearchJobs, service.searchJobs],
  [reliefwebSearchTraining.name, reliefwebSearchTraining, service.searchTraining],
] as const;

/** Both surfaces of a tool result as text. */
function surfaces(result: { structuredContent?: unknown; content: unknown }): string[] {
  return [JSON.stringify(result.structuredContent), JSON.stringify(result.content)];
}

describe.each(SEARCH_TOOLS)('%s country wiring', (_name, tool, search) => {
  it.each(['', '   '])('treats country %j as omitted', async (country) => {
    const result = await runToolContract(tool, { country });
    expect(result.isError).not.toBe(true);
    expect(search.mock.lastCall?.[0]).not.toHaveProperty('country');
    expect(result.structuredContent).not.toHaveProperty('appliedFilters.country');
  });

  it('echoes a lowercase code uppercased on both surfaces', async () => {
    const result = await runToolContract(tool, { country: 'syr' });
    expect(result.structuredContent).toMatchObject({ appliedFilters: { country: 'SYR' } });
    expect(JSON.stringify(result.content)).toContain('country=SYR');
  });

  it('sends a padded code trimmed', async () => {
    const result = await runToolContract(tool, { country: ' SYR ' });
    expect(search.mock.lastCall?.[0]).toMatchObject({ country: ['SYR'] });
    expect(result.structuredContent).toMatchObject({ appliedFilters: { country: 'SYR' } });
  });

  it('accepts a stray comma before the first code and after the last, sending the codes alone', async () => {
    const result = await runToolContract(tool, { country: ' ,SYR,AFG, ' });
    expect(result.isError).not.toBe(true);
    expect(search.mock.lastCall?.[0]).toMatchObject({ country: ['SYR', 'AFG'] });
    expect(result.structuredContent).toMatchObject({ appliedFilters: { country: 'SYR,AFG' } });
    expect(JSON.stringify(result.content)).toContain('country=SYR,AFG');
  });

  it('sends several codes as a list and echoes them comma-joined on both surfaces', async () => {
    const result = await runToolContract(tool, { country: 'syr, afg' });
    expect(search.mock.lastCall?.[0]).toMatchObject({ country: ['SYR', 'AFG'] });
    expect(result.structuredContent).toMatchObject({ appliedFilters: { country: 'SYR,AFG' } });
    expect(JSON.stringify(result.content)).toContain('country=SYR,AFG');
    // The stub's empty page draws the zero-match notice, which names the normalized list too.
    for (const text of surfaces(result)) expect(text).toContain('matched country=SYR,AFG');
  });

  it.each(['Afghanistan', 'SY', 'SYR,AF'])(
    'rejects %j at the schema, pointing at the country lookup on both surfaces',
    async (country) => {
      const result = await runToolContract(tool, { country });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: -32602, data: { reason: 'invalid_arguments' } },
      });
      for (const text of surfaces(result)) {
        expect(text).toContain('reliefweb_list_countries');
        expect(text).toContain('text');
      }
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('advertises the country pattern in its input schema', () => {
    const country = z.toJSONSchema(tool.input, { io: 'input' }).properties?.country as
      | { pattern?: string }
      | undefined;
    expect(country?.pattern).toBe(COUNTRY_CODES_PATTERN.source);
  });
});

describe('reliefweb_get_country iso3 wiring', () => {
  it.each(['1@!', 'SY', '', '   '])(
    'rejects %j at the schema, pointing at the country lookup on both surfaces',
    async (iso3) => {
      const result = await runToolContract(reliefwebGetCountry, { iso3 });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: -32602, data: { reason: 'invalid_arguments' } },
      });
      for (const text of surfaces(result)) expect(text).toContain('reliefweb_list_countries');
      expect(service.getCountry).not.toHaveBeenCalled();
    },
  );

  it('still resolves a lowercase code', async () => {
    service.getCountry.mockResolvedValue({ id: 10001, name: 'Syrian Arab Republic', iso3: 'SYR' });
    const result = await runToolContract(reliefwebGetCountry, { iso3: 'syr' });
    expect(result.isError).not.toBe(true);
    expect(service.getCountry).toHaveBeenCalledWith('SYR', expect.anything());
  });

  it('advertises the letters-only pattern in its input schema', () => {
    const iso3 = z.toJSONSchema(reliefwebGetCountry.input, { io: 'input' }).properties?.iso3 as
      | { pattern?: string }
      | undefined;
    expect(iso3?.pattern).toBe('^[A-Za-z]{3}$');
  });

  it('names the text lookup when no profile matches', async () => {
    service.getCountry.mockResolvedValue(null);
    const result = await runToolContract(reliefwebGetCountry, { iso3: 'ZZZ' });
    expect(result.structuredContent).toMatchObject({ error: { data: { reason: 'not_found' } } });
    for (const text of surfaces(result)) {
      expect(text).toContain('reliefweb_list_countries');
      expect(text).toContain('text');
    }
  });
});

// ─── The shared inputs at their own seam ─────────────────────────────────────

const countryCodes = countryCodesInput('content');
const iso3 = iso3Input('ISO3 code.');

const ACCEPTED: [string, string[] | undefined][] = [
  ['SYR', ['SYR']],
  ['syr', ['SYR']],
  [' SYR ', ['SYR']],
  ['\tSyr\r\n', ['SYR']],
  ['SYR,AFG', ['SYR', 'AFG']],
  ['syr, afg', ['SYR', 'AFG']],
  ['SYR AFG', ['SYR', 'AFG']],
  ['SYR ,, afg\nukr', ['SYR', 'AFG', 'UKR']],
  ['SYR,syr', ['SYR']],
  ['WLD', ['WLD']],
  ['SYR,', ['SYR']],
  [',SYR', ['SYR']],
  [' , SYR , ', ['SYR']],
  ['SYR,AFG,', ['SYR', 'AFG']],
  [',,syr ,\n', ['SYR']],
  ['', undefined],
  ['   ', undefined],
  ['\r\n\t', undefined],
];

const REJECTED = [
  'Afghanistan',
  'SY',
  'SYR,AF',
  'SYRIA',
  '1@!',
  'SY1',
  ',SY',
  ',',
  ',,',
  ' , ',
  '\t,\r\n',
  'SYR;AFG',
  'SYR/AFG',
  'SYR|AFG',
  'SYR;',
  'SYR-AFG',
  'S Y R',
  'SYRAFG',
  'Côte',
  // The six ASCII characters between Z and a, which a range written [A-z] would admit.
  'A[B',
  'S\\R',
  'S]R',
  'S^R',
  'SY_',
  'SYR,AF`',
];

describe('country codes input', () => {
  it.each(ACCEPTED)('accepts %j and normalizes it to %j', (value, codes) => {
    const parsed = countryCodes.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(parseCountryCodes(parsed.data)).toEqual(codes);
  });

  it('treats an omitted value as no filter', () => {
    expect(parseCountryCodes(countryCodes.parse(undefined))).toBeUndefined();
  });

  it.each(REJECTED)('rejects %j with a message naming the text lookup', (value) => {
    const parsed = countryCodes.safeParse(value);
    expect(parsed.success).toBe(false);
    const message = parsed.error?.issues[0]?.message ?? '';
    expect(message).toContain('reliefweb_list_countries');
    expect(message).toContain('text');
  });

  it('advertises a flagless pattern that a client compiles to exactly the accepted set', () => {
    expect(COUNTRY_CODES_PATTERN.flags).toBe('');
    const { pattern } = z.toJSONSchema(countryCodes, { io: 'input' }) as { pattern: string };
    const clientSide = new RegExp(pattern, 'u');
    for (const value of [...ACCEPTED.map(([accepted]) => accepted), ...REJECTED]) {
      expect(clientSide.test(value), JSON.stringify(value)).toBe(
        countryCodes.safeParse(value).success,
      );
    }
  });
});

describe('iso3 input', () => {
  it.each(['SYR', 'syr', 'Ukr'])('accepts %j', (value) => {
    expect(iso3.safeParse(value).success).toBe(true);
  });

  it.each(['', '   ', 'SY', 'SYRA', '1@!', ' SYR', 'SYR,AFG', 'SY_'])(
    'rejects %j with a message naming the text lookup',
    (value) => {
      const parsed = iso3.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.message).toContain('reliefweb_list_countries');
    },
  );

  it('carries no regex flag', () => {
    expect(ISO3_PATTERN.flags).toBe('');
  });
});

// ─── Cost on caller-sized input ──────────────────────────────────────────────

/**
 * Least thread CPU per call of `run`, in ms, across five samples; each sample repeats `run`
 * until it has used 2 ms, so a fast call still measures above the clock's resolution.
 */
function cpuMsPerCall(run: () => unknown): number {
  let least = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < 5; sample++) {
    const start = process.threadCpuUsage();
    let calls = 0;
    let usedMs = 0;
    do {
      run();
      calls++;
      const { user, system } = process.threadCpuUsage(start);
      usedMs = (user + system) / 1000;
    } while (usedMs < 2);
    least = Math.min(least, usedMs / calls);
  }
  return least;
}

const BASELINE = 5_000;
const LARGEST = BASELINE * 64;

/**
 * Doubles the input from 5k to 320k characters. Each size must stay under an absolute CPU
 * bound before the next one runs, so a super-linear cost fails at the first doubling it
 * outgrows. The 5k baseline is timed again beside every size, three times, and the least
 * growth over those pairs across the full 64× span must stay under 256 (linear is 64).
 */
function expectLinear(make: (size: number) => string, run: (value: string) => unknown): void {
  const baseline = make(BASELINE);
  let fullSpanGrowth = Number.POSITIVE_INFINITY;
  for (let size = BASELINE * 2; size <= LARGEST; size *= 2) {
    const value = make(size);
    let leastMs = Number.POSITIVE_INFINITY;
    let leastGrowth = Number.POSITIVE_INFINITY;
    for (let pair = 0; pair < 3; pair++) {
      const baselineMs = cpuMsPerCall(() => run(baseline));
      const sizeMs = cpuMsPerCall(() => run(value));
      leastMs = Math.min(leastMs, sizeMs);
      leastGrowth = Math.min(leastGrowth, sizeMs / baselineMs);
    }
    expect(leastMs, `${size} characters`).toBeLessThan(1 + size / 10_000);
    fullSpanGrowth = leastGrowth;
  }
  expect(fullSpanGrowth).toBeLessThan(256);
}

/** Builds a value of about `size` characters by repeating `unit`, then appending `tail`. */
const repeated =
  (unit: string, tail = '') =>
  (size: number) =>
    unit.repeat(Math.ceil(size / unit.length)) + tail;

// Synchronous CPU-bound bodies: the CPU bound inside guards a hang, so no wall-clock timeout.
describe('country code input cost', { timeout: 0 }, () => {
  it.each([
    ['one long line ending in a break', repeated('§1 x', '\ny')],
    ['line breaks throughout', repeated('  \r\n')],
    ['line breaks throughout, then a letter', repeated('  \r\n', 'x')],
    ['a separator run with no code after it', (size: number) => `SYR${' '.repeat(size)}!`],
    ['codes and separators, then junk', repeated('SYR ', '!')],
    ['codes each followed by a comma', repeated('SYR,')],
    ['codes on separate lines, then junk', repeated('SYR\r\n', '!')],
    ['a comma run with no code after it', repeated(',', '!')],
    ['a comma run, then letters', repeated(',', 'Syria')],
    ['a code, then a comma run with no code after it', (size: number) => `SYR${','.repeat(size)}!`],
    [
      'whitespace, then a comma run, then junk',
      (size: number) => `${' '.repeat(size / 2)}${','.repeat(size / 2)}!`,
    ],
    ['a digit run', repeated('1')],
  ])('the country schema stays linear on %s', (_shape, make) => {
    expectLinear(make, (value) => countryCodes.safeParse(value));
  });

  it.each([
    ['comma-separated codes', repeated('SYR, ', 'AFG')],
    ['codes on separate lines', repeated('syr\r\n')],
    ['whitespace only', repeated('  \r\n')],
  ])('normalization stays linear on %s', (_shape, make) => {
    expectLinear(make, (value) => parseCountryCodes(value));
  });

  it.each([
    ['repeated codes', repeated('SYR')],
    ['whitespace', repeated(' ')],
    ['a digit run', repeated('1')],
  ])('the iso3 schema stays linear on %s', (_shape, make) => {
    expectLinear(make, (value) => iso3.safeParse(value));
  });
});
