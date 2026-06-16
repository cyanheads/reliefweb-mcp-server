/**
 * @fileoverview Search humanitarian reports on ReliefWeb with rich filtering.
 * @module mcp-server/tools/definitions/search-reports
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';
import type { FilterCondition } from '@/services/reliefweb/types.js';

export const reliefwebSearchReports = tool('reliefweb_search_reports', {
  title: 'Search ReliefWeb Reports',
  description:
    'Search humanitarian reports on ReliefWeb with filtering by country, disaster, format, theme, language, source, and date. ' +
    'Returns paginated summaries — use reliefweb_get_report to fetch full body text. ' +
    'Report body is excluded from results (10–100KB each); call get_report when document content is needed. ' +
    'Use preset include_archived=true to include expired or archived reports in historical research. ' +
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
        'Content format filter. Valid values: Situation Report, Assessment, Analysis, Map, Infographic, Manual and Guideline, News and Press Release, Policy Document, Appeal, Financial Report, Evaluation and Lessons Learned, Other.',
      ),
    theme: z
      .string()
      .optional()
      .describe(
        'Sector or cross-cutting theme (e.g., Health, Food and Nutrition, Shelter and NFI, Protection). Matches theme.name.',
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
      .string()
      .optional()
      .describe(
        'Earliest publication date (ISO 8601, e.g., 2024-01-15T00:00:00+00:00). Filters on date.original (source publication date).',
      ),
    date_to: z
      .string()
      .optional()
      .describe('Latest publication date (ISO 8601). Pair with date_from for a date range.'),
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
        'Include archived and to-review content in addition to published. Uses preset=analysis. Off by default.',
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
        format: z.string().optional().describe('Format name filter applied.'),
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
            'ReliefWeb preset the query used: latest (default) or analysis when include_archived.',
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
        'Recovery hint when results are empty — echoes the filters applied and suggests how to broaden. Absent on successful result pages.',
      ),
  },
  errors: [
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The ReliefWeb API returned an error response or was unreachable.',
      recovery:
        'Wait a moment and retry. ReliefWeb enforces a 1,000 calls/day quota — check whether the quota is exhausted, and verify any raw filter object is well-formed.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_search_reports', {
      text: input.text,
      country: input.country,
      limit: input.limit,
    });

    const country = input.country?.trim() ? input.country.toUpperCase() : undefined;

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.disaster_id != null ? { disasterId: input.disaster_id } : {}),
      ...(input.format?.trim() ? { format: input.format } : {}),
      ...(input.theme?.trim() ? { theme: input.theme } : {}),
      ...(input.language?.trim() ? { language: input.language } : {}),
      ...(input.source?.trim() ? { source: input.source } : {}),
      ...(input.date_from?.trim() ? { dateFrom: input.date_from } : {}),
      ...(input.date_to?.trim() ? { dateTo: input.date_to } : {}),
      ...(input.filter != null ? { rawFilter: true } : {}),
      sort: input.sort?.trim() || 'date.original:desc',
      preset: input.include_archived ? 'analysis' : 'latest',
      limit: input.limit,
      offset: input.offset,
    };

    const result = await getReliefWebService()
      .searchReports(
        {
          ...(input.text?.trim() ? { text: input.text } : {}),
          ...(country ? { country } : {}),
          ...(input.disaster_id != null ? { disasterId: input.disaster_id } : {}),
          ...(input.format?.trim() ? { format: input.format } : {}),
          ...(input.theme?.trim() ? { theme: input.theme } : {}),
          ...(input.language?.trim() ? { language: input.language } : {}),
          ...(input.source?.trim() ? { source: input.source } : {}),
          ...(input.date_from?.trim() ? { dateFrom: input.date_from } : {}),
          ...(input.date_to?.trim() ? { dateTo: input.date_to } : {}),
          ...(input.sort?.trim() ? { sort: input.sort } : {}),
          ...(input.include_archived != null ? { includeArchived: input.include_archived } : {}),
          ...(input.filter != null ? { rawFilter: input.filter as FilterCondition } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        throw ctx.fail('upstream_error', 'ReliefWeb API error while searching reports.', {
          cause: err,
          ...ctx.recoveryFor('upstream_error'),
        });
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (country) filters.push(`country=${country}`);
      if (input.disaster_id != null) filters.push(`disaster_id=${input.disaster_id}`);
      if (input.format) filters.push(`format="${input.format}"`);
      if (input.theme) filters.push(`theme="${input.theme}"`);
      if (input.language) filters.push(`language=${input.language}`);
      if (input.source) filters.push(`source="${input.source}"`);
      if (input.date_from) filters.push(`date_from=${input.date_from}`);
      if (input.date_to) filters.push(`date_to=${input.date_to}`);
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
