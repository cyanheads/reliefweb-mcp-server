/**
 * @fileoverview Search humanitarian job listings on ReliefWeb.
 * @module mcp-server/tools/definitions/search-jobs
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { limitSchema, resolveLimit, SEARCH_MAX_LIMIT } from '@/mcp-server/tools/limits.js';
import { pagedPastEndNotice } from '@/mcp-server/tools/pagination.js';
import { renderPlainTextNotice } from '@/mcp-server/tools/plain-text-notice.js';
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
    'Returns current open positions — expired postings are excluded by default. ' +
    'Use include_archived=true to search the full history of postings, which is far larger than the open set. ' +
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
        'ReliefWeb career-category name (e.g., Program/Project Management, Information and Communications Technology, Logistics/Procurement). Filters on career_categories.name.',
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
    include_archived: z
      .boolean()
      .optional()
      .describe(
        'Search expired postings alongside the open ones. Uses preset=analysis. Off by default — the open set is a small fraction of the archive, so turn this on for labour-market history rather than for a hiring snapshot.',
      ),
    limit: limitSchema(SEARCH_MAX_LIMIT)
      .default(10)
      .describe(
        'Number of results to return (1–1000, default 10). Larger integers are clamped to 1000 with a notice when clamping is enabled; otherwise they are rejected. Each call counts against the 1,000-calls/day quota.',
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
        preset: z
          .string()
          .describe(
            'ReliefWeb preset the query used: latest (open postings only, default) or analysis when include_archived.',
          ),
        limit: z.number().describe('Result limit the query used.'),
        offset: z.number().describe('Pagination offset the query used.'),
      })
      .describe(
        'The resolved filter set the query actually ran with, after normalization and defaults. Echoes back so the agent can confirm how its inputs were interpreted.',
      ),
  }),
  enrichmentTrailer: { notice: { render: renderPlainTextNotice } },
  enrichment: {
    totalCount: z.number().describe('Total jobs matching the query before pagination.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Discloses requested and applied limits when clamped. For empty pages, names the match count and last reachable offset when records matched; otherwise echoes filters and suggests how to broaden.',
      ),
  },
  errors: [
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'ReliefWeb rejected the query — possible causes include malformed text or an unrecognized sort field.',
      recovery:
        'Correct the value named in the error message and call again; an unchanged retry is rejected identically. Sort fields must be real ReliefWeb field names such as date.created or date.closing. Malformed text is another possible cause: use plain keywords, balanced parentheses, and complete boolean expressions in text.',
    },
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The ReliefWeb API was unreachable, timed out, or returned a server error.',
      recovery:
        'Wait a moment and retry. If the message names a configuration or quota problem — an unapproved appname, or the 1,000 calls/day limit — that must be resolved before any retry can succeed.',
    },
  ],

  async handler(requestedInput, ctx) {
    const { limit, notice } = resolveLimit(
      requestedInput.limit,
      SEARCH_MAX_LIMIT,
      'reliefweb_search_jobs',
      ctx,
    );
    const input = { ...requestedInput, limit };
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
      preset: input.include_archived ? 'analysis' : 'latest',
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
          ...(input.include_archived != null ? { includeArchived: input.include_archived } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        if (isRejectedQueryError(err)) {
          throw ctx.fail('invalid_query', rejectedQueryMessage('jobs', err), undefined, {
            cause: err,
          });
        }
        throw ctx.fail(
          'upstream_error',
          upstreamErrorMessage('ReliefWeb API error while searching jobs.', err),
          undefined,
          { cause: err },
        );
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0 && result.totalCount > 0) {
      notice(
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
      notice(
        `No jobs matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try broader keywords, remove the country filter, check the career category spelling, ' +
          'or set include_archived=true to search expired postings as well.',
      );
    }

    return { items: result.items, appliedFilters };
  },

  format: (result) => {
    const lines: string[] = [renderAppliedFilters(result.appliedFilters)];
    for (const item of result.items) {
      lines.push(`\n**${escapeMarkdownInline(item.title)}**`);
      lines.push(`**ID:** ${item.id}`);
      if (item.sources?.length)
        lines.push(`**Organization:** ${escapeMarkdownInline(item.sources.join(', '))}`);
      if (item.countries?.length)
        lines.push(`**Countries:** ${escapeMarkdownInline(item.countries.join(', '))}`);
      if (item.careerCategories?.length)
        lines.push(
          `**Career category:** ${escapeMarkdownInline(item.careerCategories.join(', '))}`,
        );
      if (item.experienceLevels?.length)
        lines.push(`**Experience:** ${escapeMarkdownInline(item.experienceLevels.join(', '))}`);
      if (item.themes?.length)
        lines.push(`**Themes:** ${escapeMarkdownInline(item.themes.join(', '))}`);
      if (item.types?.length)
        lines.push(`**Type:** ${escapeMarkdownInline(item.types.join(', '))}`);
      if (item.dateCreated) lines.push(`**Indexed:** ${escapeMarkdownInline(item.dateCreated)}`);
      if (item.dateClosing) lines.push(`**Closing:** ${escapeMarkdownInline(item.dateClosing)}`);
      if (item.urlAlias) lines.push(`**URL:** ${markdownLink(item.urlAlias, item.urlAlias)}`);
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
  preset: string;
  limit: number;
  offset: number;
}): string {
  const parts: string[] = [];
  if (f.text != null) parts.push(`text="${escapeMarkdownInline(f.text)}"`);
  if (f.country != null) parts.push(`country=${escapeMarkdownInline(f.country)}`);
  if (f.source != null) parts.push(`source="${escapeMarkdownInline(f.source)}"`);
  if (f.careerCategory != null)
    parts.push(`careerCategory="${escapeMarkdownInline(f.careerCategory)}"`);
  if (f.theme != null) parts.push(`theme="${escapeMarkdownInline(f.theme)}"`);
  if (f.experience != null) parts.push(`experience="${escapeMarkdownInline(f.experience)}"`);
  parts.push(
    `sort=${escapeMarkdownInline(f.sort)}`,
    `preset=${f.preset}`,
    `limit=${f.limit}`,
    `offset=${f.offset}`,
  );
  return `**Applied filters:** ${parts.join(', ')}`;
}
