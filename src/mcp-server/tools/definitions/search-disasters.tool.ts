/**
 * @fileoverview Search ReliefWeb disasters by type, country, status, and GLIDE number.
 * @module mcp-server/tools/definitions/search-disasters
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
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
        'Zero-based offset for pagination. Use with limit and totalCount to page through results.',
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
    totalCount: z.number().describe('Total disasters matching the query before pagination.'),
    message: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — echoes filters applied and suggests how to broaden.',
      ),
  }),
  async handler(input, ctx) {
    ctx.log.info('reliefweb_search_disasters', {
      text: input.text,
      country: input.country,
      disasterType: input.disaster_type,
      limit: input.limit,
    });

    const result = await getReliefWebService().searchDisasters(
      {
        ...(input.text?.trim() ? { text: input.text } : {}),
        ...(input.country?.trim() ? { country: input.country.toUpperCase() } : {}),
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
    );

    if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (input.country) filters.push(`country=${input.country}`);
      if (input.disaster_type) filters.push(`type="${input.disaster_type}"`);
      if (input.status) filters.push(`status=${input.status}`);
      return {
        items: [],
        totalCount: 0,
        message:
          `No disasters matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try removing filters, using different disaster type names, or setting include_archived=true for historical data.',
      };
    }

    return { items: result.items, totalCount: result.totalCount };
  },

  format: (result) => {
    const lines: string[] = [`**Total:** ${result.totalCount} disasters`];
    if (result.message) lines.push(`\n> ${result.message}`);
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
