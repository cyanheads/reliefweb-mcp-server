/**
 * @fileoverview Tests for the reliefweb_get_job tool.
 * @module tests/tools/get-job.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebGetJob } from '@/mcp-server/tools/definitions/get-job.tool.js';
import { contractError } from '../helpers/contract-error.js';

const mockGetJob = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({ getJob: mockGetJob }),
}));

/** Job 4221508's real shape and field sizes — comfortably under the outline budget. */
function realisticJob() {
  return {
    id: 4221508,
    title: 'Program Manager',
    status: 'expired',
    dateCreated: '2026-07-15T10:09:12+00:00',
    dateClosing: '2026-08-03T00:00:00+00:00',
    dateChanged: '2026-08-04T00:04:02+00:00',
    sources: ['Qatar Charity'],
    countries: ['Kenya'],
    types: ['Job'],
    careerCategories: ['Program/Project Management'],
    experienceLevels: ['10+ years'],
    urlAlias: 'https://reliefweb.int/job/4221508/program-manager',
    url: 'https://reliefweb.int/node/4221508',
    body: 'b'.repeat(5_407),
    howToApply: 'a'.repeat(309),
  };
}

function textOf(blocks: ReturnType<NonNullable<typeof reliefwebGetJob.format>>): string {
  return blocks.map((b) => (b as { text?: string }).text ?? '').join('\n');
}

describe('reliefwebGetJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the whole posting, description and application instructions included', async () => {
    const job = realisticJob();
    mockGetJob.mockResolvedValue(job);

    const ctx = createMockContext({ errors: reliefwebGetJob.errors });
    const input = reliefwebGetJob.input.parse({ id: 4221508 });
    const result = await reliefwebGetJob.handler(input, ctx);

    expect(result.kind).toBe('full');
    expect(result.body).toHaveLength(5_407);
    expect(result.howToApply).toHaveLength(309);
    expect(result.status).toBe('expired');
    expect(result.dateClosing).toBe('2026-08-03T00:00:00+00:00');
    expect(result.sections).toBeUndefined();
  });

  it('outlines every section with its real byte size when the record is over budget', async () => {
    const job = { ...realisticJob(), body: 'b'.repeat(40_000) };
    mockGetJob.mockResolvedValue(job);

    const ctx = createMockContext({ errors: reliefwebGetJob.errors });
    const input = reliefwebGetJob.input.parse({ id: 4221508 });
    const result = await reliefwebGetJob.handler(input, ctx);

    expect(result.kind).toBe('outline');
    expect(result.body).toBeUndefined();
    expect(result.howToApply).toBeUndefined();

    const names = result.sections?.map((s) => s.name);
    expect(names?.slice().sort()).toEqual(Object.keys(job).sort());
    expect(names?.[0]).toBe('body');
    for (const section of result.sections ?? []) {
      const value = job[section.name as keyof typeof job];
      expect(section.bytes).toBe(JSON.stringify(value).length);
    }
    expect(result.outlineNotice).toMatch(/sections:\[\.\.\.\]/);
  });

  it('returns exactly the sections asked for plus identity metadata', async () => {
    mockGetJob.mockResolvedValue({ ...realisticJob(), body: 'b'.repeat(40_000) });

    const ctx = createMockContext({ errors: reliefwebGetJob.errors });
    const input = reliefwebGetJob.input.parse({ id: 4221508, sections: ['howToApply'] });
    const result = await reliefwebGetJob.handler(input, ctx);

    expect(Object.keys(result).sort()).toEqual(
      ['howToApply', 'id', 'kind', 'title', 'urlAlias'].sort(),
    );
    expect(result.howToApply).toHaveLength(309);
    expect(result.body).toBeUndefined();
  });

  it('rejects a section this record does not carry and names the ones it does', async () => {
    const { howToApply: _omitted, ...withoutInstructions } = realisticJob();
    mockGetJob.mockResolvedValue(withoutInstructions);

    const err = await contractError(reliefwebGetJob, {
      id: 4221508,
      sections: ['body', 'howToApply'],
    });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.message).toContain('Unknown section: howToApply.');
    expect(err.data).toMatchObject({
      unmatched: ['howToApply'],
      available: Object.keys(withoutInstructions),
    });
  });

  it('throws not_found and routes the caller back to the job search tool', async () => {
    mockGetJob.mockResolvedValue(null);

    const ctx = createMockContext({ errors: reliefwebGetJob.errors });
    const input = reliefwebGetJob.input.parse({ id: 9999999 });

    await expect(reliefwebGetJob.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
      message: expect.stringContaining('reliefweb_search_jobs'),
    });
  });

  it('handles a sparse posting with no taxonomy or body', async () => {
    mockGetJob.mockResolvedValue({ id: 1, title: 'Bare Posting' });

    const ctx = createMockContext({ errors: reliefwebGetJob.errors });
    const input = reliefwebGetJob.input.parse({ id: 1 });
    const result = await reliefwebGetJob.handler(input, ctx);

    expect(result.kind).toBe('full');
    expect(result.body).toBeUndefined();
    expect(result.themes).toBeUndefined();
    expect(result.experienceLevels).toBeUndefined();
  });

  it('formats the full arm with every field the posting carries', () => {
    const output = { kind: 'full' as const, ...realisticJob(), themes: ['Protection'] };
    const text = textOf(reliefwebGetJob.format!(output));
    expect(text).toContain('Program Manager');
    expect(text).toContain('4221508');
    expect(text).toContain('**Mode:** full');
    expect(text).toContain('expired');
    expect(text).toContain('Qatar Charity');
    expect(text).toContain('Kenya');
    expect(text).toContain('Program/Project Management');
    expect(text).toContain('10+ years');
    expect(text).toContain('Protection');
    expect(text).toContain('2026-08-03T00:00:00+00:00');
    expect(text).toContain('2026-08-04T00:04:02+00:00');
    expect(text).toContain('https://reliefweb.int/job/4221508/program-manager');
    expect(text).toContain('https://reliefweb.int/node/4221508');
    expect(text).toContain('## How to apply');
    expect(text).toContain(output.howToApply);
    expect(text).toContain(output.body);
  });

  it('renders every outline field into content[] so it matches structuredContent', () => {
    const output = {
      kind: 'outline' as const,
      sections: [
        { name: 'body', bytes: 40_002 },
        { name: 'howToApply', bytes: 311 },
      ],
      outlineNotice: 'Re-call with sections:[...] — e.g. body, howToApply.',
    };
    const text = textOf(reliefwebGetJob.format!(output));
    expect(text).toContain('**Mode:** outline');
    expect(text).toContain('body');
    expect(text).toContain('40002');
    expect(text).toContain('howToApply');
    expect(text).toContain('311');
    expect(text).toContain(output.outlineNotice);
  });
});
