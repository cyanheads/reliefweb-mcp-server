/**
 * @fileoverview Search humanitarian job listings on ReliefWeb.
 * @module mcp-server/tools/definitions/search-jobs
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { countryCodesInput, parseCountryCodes } from '@/mcp-server/tools/country-codes.js';
import { limitSchema, resolveLimit, SEARCH_MAX_LIMIT } from '@/mcp-server/tools/limits.js';
import { pagedPastEndNotice } from '@/mcp-server/tools/pagination.js';
import { renderPlainTextNotice } from '@/mcp-server/tools/plain-text-notice.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';
import {
  isRejectedQueryError,
  rejectedQueryMessage,
  upstreamErrorMessage,
} from '@/services/reliefweb/upstream-errors.js';
import {
  CAREER_CATEGORIES,
  CAREER_CATEGORY_MATCHING,
  JOB_TYPE_MATCHING,
  JOB_TYPES,
  resolveVocabulary,
  THEME_MATCHING,
  THEMES,
  unknownValueMessage,
} from '@/services/reliefweb/vocabularies.js';

export const reliefwebSearchJobs = tool('reliefweb_search_jobs', {
  title: 'Search ReliefWeb Jobs',
  description:
    'Search humanitarian job listings on ReliefWeb by country, organization, job type, career category, theme, and experience level. Returns current open positions — expired postings are excluded by default. Use include_archived=true to search the full history of postings, which is far larger than the open set. Use text search for role titles and job descriptions, and job_type for the kind of engagement (consultancy, internship) — text search finds only some of those.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe(
        'Full-text search query. Matches against job title, body, and key metadata fields.',
      ),
    country: countryCodesInput('jobs'),
    source: z
      .string()
      .optional()
      .describe('Organization short name (e.g., UNHCR, OCHA, WFP). Filters on source.shortname.'),
    job_type: z
      .string()
      .optional()
      .describe(
        `Kind of engagement. One of: ${JOB_TYPES.join(', ')}. A word found in only one type name also resolves (Tender, Volunteer). Separate several types with commas to match any of them — a posting carries one type. Case, spacing, and punctuation are ignored; any other value is rejected with the valid list. Filters on type.name.`,
      ),
    career_category: z
      .string()
      .optional()
      .describe(
        `ReliefWeb career category. One of: ${CAREER_CATEGORIES.join(', ')}. Also accepts the abbreviations ${Object.keys(CAREER_CATEGORY_MATCHING.aliases).join(', ')}, and a word found in only one category name (Logistics resolves to Logistics/Procurement). Separate several categories with commas to require all of them. Case, spacing, and punctuation are ignored; any other value is rejected with the valid list. Matches whole career-category tags.`,
      ),
    theme: z
      .string()
      .optional()
      .describe(
        `Sector or cross-cutting theme. One of: ${THEMES.join(', ')}. Also accepts the abbreviations ${Object.keys(THEME_MATCHING.aliases).join(', ')}, and a word found in only one theme name (Protection resolves to Protection and Human Rights). Separate several themes with commas to require all of them. Case, spacing, and punctuation are ignored; any other value is rejected with the valid list. Matches whole theme tags.`,
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
            countryIso3s: z
              .array(z.string())
              .optional()
              .describe(
                'Uppercase ISO3 codes of the countries tagged on this job — the form the country filters and reliefweb_get_country take.',
              ),
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
        country: z
          .string()
          .optional()
          .describe('Country codes as normalized: uppercased ISO3, comma-separated when several.'),
        source: z.string().optional().describe('Source short name filter applied.'),
        jobType: z
          .string()
          .optional()
          .describe(
            'Job type names applied, in canonical ReliefWeb spelling and comma-separated when several (a posting of any of them matches).',
          ),
        careerCategory: z
          .string()
          .optional()
          .describe(
            'Career category names applied, in canonical ReliefWeb spelling and comma-separated when several (postings must carry every one).',
          ),
        theme: z
          .string()
          .optional()
          .describe(
            'Theme names applied, in canonical ReliefWeb spelling and comma-separated when several (postings must carry every one).',
          ),
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
      reason: 'unknown_job_type',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A job_type value names no ReliefWeb job type.',
      recovery:
        'Use a job type from the list in the error message, or one word of it such as Tender or Volunteer. Separate several types with commas to match any of them.',
    },
    {
      reason: 'unknown_career_category',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A career_category value names no single ReliefWeb career category — an unknown name, a word shared by several category names, or words from more than one.',
      recovery:
        'Use a career category from the list in the error message, or ICT, M&E, or HR; a single word works only when it appears in one category name, such as Logistics. Separate several categories with commas to require all of them.',
    },
    {
      reason: 'unknown_theme',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A theme value names no single ReliefWeb theme — an unknown name, a word shared by several theme names, or words from more than one.',
      recovery:
        'Use a theme name from the list in the error message, or WASH, CCCM, or NFI; a single word works only when it appears in one theme name, such as Protection. Separate several themes with commas to require all of them.',
    },
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

    const countryCodes = parseCountryCodes(input.country);
    const country = countryCodes?.join(',');
    const jobType = resolveVocabulary(input.job_type, JOB_TYPES, JOB_TYPE_MATCHING);
    if (jobType.unmatched.length > 0) {
      throw ctx.fail(
        'unknown_job_type',
        unknownValueMessage('job_type', jobType.unmatched, JOB_TYPES, JOB_TYPE_MATCHING),
      );
    }
    const careerCategory = resolveVocabulary(
      input.career_category,
      CAREER_CATEGORIES,
      CAREER_CATEGORY_MATCHING,
    );
    if (careerCategory.unmatched.length > 0) {
      throw ctx.fail(
        'unknown_career_category',
        unknownValueMessage(
          'career_category',
          careerCategory.unmatched,
          CAREER_CATEGORIES,
          CAREER_CATEGORY_MATCHING,
        ),
      );
    }
    const theme = resolveVocabulary(input.theme, THEMES, THEME_MATCHING);
    if (theme.unmatched.length > 0) {
      throw ctx.fail(
        'unknown_theme',
        unknownValueMessage('theme', theme.unmatched, THEMES, THEME_MATCHING),
      );
    }

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.source?.trim() ? { source: input.source } : {}),
      ...(jobType.value ? { jobType: jobType.value } : {}),
      ...(careerCategory.value ? { careerCategory: careerCategory.value } : {}),
      ...(theme.value ? { theme: theme.value } : {}),
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
          ...(countryCodes ? { country: countryCodes } : {}),
          ...(input.source?.trim() ? { source: input.source } : {}),
          ...(jobType.value ? { jobType: jobType.value } : {}),
          ...(careerCategory.value ? { careerCategory: careerCategory.value } : {}),
          ...(theme.value ? { theme: theme.value } : {}),
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
      if (jobType.value) filters.push(`job_type="${jobType.value}"`);
      if (careerCategory.value) filters.push(`career_category="${careerCategory.value}"`);
      if (theme.value) filters.push(`theme="${theme.value}"`);
      if (input.experience) filters.push(`experience="${input.experience}"`);
      notice(
        `No jobs matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. Try broader keywords, remove the country, job_type, career_category, or theme filter, or set include_archived=true to search expired postings as well.`,
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
      if (item.countryIso3s?.length)
        lines.push(`**Country ISO3 codes:** ${escapeMarkdownInline(item.countryIso3s.join(', '))}`);
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
  jobType?: string | undefined;
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
  if (f.jobType != null) parts.push(`jobType=${escapeMarkdownInline(f.jobType)}`);
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
