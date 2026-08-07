/**
 * @fileoverview Search humanitarian job listings on ReliefWeb.
 * @module mcp-server/tools/definitions/search-jobs
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { pagedPastEndNotice } from '@/mcp-server/tools/pagination.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';
import {
  isRejectedQueryError,
  rejectedQueryMessage,
  upstreamErrorMessage,
} from '@/services/reliefweb/upstream-errors.js';

export const reliefwebSearchJobs = tool('reliefweb_search_jobs', {
  title: 'Search ReliefWeb Jobs',
  description:
    'Search humanitarian job listings on ReliefWeb by country, organization, career category, theme, and experience level. ' +
    'Returns current open positions — archived or expired jobs are excluded by default. ' +
    'Use text search for role titles and job descriptions.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe(
        'Full-text search query. Matches against job title, body, and key metadata fields.',
      ),
    country: z
      .string()
      .optional()
      .describe(
        'ISO 3166-1 alpha-3 country code (e.g., SYR, AFG, UKR). Filters to jobs tagged with this country.',
      ),
    source: z
      .string()
      .optional()
      .describe('Organization short name (e.g., UNHCR, OCHA, WFP). Filters on source.shortname.'),
    career_category: z
      .string()
      .optional()
      .describe(
        'Humanitarian career track (e.g., Programme and Project Management, Information and Communications Technology, Logistics and Telecommunications). Filters on career_categories.name.',
      ),
    theme: z
      .string()
      .optional()
      .describe(
        'Sector or cross-cutting theme (e.g., Health, Food and Nutrition, Protection). Filters on theme.name.',
      ),
    experience: z
      .string()
      .optional()
      .describe(
        'Experience level (e.g., 0-2 years, 3-4 years, 5-9 years). Filters on experience.name.',
      ),
    sort: z
      .string()
      .optional()
      .describe(
        'Sort order. Use date.created:desc for newest postings first (default), date.closing:asc to surface roles closing soonest, or score:desc for relevance.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(10)
      .describe(
        'Number of results to return (1–1000, default 10). Each call counts against the 1,000-calls/day quota.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset for pagination. Use with limit and the totalCount enrichment field to page through results.',
      ),
  }),
  output: z.object({
    items: z
      .array(
        z
          .object({
            id: z.number().describe('ReliefWeb numeric job ID.'),
            title: z.string().describe('Job title.'),
            dateCreated: z.string().optional().describe('Date this job was indexed (ISO 8601).'),
            dateClosing: z.string().optional().describe('Application closing date (ISO 8601).'),
            sources: z.array(z.string()).optional().describe('Hiring organizations (short names).'),
            countries: z.array(z.string()).optional().describe('Countries tagged on this job.'),
            themes: z.array(z.string()).optional().describe('Humanitarian theme/sector names.'),
            types: z.array(z.string()).optional().describe('Job type names.'),
            careerCategories: z
              .array(z.string())
              .optional()
              .describe('Career category names (humanitarian tracks).'),
            experienceLevels: z
              .array(z.string())
              .optional()
              .describe('Required experience levels.'),
            urlAlias: z
              .string()
              .optional()
              .describe('Canonical ReliefWeb URL for this job listing.'),
          })
          .describe('A matching job listing.'),
      )
      .describe('Matching job listings.'),
    appliedFilters: z
      .object({
        text: z.string().optional().describe('Full-text query the search used.'),
        country: z.string().optional().describe('Country code as normalized (uppercased ISO3).'),
        source: z.string().optional().describe('Source short name filter applied.'),
        careerCategory: z.string().optional().describe('Career category name filter applied.'),
        theme: z.string().optional().describe('Theme name filter applied.'),
        experience: z.string().optional().describe('Experience level filter applied.'),
        sort: z.string().describe('Sort order the query used (resolved, including the default).'),
        limit: z.number().describe('Result limit the query used.'),
        offset: z.number().describe('Pagination offset the query used.'),
      })
      .describe(
        'The resolved filter set the query actually ran with, after normalization and defaults. Echoes back so the agent can confirm how its inputs were interpreted.',
      ),
  }),
  enrichment: {
    totalCount: z.number().describe('Total jobs matching the query before pagination.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Present only when the page is empty. Names the match count and the last reachable offset when the query matched records; otherwise echoes the filters applied and suggests how to broaden.',
      ),
  },
  errors: [
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'ReliefWeb rejected the query — typically an unrecognized sort field.',
      recovery:
        'Correct the value named in the error message and call again; an unchanged retry is rejected identically. Sort fields must be real ReliefWeb field names such as date.created or date.closing.',
    },
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The ReliefWeb API was unreachable, timed out, or returned a server error.',
      recovery:
        'Wait a moment and retry. If the message names a configuration or quota problem — an unapproved appname, or the 1,000 calls/day limit — that must be resolved before any retry can succeed.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_search_jobs', {
      text: input.text,
      country: input.country,
      careerCategory: input.career_category,
      limit: input.limit,
    });

    const country = input.country?.trim() ? input.country.toUpperCase() : undefined;

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.source?.trim() ? { source: input.source } : {}),
      ...(input.career_category?.trim() ? { careerCategory: input.career_category } : {}),
      ...(input.theme?.trim() ? { theme: input.theme } : {}),
      ...(input.experience?.trim() ? { experience: input.experience } : {}),
      sort: input.sort?.trim() || 'date.created:desc',
      limit: input.limit,
      offset: input.offset,
    };

    const result = await getReliefWebService()
      .searchJobs(
        {
          ...(input.text?.trim() ? { text: input.text } : {}),
          ...(country ? { country } : {}),
          ...(input.source?.trim() ? { source: input.source } : {}),
          ...(input.career_category?.trim() ? { careerCategory: input.career_category } : {}),
          ...(input.theme?.trim() ? { theme: input.theme } : {}),
          ...(input.experience?.trim() ? { experience: input.experience } : {}),
          ...(input.sort?.trim() ? { sort: input.sort } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        if (isRejectedQueryError(err)) {
          throw ctx.fail('invalid_query', rejectedQueryMessage('jobs', err), {
            cause: err,
            ...ctx.recoveryFor('invalid_query'),
          });
        }
        throw ctx.fail(
          'upstream_error',
          upstreamErrorMessage('ReliefWeb API error while searching jobs.', err),
          {
            cause: err,
            ...ctx.recoveryFor('upstream_error'),
          },
        );
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0 && result.totalCount > 0) {
      ctx.enrich.notice(
        pagedPastEndNotice({
          subject: 'jobs',
          offset: input.offset,
          totalCount: result.totalCount,
          limit: input.limit,
        }),
      );
    } else if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (country) filters.push(`country=${country}`);
      if (input.source) filters.push(`source="${input.source}"`);
      if (input.career_category) filters.push(`career_category="${input.career_category}"`);
      if (input.theme) filters.push(`theme="${input.theme}"`);
      if (input.experience) filters.push(`experience="${input.experience}"`);
      ctx.enrich.notice(
        `No jobs matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try broader keywords, remove the country filter, or check the career category spelling.',
      );
    }

    return { items: result.items, appliedFilters };
  },

  format: (result) => {
    const lines: string[] = [renderAppliedFilters(result.appliedFilters)];
    for (const item of result.items) {
      lines.push(`\n## ${item.title}`);
      lines.push(`**ID:** ${item.id}`);
      if (item.sources?.length) lines.push(`**Organization:** ${item.sources.join(', ')}`);
      if (item.countries?.length) lines.push(`**Countries:** ${item.countries.join(', ')}`);
      if (item.careerCategories?.length)
        lines.push(`**Career category:** ${item.careerCategories.join(', ')}`);
      if (item.experienceLevels?.length)
        lines.push(`**Experience:** ${item.experienceLevels.join(', ')}`);
      if (item.themes?.length) lines.push(`**Themes:** ${item.themes.join(', ')}`);
      if (item.types?.length) lines.push(`**Type:** ${item.types.join(', ')}`);
      if (item.dateCreated) lines.push(`**Indexed:** ${item.dateCreated}`);
      if (item.dateClosing) lines.push(`**Closing:** ${item.dateClosing}`);
      if (item.urlAlias) lines.push(`**URL:** ${item.urlAlias}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});

/**
 * Render the resolved filter set as a single compact line. Every field is named so
 * the `format-parity` lint sees each output key reflected in `content[]`, keeping the
 * markdown surface in sync with `structuredContent` for content[]-only clients.
 */
function renderAppliedFilters(f: {
  text?: string | undefined;
  country?: string | undefined;
  source?: string | undefined;
  careerCategory?: string | undefined;
  theme?: string | undefined;
  experience?: string | undefined;
  sort: string;
  limit: number;
  offset: number;
}): string {
  const parts: string[] = [];
  if (f.text != null) parts.push(`text="${f.text}"`);
  if (f.country != null) parts.push(`country=${f.country}`);
  if (f.source != null) parts.push(`source="${f.source}"`);
  if (f.careerCategory != null) parts.push(`careerCategory="${f.careerCategory}"`);
  if (f.theme != null) parts.push(`theme="${f.theme}"`);
  if (f.experience != null) parts.push(`experience="${f.experience}"`);
  parts.push(`sort=${f.sort}`, `limit=${f.limit}`, `offset=${f.offset}`);
  return `**Applied filters:** ${parts.join(', ')}`;
}
