/**
 * @fileoverview Tests for the reliefweb_get_training tool.
 * @module tests/tools/get-training.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetTraining } from '@/mcp-server/tools/definitions/get-training.tool.js';
import { contractError } from '../helpers/contract-error.js';

const mockGetTraining = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getTraining: mockGetTraining }),
}));

/** Training 4188583's real shape and field sizes — comfortably under the outline budget. */
function realisticTraining() {
  return {
    id: 4188583,
    title: 'Security Risk Management Training',
    status: 'expired',
    dateStart: '2026-07-20T00:00:00+00:00',
    dateEnd: '2026-07-23T00:00:00+00:00',
    dateRegistration: '2026-07-17T00:00:00+00:00',
    dateCreated: '2025-11-27T00:59:46+00:00',
    sources: ['Separ International'],
    countries: ['Kenya'],
    themes: ['Safety and Security'],
    formats: ['on-site'],
    types: ['Training/Workshop'],
    languages: ['en'],
    trainingLanguages: ['en'],
    urlAlias: 'https://reliefweb.int/training/4188583/security-risk-management',
    url: 'https://reliefweb.int/node/4188583',
    eventUrl: 'https://www.separinternational.com/training',
    cost: 'fee-based',
    feeInformation: 'f'.repeat(117),
    body: 'b'.repeat(1_565),
    howToRegister: 'r'.repeat(253),
  };
}

function textOf(blocks: ReturnType<NonNullable<typeof reliefwebGetTraining.format>>): string {
  return blocks.map((b) => (b as { text?: string }).text ?? '').join('\n');
}

describe('reliefwebGetTraining', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the whole listing, including registration, event link, and fee information', async () => {
    mockGetTraining.mockResolvedValue(realisticTraining());

    const ctx = createMockContext({ errors: reliefwebGetTraining.errors });
    const input = reliefwebGetTraining.input.parse({ id: 4188583 });
    const result = await reliefwebGetTraining.handler(input, ctx);

    expect(result.kind).toBe('full');
    expect(result.body).toHaveLength(1_565);
    expect(result.howToRegister).toHaveLength(253);
    expect(result.eventUrl).toBe('https://www.separinternational.com/training');
    expect(result.cost).toBe('fee-based');
    expect(result.feeInformation).toHaveLength(117);
    expect(result.sections).toBeUndefined();
  });

  it('outlines every section with its real byte size when the record is over budget', async () => {
    const training = { ...realisticTraining(), body: 'b'.repeat(40_000) };
    mockGetTraining.mockResolvedValue(training);

    const ctx = createMockContext({ errors: reliefwebGetTraining.errors });
    const input = reliefwebGetTraining.input.parse({ id: 4188583 });
    const result = await reliefwebGetTraining.handler(input, ctx);

    expect(result.kind).toBe('outline');
    expect(result.body).toBeUndefined();
    expect(result.howToRegister).toBeUndefined();

    const names = result.sections?.map((s) => s.name);
    expect(names?.slice().sort()).toEqual(Object.keys(training).sort());
    expect(names?.[0]).toBe('body');
    for (const section of result.sections ?? []) {
      const value = training[section.name as keyof typeof training];
      expect(section.bytes).toBe(JSON.stringify(value).length);
    }
    expect(result.outlineNotice).toMatch(/sections:\[\.\.\.\]/);
  });

  it('returns exactly the sections asked for plus identity metadata', async () => {
    mockGetTraining.mockResolvedValue({ ...realisticTraining(), body: 'b'.repeat(40_000) });

    const ctx = createMockContext({ errors: reliefwebGetTraining.errors });
    const input = reliefwebGetTraining.input.parse({
      id: 4188583,
      sections: ['howToRegister', 'cost', 'feeInformation'],
    });
    const result = await reliefwebGetTraining.handler(input, ctx);

    expect(Object.keys(result).sort()).toEqual(
      ['cost', 'feeInformation', 'howToRegister', 'id', 'kind', 'title', 'urlAlias'].sort(),
    );
    expect(result.cost).toBe('fee-based');
    expect(result.howToRegister).toHaveLength(253);
    expect(result.body).toBeUndefined();
  });

  it('rejects a section this record does not carry and names the ones it does', async () => {
    const { feeInformation: _omitted, ...freeCourse } = { ...realisticTraining(), cost: 'free' };
    mockGetTraining.mockResolvedValue(freeCourse);

    const err = await contractError(reliefwebGetTraining, {
      id: 4188583,
      sections: ['cost', 'feeInformation'],
    });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.message).toContain('Unknown section: feeInformation.');
    expect(err.data).toMatchObject({
      unmatched: ['feeInformation'],
      available: Object.keys(freeCourse),
    });
  });

  it('throws not_found and routes the caller back to the training search tool', async () => {
    mockGetTraining.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetTraining.errors });
    const input = reliefwebGetTraining.input.parse({ id: 9999999 });

    await expect(reliefwebGetTraining.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
      message: expect.stringContaining('reliefweb_search_training'),
    });
  });

  it('handles a sparse listing with no cost or city data', async () => {
    mockGetTraining.mockResolvedValue({ id: 1, title: 'Bare Listing' });

    const ctx = createMockContext({ errors: reliefwebGetTraining.errors });
    const input = reliefwebGetTraining.input.parse({ id: 1 });
    const result = await reliefwebGetTraining.handler(input, ctx);

    expect(result.kind).toBe('full');
    expect(result.cost).toBeUndefined();
    expect(result.cities).toBeUndefined();
    expect(result.feeInformation).toBeUndefined();
  });

  it('formats the full arm with every field the listing carries', () => {
    const output = {
      kind: 'full' as const,
      ...realisticTraining(),
      cities: ['Nairobi'],
      careerCategories: ['Safety and Security'],
    };
    const text = textOf(reliefwebGetTraining.format!(output));
    expect(text).toContain('Security Risk Management Training');
    expect(text).toContain('4188583');
    expect(text).toContain('**Mode:** full');
    expect(text).toContain('expired');
    expect(text).toContain('Separ International');
    expect(text).toContain('on-site');
    expect(text).toContain('Training/Workshop');
    expect(text).toContain('Nairobi');
    expect(text).toContain('2026-07-20T00:00:00+00:00');
    expect(text).toContain('2026-07-23T00:00:00+00:00');
    expect(text).toContain('2026-07-17T00:00:00+00:00');
    expect(text).toContain('2025-11-27T00:59:46+00:00');
    expect(text).toContain('fee-based');
    expect(text).toContain(output.feeInformation);
    expect(text).toContain('https://www.separinternational.com/training');
    expect(text).toContain('https://reliefweb.int/node/4188583');
    expect(text).toContain('## How to register');
    expect(text).toContain(output.howToRegister);
    expect(text).toContain(output.body);
  });

  it('renders every outline field into content[] so it matches structuredContent', () => {
    const output = {
      kind: 'outline' as const,
      sections: [
        { name: 'body', bytes: 40_002 },
        { name: 'howToRegister', bytes: 255 },
      ],
      outlineNotice: 'Re-call with sections:[...] — e.g. body, howToRegister.',
    };
    const text = textOf(reliefwebGetTraining.format!(output));
    expect(text).toContain('**Mode:** outline');
    expect(text).toContain('body');
    expect(text).toContain('40002');
    expect(text).toContain('howToRegister');
    expect(text).toContain('255');
    expect(text).toContain(output.outlineNotice);
  });
});
