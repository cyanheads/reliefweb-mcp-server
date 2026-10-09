/**
 * @fileoverview Search humanitarian reports on ReliefWeb with rich filtering.
 * @module mcp-server/tools/definitions/search-reports
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { pagedPastEndNotice } from '@/mcp-server/tools/pagination.js';
import {
  DATE_BOUND_FORMAT_MESSAGE,
  DATE_BOUND_PATTERN,
  resolveDateBound,
} from '@/services/reliefweb/date-utils.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';
import type { FilterCondition } from '@/services/reliefweb/types.js';
import {
  isRejectedQueryError,
  rejectedQueryMessage,
  upstreamErrorMessage,
} from '@/services/reliefweb/upstream-errors.js';
import {
  REPORT_FORMATS,
  resolveVocabulary,
  unknownValueMessage,
} from '@/services/reliefweb/vocabularies.js';

export const reliefwebSearchReports = tool('reliefweb_search_reports', {
  title: 'Search ReliefWeb Reports',
  description:
    'Search humanitarian reports on ReliefWeb with filtering by country, disaster, format, theme, language, source, and date. ' +
    'Returns paginated summaries — use reliefweb_get_report to fetch full body text. ' +
    'Report body is excluded from results (10–100KB each); call get_report when document content is needed. ' +
    'Every report is reachable by default — reports have no archived class, so include_archived has no effect here. ' +
    'Note: each call counts against the 1,000 calls/day quota.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe(
        'Full-text search query. Matches against title, body, and key metadata fields. Use plain natural language or keywords.',
      ),
    country: z
      .string()
      .optional()
      .describe(
        'ISO 3166-1 alpha-3 country code (e.g., SYR, AFG, UKR). Filters to content tagged with this country.',
      ),
    disaster_id: z
      .number()
      .int()
      .optional()
      .describe(
        'ReliefWeb numeric disaster ID. Filters to reports linked to a specific disaster. Get the ID from reliefweb_search_disasters.',
      ),
    format: z
      .string()
      .optional()
      .describe(
        `Content format filter. One of: ${REPORT_FORMATS.join(', ')}. Case, spacing, and punctuation are ignored; any other value is rejected with the valid list.`,
      ),
    theme: z
      .string()
      .optional()
      .describe(
        'Sector or cross-cutting theme (e.g., Health, Food and Nutrition, Shelter and Non-Food Items, Protection). Open-ended — matches theme.name exactly as ReliefWeb spells it.',
      ),
    language: z
      .string()
      .optional()
      .describe('ISO 639-1 language code (e.g., en, fr, es, ar). Filters on language.code.'),
    source: z
      .string()
      .optional()
      .describe('Organization short name (e.g., UNHCR, OCHA, WFP). Filters on source.shortname.'),
    date_from: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(DATE_BOUND_PATTERN, DATE_BOUND_FORMAT_MESSAGE)
          .describe(
            'Calendar date (2024-01-15) or full ISO 8601 datetime (2024-01-15T00:00:00+00:00).',
          ),
      ])
      .optional()
      .describe(
        'Earliest publication date. Filters on date.original (source publication date). A bare calendar date such as 2024-01-15 is accepted and resolves to start of that day in UTC; a datetime carrying any offset is resolved to UTC.',
      ),
    date_to: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(DATE_BOUND_PATTERN, DATE_BOUND_FORMAT_MESSAGE)
          .describe(
            'Calendar date (2024-01-31) or full ISO 8601 datetime (2024-01-31T23:59:59+00:00).',
          ),
      ])
      .optional()
      .describe(
        'Latest publication date. Pair with date_from for a date range. A bare calendar date resolves to end of that day in UTC, so the range covers it in full; a datetime carrying any offset is resolved to UTC.',
      ),
    sort: z
      .string()
      .optional()
      .describe(
        'Sort order. Use date.original:desc for newest first (default), date.original:asc for oldest first, score:desc for relevance.',
      ),
    include_archived: z
      .boolean()
      .optional()
      .describe(
        'No effect on reports. Reports have no archived class — every report is already in scope, whatever this is set to. Kept so existing calls that pass it keep working; it is meaningful on reliefweb_search_jobs, reliefweb_search_training, and reliefweb_search_disasters.',
      ),
    filter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Raw ReliefWeb filter object for compound conditions not covered by named params. Example: {"operator": "AND", "conditions": [{"field": "format.name", "value": "Map"}, {"field": "language.code", "value": "fr"}]}.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(10)
      .describe(
        'Number of results to return (1–1000, default 10). Use a smaller value for targeted lookups; larger for bulk research. Each call counts against the 1,000-calls/day quota.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset for pagination. Use with limit and the totalCount enrichment field to page through large result sets.',
      ),
  }),
  output: z.object({
    items: z
      .array(
        z
          .object({
            id: z.number().describe('ReliefWeb numeric report ID.'),
            title: z.string().describe('Report title.'),
            dateOriginal: z.string().optional().describe('Source publication date (ISO 8601).'),
            dateCreated: z.string().optional().describe('ReliefWeb index date (ISO 8601).'),
            primaryCountry: z.string().optional().describe('Primary country name for this report.'),
            countries: z
              .array(z.string())
              .optional()
              .describe('All countries tagged on this report.'),
            sources: z
              .array(z.string())
              .optional()
              .describe('Publishing organizations (short names).'),
            formats: z.array(z.string()).optional().describe('Content format names.'),
            themes: z.array(z.string()).optional().describe('Humanitarian theme/sector names.'),
            languages: z.array(z.string()).optional().describe('Language codes (ISO 639-1).'),
            urlAlias: z.string().optional().describe('Canonical ReliefWeb URL for this report.'),
            fileUrls: z
              .array(z.string())
              .optional()
              .describe('Direct file download URLs attached to this report.'),
            headlineSummary: z
              .string()
              .optional()
              .describe('Short editorial summary from the headline block, when present.'),
          })
          .describe('A matching report summary.'),
      )
      .describe('Matching reports (summaries only — use reliefweb_get_report for full body).'),
    appliedFilters: z
      .object({
        text: z.string().optional().describe('Full-text query the search used.'),
        country: z.string().optional().describe('Country code as normalized (uppercased ISO3).'),
        disasterId: z.number().optional().describe('Disaster ID filter applied.'),
        format: z
          .string()
          .optional()
          .describe('Format name filter applied, in its canonical ReliefWeb spelling.'),
        theme: z.string().optional().describe('Theme name filter applied.'),
        language: z.string().optional().describe('Language code filter applied.'),
        source: z.string().optional().describe('Source short name filter applied.'),
        dateFrom: z.string().optional().describe('Earliest publication date filter applied.'),
        dateTo: z.string().optional().describe('Latest publication date filter applied.'),
        rawFilter: z
          .boolean()
          .optional()
          .describe('True when a raw compound filter object was merged into the query.'),
        sort: z.string().describe('Sort order the query used (resolved, including the default).'),
        preset: z
          .string()
          .describe(
            'ReliefWeb preset the query used. Always latest for reports — no preset changes which reports match.',
          ),
        limit: z.number().describe('Result limit the query used.'),
        offset: z.number().describe('Pagination offset the query used.'),
      })
      .describe(
        'The resolved filter set the query actually ran with, after normalization and defaults. Echoes back so the agent can confirm how its inputs were interpreted.',
      ),
  }),
  enrichment: {
    totalCount: z.number().describe('Total reports matching the query before pagination.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Present only when the page is empty. Names the match count and the last reachable offset when the query matched records; otherwise echoes the filters applied and suggests how to broaden.',
      ),
  },
  errors: [
    {
      reason: 'unknown_format',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The format value does not name a ReliefWeb report format.',
      recovery:
        'Use one of the format names listed in the error message; case, spacing, and punctuation do not matter, but the name itself must match.',
    },
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'ReliefWeb rejected the query — an unrecognized sort field, an invalid raw filter object, or a malformed date.',
      recovery:
        'Correct the value named in the error message and call again; an unchanged retry is rejected identically. Sort and filter fields must be real ReliefWeb field names, and dates take a calendar date or a full ISO 8601 datetime.',
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
    ctx.log.info('reliefweb_search_reports', {
      text: input.text,
      country: input.country,
      limit: input.limit,
    });

    const country = input.country?.trim() ? input.country.toUpperCase() : undefined;
    const dateFrom = resolveDateBound(input.date_from, 'from');
    const dateTo = resolveDateBound(input.date_to, 'to');

    const format = resolveVocabulary(input.format, REPORT_FORMATS);
    if (format.unmatched.length > 0) {
      throw ctx.fail(
        'unknown_format',
        unknownValueMessage('format', format.unmatched, REPORT_FORMATS),
      );
    }

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.disaster_id != null ? { disasterId: input.disaster_id } : {}),
      ...(format.value ? { format: format.value } : {}),
      ...(input.theme?.trim() ? { theme: input.theme } : {}),
      ...(input.language?.trim() ? { language: input.language } : {}),
      ...(input.source?.trim() ? { source: input.source } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(input.filter != null ? { rawFilter: true } : {}),
      sort: input.sort?.trim() || 'date.original:desc',
      /**
       * Every preset returns the identical report set — the corpus carries no archived
       * class — so the echo names the one preset the query runs under rather than flipping
       * on `include_archived` and implying a coverage difference that does not exist.
       */
      preset: 'latest',
      limit: input.limit,
      offset: input.offset,
    };

    const result = await getReliefWebService()
      .searchReports(
        {
          ...(input.text?.trim() ? { text: input.text } : {}),
          ...(country ? { country } : {}),
          ...(input.disaster_id != null ? { disasterId: input.disaster_id } : {}),
          ...(format.value ? { format: format.value } : {}),
          ...(input.theme?.trim() ? { theme: input.theme } : {}),
          ...(input.language?.trim() ? { language: input.language } : {}),
          ...(input.source?.trim() ? { source: input.source } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
          ...(input.sort?.trim() ? { sort: input.sort } : {}),
          ...(input.filter != null ? { rawFilter: input.filter as FilterCondition } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        if (isRejectedQueryError(err)) {
          throw ctx.fail('invalid_query', rejectedQueryMessage('reports', err), undefined, {
            cause: err,
          });
        }
        throw ctx.fail(
          'upstream_error',
          upstreamErrorMessage('ReliefWeb API error while searching reports.', err),
          undefined,
          { cause: err },
        );
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0 && result.totalCount > 0) {
      ctx.enrich.notice(
        pagedPastEndNotice({
          subject: 'reports',
          offset: input.offset,
          totalCount: result.totalCount,
          limit: input.limit,
        }),
      );
    } else if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (country) filters.push(`country=${country}`);
      if (input.disaster_id != null) filters.push(`disaster_id=${input.disaster_id}`);
      if (format.value) filters.push(`format="${format.value}"`);
      if (input.theme) filters.push(`theme="${input.theme}"`);
      if (input.language) filters.push(`language=${input.language}`);
      if (input.source) filters.push(`source="${input.source}"`);
      if (dateFrom) filters.push(`date_from=${dateFrom}`);
      if (dateTo) filters.push(`date_to=${dateTo}`);
      ctx.enrich.notice(
        `No reports matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try broadening the search by removing filters, using different keywords, or checking country codes.',
      );
    }

    return { items: result.items, appliedFilters };
  },

  format: (result) => {
    const lines: string[] = [renderAppliedFilters(result.appliedFilters)];
    for (const item of result.items) {
      lines.push(`\n## ${item.title}`);
      lines.push(`**ID:** ${item.id}`);
      if (item.dateOriginal) lines.push(`**Published:** ${item.dateOriginal}`);
      if (item.dateCreated) lines.push(`**Indexed:** ${item.dateCreated}`);
      if (item.primaryCountry) lines.push(`**Primary country:** ${item.primaryCountry}`);
      if (item.countries?.length) lines.push(`**Countries:** ${item.countries.join(', ')}`);
      if (item.sources?.length) lines.push(`**Sources:** ${item.sources.join(', ')}`);
      if (item.formats?.length) lines.push(`**Format:** ${item.formats.join(', ')}`);
      if (item.themes?.length) lines.push(`**Themes:** ${item.themes.join(', ')}`);
      if (item.languages?.length) lines.push(`**Languages:** ${item.languages.join(', ')}`);
      if (item.headlineSummary) lines.push(`\n${item.headlineSummary}`);
      if (item.urlAlias) lines.push(`**URL:** ${item.urlAlias}`);
      if (item.fileUrls?.length) lines.push(`**Files:** ${item.fileUrls.join(', ')}`);
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
  disasterId?: number | undefined;
  format?: string | undefined;
  theme?: string | undefined;
  language?: string | undefined;
  source?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  rawFilter?: boolean | undefined;
  sort: string;
  preset: string;
  limit: number;
  offset: number;
}): string {
  const parts: string[] = [];
  if (f.text != null) parts.push(`text="${f.text}"`);
  if (f.country != null) parts.push(`country=${f.country}`);
  if (f.disasterId != null) parts.push(`disasterId=${f.disasterId}`);
  if (f.format != null) parts.push(`format="${f.format}"`);
  if (f.theme != null) parts.push(`theme="${f.theme}"`);
  if (f.language != null) parts.push(`language=${f.language}`);
  if (f.source != null) parts.push(`source="${f.source}"`);
  if (f.dateFrom != null) parts.push(`dateFrom=${f.dateFrom}`);
  if (f.dateTo != null) parts.push(`dateTo=${f.dateTo}`);
  if (f.rawFilter != null) parts.push(`rawFilter=${f.rawFilter}`);
  parts.push(`sort=${f.sort}`, `preset=${f.preset}`, `limit=${f.limit}`, `offset=${f.offset}`);
  return `**Applied filters:** ${parts.join(', ')}`;
}
