/**
 * @fileoverview Search ReliefWeb disasters by type, country, status, and GLIDE number.
 * @module mcp-server/tools/definitions/search-disasters
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const reliefwebSearchDisasters = tool('reliefweb_search_disasters', {
  title: 'Search ReliefWeb Disasters',
  description:
    'Search active and historical disasters on ReliefWeb by type, country, status, date range, and GLIDE number. ' +
    'Default preset covers alert, current, and past disasters. ' +
    'Use include_archived=true to include alert-archive and archive entries for historical research. ' +
    'Returns IDs suitable for use with reliefweb_get_disaster and as disaster_id filter in reliefweb_search_reports.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe('Full-text search query. Matches against disaster name and description.'),
    country: z
      .string()
      .optional()
      .describe(
        'ISO 3166-1 alpha-3 country code (e.g., SYR, AFG, UKR). Filters to disasters tagged with this primary country.',
      ),
    disaster_type: z
      .string()
      .optional()
      .describe(
        'Disaster type name (e.g., Earthquake, Flood, Drought, Cyclone). Filters on type.name.',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Disaster status filter. Values: alert (newly declared), current (ongoing), past (resolved), alert-archive, archive. Separate multiple values with commas. Default preset includes alert, current, past.',
      ),
    glide: z
      .string()
      .optional()
      .describe(
        'GLIDE number (global disaster identifier, e.g., EQ-2023-000053-TUR). Use for cross-system disaster correlation.',
      ),
    date_from: z
      .string()
      .optional()
      .describe('Earliest disaster creation date (ISO 8601). Filters on date.created.'),
    date_to: z
      .string()
      .optional()
      .describe('Latest disaster creation date (ISO 8601). Pair with date_from for a date range.'),
    sort: z
      .string()
      .optional()
      .describe(
        'Sort order. Use date.created:desc for newest first (default), date.created:asc for oldest, score:desc for relevance.',
      ),
    include_archived: z
      .boolean()
      .optional()
      .describe(
        'Include alert-archive and archive disasters in results. Uses preset=analysis. Off by default.',
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
            id: z.number().describe('ReliefWeb numeric disaster ID.'),
            name: z.string().describe('Disaster name.'),
            status: z
              .string()
              .optional()
              .describe('Disaster status (alert, current, past, archive).'),
            glide: z.string().optional().describe('GLIDE number for cross-system correlation.'),
            dateEvent: z.string().optional().describe('Event date (ISO 8601), when available.'),
            dateCreated: z.string().optional().describe('ReliefWeb index date (ISO 8601).'),
            primaryCountry: z.string().optional().describe('Primary affected country.'),
            countries: z
              .array(z.string())
              .optional()
              .describe('All countries tagged on this disaster.'),
            types: z.array(z.string()).optional().describe('Disaster type names.'),
            primaryType: z.string().optional().describe('Primary disaster type.'),
            urlAlias: z.string().optional().describe('Canonical ReliefWeb URL for this disaster.'),
          })
          .describe('A matching disaster record.'),
      )
      .describe('Matching disasters.'),
    appliedFilters: z
      .object({
        text: z.string().optional().describe('Full-text query the search used.'),
        country: z.string().optional().describe('Country code as normalized (uppercased ISO3).'),
        disasterType: z.string().optional().describe('Disaster type name filter applied.'),
        status: z
          .string()
          .optional()
          .describe('Status filter applied (comma-joined when multiple).'),
        glide: z.string().optional().describe('GLIDE number filter applied.'),
        dateFrom: z.string().optional().describe('Earliest creation date filter applied.'),
        dateTo: z.string().optional().describe('Latest creation date filter applied.'),
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
    totalCount: z.number().describe('Total disasters matching the query before pagination.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — echoes filters applied and suggests how to broaden.',
      ),
  },
  errors: [
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The ReliefWeb API returned an error response or was unreachable.',
      recovery:
        'Wait a moment and retry. ReliefWeb enforces a 1,000 calls/day quota — check whether the quota is exhausted before retrying.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_search_disasters', {
      text: input.text,
      country: input.country,
      disasterType: input.disaster_type,
      limit: input.limit,
    });

    const country = input.country?.trim() ? input.country.toUpperCase() : undefined;

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.disaster_type?.trim() ? { disasterType: input.disaster_type } : {}),
      ...(input.status?.trim() ? { status: input.status } : {}),
      ...(input.glide?.trim() ? { glide: input.glide } : {}),
      ...(input.date_from?.trim() ? { dateFrom: input.date_from } : {}),
      ...(input.date_to?.trim() ? { dateTo: input.date_to } : {}),
      sort: input.sort?.trim() || 'date.created:desc',
      preset: input.include_archived ? 'analysis' : 'latest',
      limit: input.limit,
      offset: input.offset,
    };

    const result = await getReliefWebService()
      .searchDisasters(
        {
          ...(input.text?.trim() ? { text: input.text } : {}),
          ...(country ? { country } : {}),
          ...(input.disaster_type?.trim() ? { disasterType: input.disaster_type } : {}),
          ...(input.status?.trim() ? { status: input.status } : {}),
          ...(input.glide?.trim() ? { glide: input.glide } : {}),
          ...(input.date_from?.trim() ? { dateFrom: input.date_from } : {}),
          ...(input.date_to?.trim() ? { dateTo: input.date_to } : {}),
          ...(input.sort?.trim() ? { sort: input.sort } : {}),
          ...(input.include_archived != null ? { includeArchived: input.include_archived } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        throw ctx.fail('upstream_error', 'ReliefWeb API error while searching disasters.', {
          cause: err,
          ...ctx.recoveryFor('upstream_error'),
        });
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (country) filters.push(`country=${country}`);
      if (input.disaster_type) filters.push(`type="${input.disaster_type}"`);
      if (input.status) filters.push(`status=${input.status}`);
      if (input.glide) filters.push(`glide=${input.glide}`);
      if (input.date_from) filters.push(`date_from=${input.date_from}`);
      if (input.date_to) filters.push(`date_to=${input.date_to}`);
      ctx.enrich.notice(
        `No disasters matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try removing filters, using different disaster type names, or setting include_archived=true for historical data.',
      );
    }

    return { items: result.items, appliedFilters };
  },

  format: (result) => {
    const lines: string[] = [renderAppliedFilters(result.appliedFilters)];
    for (const item of result.items) {
      lines.push(`\n## ${item.name}`);
      lines.push(`**ID:** ${item.id}`);
      if (item.status) lines.push(`**Status:** ${item.status}`);
      if (item.glide) lines.push(`**GLIDE:** ${item.glide}`);
      if (item.primaryType) lines.push(`**Type:** ${item.primaryType}`);
      if (item.types?.length) lines.push(`**Types:** ${item.types.join(', ')}`);
      if (item.dateEvent) lines.push(`**Event date:** ${item.dateEvent}`);
      if (item.dateCreated) lines.push(`**Indexed:** ${item.dateCreated}`);
      if (item.primaryCountry) lines.push(`**Primary country:** ${item.primaryCountry}`);
      if (item.countries?.length) lines.push(`**Countries:** ${item.countries.join(', ')}`);
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
  disasterType?: string | undefined;
  status?: string | undefined;
  glide?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  sort: string;
  preset: string;
  limit: number;
  offset: number;
}): string {
  const parts: string[] = [];
  if (f.text != null) parts.push(`text="${f.text}"`);
  if (f.country != null) parts.push(`country=${f.country}`);
  if (f.disasterType != null) parts.push(`disasterType="${f.disasterType}"`);
  if (f.status != null) parts.push(`status=${f.status}`);
  if (f.glide != null) parts.push(`glide=${f.glide}`);
  if (f.dateFrom != null) parts.push(`dateFrom=${f.dateFrom}`);
  if (f.dateTo != null) parts.push(`dateTo=${f.dateTo}`);
  parts.push(`sort=${f.sort}`, `preset=${f.preset}`, `limit=${f.limit}`, `offset=${f.offset}`);
  return `**Applied filters:** ${parts.join(', ')}`;
}
