/**
 * @fileoverview Wiring of the theme, career-category, job-type, and language filters
 * through the search tools: the canonical value reaches the service and both response
 * surfaces, and a value naming no single tag is rejected before any upstream call. The
 * matching rule itself is tabled once, in tests/services/vocabularies.test.ts.
 * @module tests/tools/vocabulary-filters.tool.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reliefwebSearchJobs } from '@/mcp-server/tools/definitions/search-jobs.tool.js';
import { reliefwebSearchReports } from '@/mcp-server/tools/definitions/search-reports.tool.js';
import { reliefwebSearchTraining } from '@/mcp-server/tools/definitions/search-training.tool.js';
import { contractError } from '../helpers/contract-error.js';

const search = vi.fn();

vi.mock('@/services/reliefweb/reliefweb-service.js', () => ({
  getReliefWebService: () => ({
    searchReports: search,
    searchJobs: search,
    searchTraining: search,
  }),
}));

const reports = reliefwebSearchReports;
const jobs = reliefwebSearchJobs;
const training = reliefwebSearchTraining;
type SearchTool = typeof reports | typeof jobs | typeof training;

/** Runs a tool that succeeds and returns the service params and both response surfaces. */
async function run(tool: SearchTool, input: Record<string, unknown>) {
  const result = await runToolContract(tool, input);
  expect(result.isError).not.toBe(true);
  return {
    params: search.mock.lastCall?.[0] as Record<string, unknown>,
    structured: result.structuredContent as { appliedFilters: Record<string, unknown> },
    content: JSON.stringify(result.content),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  search.mockResolvedValue({ items: [], totalCount: 0 });
});

describe('theme', () => {
  it.each([
    { tool: reports, theme: 'wash', canonical: 'Water Sanitation Hygiene' },
    { tool: reports, theme: 'Protection', canonical: 'Protection and Human Rights' },
    { tool: reports, theme: 'gender, mine action', canonical: 'Gender,Mine Action' },
    { tool: jobs, theme: 'CCCM', canonical: 'Camp Coordination and Camp Management' },
    { tool: jobs, theme: 'coordination', canonical: 'Coordination' },
  ])(
    '$tool.name resolves $theme to $canonical on the service call and both surfaces',
    async ({ tool, theme, canonical }) => {
      const { params, structured, content } = await run(tool, { theme });

      expect(params.theme).toBe(canonical);
      expect(structured.appliedFilters.theme).toBe(canonical);
      expect(content).toContain(`theme=\\"${canonical}\\"`);
    },
  );

  it.each([
    { tool: reports, theme: 'Food' },
    { tool: reports, theme: 'Health and Nutrition' },
    { tool: jobs, theme: 'Food Security' },
  ])(
    '$tool.name rejects $theme as unknown_theme before calling ReliefWeb',
    async ({ tool, theme }) => {
      const err = await contractError(tool, { theme });

      expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(err.data).toMatchObject({ reason: 'unknown_theme' });
      expect(err.message).toContain(`"${theme}"`);
      expect(err.message).toContain('Food and Nutrition, Shelter and Non-Food Items');
      expect(err.message).toContain('WASH, CCCM, NFI');
      expect(err.data?.recovery?.hint).toContain('WASH');
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('echoes the canonical theme in the empty-page notice', async () => {
    const { structured } = await run(reports, { theme: 'nfi' });

    expect(JSON.stringify(structured)).toContain('theme=\\"Shelter and Non-Food Items\\"');
  });

  it('omits a blank theme', async () => {
    const { params, structured } = await run(jobs, { theme: '  ' });

    expect(params).not.toHaveProperty('theme');
    expect(structured.appliedFilters).not.toHaveProperty('theme');
  });
});

describe('career_category', () => {
  it.each([
    { tool: jobs, career_category: 'M&E', canonical: 'Monitoring and Evaluation' },
    { tool: jobs, career_category: 'Logistics', canonical: 'Logistics/Procurement' },
    { tool: jobs, career_category: 'information management', canonical: 'Information Management' },
    {
      tool: training,
      career_category: 'ict',
      canonical: 'Information and Communications Technology',
    },
    { tool: training, career_category: 'HR, Other', canonical: 'Human Resources,Other' },
  ])(
    '$tool.name resolves $career_category to $canonical on the service call and both surfaces',
    async ({ tool, career_category, canonical }) => {
      const { params, structured, content } = await run(tool, { career_category });

      expect(params.careerCategory).toBe(canonical);
      expect(structured.appliedFilters.careerCategory).toBe(canonical);
      expect(content).toContain(`careerCategory=\\"${canonical}\\"`);
    },
  );

  it.each([
    { tool: jobs, career_category: 'M&E', canonical: 'Monitoring and Evaluation' },
    {
      tool: training,
      career_category: 'ict',
      canonical: 'Information and Communications Technology',
    },
  ])(
    '$tool.name echoes the canonical career category in the empty-page notice',
    async ({ tool, career_category, canonical }) => {
      const { structured } = await run(tool, { career_category });

      expect(JSON.stringify(structured)).toContain(`career_category=\\"${canonical}\\"`);
    },
  );

  it.each([
    { tool: jobs, career_category: 'Human Resources Management' },
    { tool: jobs, career_category: 'Information' },
    { tool: training, career_category: 'Nonexistent' },
  ])(
    '$tool.name rejects $career_category as unknown_career_category before calling ReliefWeb',
    async ({ tool, career_category }) => {
      const err = await contractError(tool, { career_category });

      expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(err.data).toMatchObject({ reason: 'unknown_career_category' });
      expect(err.message).toContain(`"${career_category}"`);
      expect(err.message).toContain('Program/Project Management');
      expect(err.message).toContain('ICT, M&E, HR');
      expect(err.data?.recovery?.hint).toContain('ICT');
      expect(search).not.toHaveBeenCalled();
    },
  );
});

describe('job_type', () => {
  it.each([
    { job_type: 'consultancy', canonical: 'Consultancy' },
    { job_type: 'Consultancy, Internship', canonical: 'Consultancy,Internship' },
    { job_type: 'Tender', canonical: 'Tender/RFPs/EOIs' },
    { job_type: 'volunteer', canonical: 'Volunteer Opportunity' },
  ])(
    'resolves $job_type to $canonical on the service call and both surfaces',
    async ({ job_type, canonical }) => {
      const { params, structured, content } = await run(jobs, { job_type });

      expect(params.jobType).toBe(canonical);
      expect(structured.appliedFilters.jobType).toBe(canonical);
      expect(content).toContain(`jobType=${canonical}`);
    },
  );

  it('combines with include_archived', async () => {
    const { params, structured } = await run(jobs, {
      job_type: 'Internship',
      include_archived: true,
    });

    expect(params).toMatchObject({ jobType: 'Internship', includeArchived: true });
    expect(structured.appliedFilters).toMatchObject({ jobType: 'Internship', preset: 'analysis' });
  });

  it('echoes the canonical job type in the empty-page notice', async () => {
    const { structured } = await run(jobs, { job_type: 'internship' });

    expect(JSON.stringify(structured)).toContain('job_type=\\"Internship\\"');
  });

  it('rejects an unknown value as unknown_job_type before calling ReliefWeb', async () => {
    const err = await contractError(jobs, { job_type: 'RFP' });

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(err.data).toMatchObject({ reason: 'unknown_job_type' });
    expect(err.message).toContain('"RFP"');
    expect(err.message).toContain(
      'Job, Consultancy, Internship, Tender/RFPs/EOIs, Volunteer Opportunity',
    );
    expect(err.data?.recovery?.hint).toBeDefined();
    expect(search).not.toHaveBeenCalled();
  });

  it('omits a blank job type', async () => {
    const { params, structured } = await run(jobs, { job_type: ' ' });

    expect(params).not.toHaveProperty('jobType');
    expect(structured.appliedFilters).not.toHaveProperty('jobType');
  });
});

describe('language codes', () => {
  it.each([
    { tool: reports, input: 'language', value: 'EN', key: 'language', code: 'en' },
    { tool: training, input: 'language', value: ' FR ', key: 'language', code: 'fr' },
    {
      tool: training,
      input: 'training_language',
      value: 'Es',
      key: 'trainingLanguage',
      code: 'es',
    },
  ])(
    '$tool.name lower-cases $input on the service call and both surfaces',
    async ({ tool, input, value, key, code }) => {
      const { params, structured, content } = await run(tool, { [input]: value });

      expect(params[key]).toBe(code);
      expect(structured.appliedFilters[key]).toBe(code);
      expect(content).toContain(`${key}=${code}`);
      expect(JSON.stringify(structured)).toContain(`${input}=${code}`);
    },
  );
});

describe('declared error contract', () => {
  it.each([
    { tool: reports, reasons: ['unknown_theme'] },
    { tool: jobs, reasons: ['unknown_theme', 'unknown_career_category', 'unknown_job_type'] },
    { tool: training, reasons: ['unknown_career_category'] },
  ])('$tool.name declares each vocabulary reason as InvalidParams', ({ tool, reasons }) => {
    for (const reason of reasons) {
      expect(tool.errors).toContainEqual(
        expect.objectContaining({ reason, code: JsonRpcErrorCode.InvalidParams }),
      );
    }
  });

  it.each([
    {
      tool: reports,
      reason: 'unknown_theme',
      input: 'theme',
      values: ['WASH', 'CCCM', 'NFI', 'Protection'],
    },
    {
      tool: jobs,
      reason: 'unknown_theme',
      input: 'theme',
      values: ['WASH', 'CCCM', 'NFI', 'Protection'],
    },
    {
      tool: jobs,
      reason: 'unknown_career_category',
      input: 'career_category',
      values: ['ICT', 'M&E', 'HR', 'Logistics'],
    },
    {
      tool: training,
      reason: 'unknown_career_category',
      input: 'career_category',
      values: ['ICT', 'M&E', 'HR', 'Logistics'],
    },
    { tool: jobs, reason: 'unknown_job_type', input: 'job_type', values: ['Tender', 'Volunteer'] },
  ])(
    '$tool.name accepts every value its $reason recovery names',
    async ({ tool, reason, input, values }) => {
      const recovery = tool.errors?.find((entry) => entry.reason === reason)?.recovery;
      for (const value of values) {
        expect(recovery).toContain(value);
        await run(tool, { [input]: value });
      }
    },
  );
});
