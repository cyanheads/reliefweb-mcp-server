/**
 * @fileoverview Search humanitarian training and learning opportunities on ReliefWeb.
 * @module mcp-server/tools/definitions/search-training
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const reliefwebSearchTraining = tool('reliefweb_search_training', {
  title: 'Search ReliefWeb Training',
  description:
    'Search humanitarian training and learning opportunities on ReliefWeb by country, format, date, source, career category, and language. ' +
    'Covers workshops, e-learning, conferences, and other capacity-building events. ' +
    'Training date fields use date.start / date.end — different from report date fields. ' +
    'Use date_start_from and date_start_to to find upcoming training within a window.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe('Full-text search query. Matches against training title and description.'),
    country: z
      .string()
      .optional()
      .describe(
        'ISO 3166-1 alpha-3 country code (e.g., KEN, ETH, COD). Filters to training tagged with this country.',
      ),
    source: z.string().optional().describe('Organization short name. Filters on source.shortname.'),
    format: z
      .string()
      .optional()
      .describe(
        'Training format (e.g., Workshop, E-learning, Conference, Seminar). Filters on format.name.',
      ),
    career_category: z
      .string()
      .optional()
      .describe(
        'Humanitarian career track (e.g., Programme and Project Management, Information and Communications Technology). Filters on career_categories.name.',
      ),
    language: z
      .string()
      .optional()
      .describe('ISO 639-1 language code (e.g., en, fr, es). Filters on language.code.'),
    date_start_from: z
      .string()
      .optional()
      .describe(
        'Training start date lower bound (ISO 8601). Filters on date.start — use to find training starting after a given date.',
      ),
    date_start_to: z
      .string()
      .optional()
      .describe(
        'Training start date upper bound (ISO 8601). Filters on date.start — pair with date_start_from for a window.',
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
            id: z.number().describe('ReliefWeb numeric training ID.'),
            title: z.string().describe('Training title.'),
            dateStart: z.string().optional().describe('Training start date (ISO 8601).'),
            dateEnd: z.string().optional().describe('Training end date (ISO 8601).'),
            dateRegistration: z.string().optional().describe('Registration deadline (ISO 8601).'),
            sources: z
              .array(z.string())
              .optional()
              .describe('Organizing organizations (short names).'),
            countries: z
              .array(z.string())
              .optional()
              .describe('Countries tagged on this training.'),
            themes: z.array(z.string()).optional().describe('Humanitarian theme/sector names.'),
            formats: z.array(z.string()).optional().describe('Training format names.'),
            languages: z.array(z.string()).optional().describe('Language codes (ISO 639-1).'),
            careerCategories: z
              .array(z.string())
              .optional()
              .describe('Career category names (humanitarian tracks).'),
            urlAlias: z
              .string()
              .optional()
              .describe('Canonical ReliefWeb URL for this training listing.'),
          })
          .describe('A matching training opportunity.'),
      )
      .describe('Matching training opportunities.'),
    appliedFilters: z
      .object({
        text: z.string().optional().describe('Full-text query the search used.'),
        country: z.string().optional().describe('Country code as normalized (uppercased ISO3).'),
        source: z.string().optional().describe('Source short name filter applied.'),
        format: z.string().optional().describe('Training format name filter applied.'),
        careerCategory: z.string().optional().describe('Career category name filter applied.'),
        language: z.string().optional().describe('Language code filter applied.'),
        dateStartFrom: z.string().optional().describe('Training start date lower bound applied.'),
        dateStartTo: z.string().optional().describe('Training start date upper bound applied.'),
        sort: z.string().describe('Sort order the query used (resolved, including the default).'),
        limit: z.number().describe('Result limit the query used.'),
        offset: z.number().describe('Pagination offset the query used.'),
      })
      .describe(
        'The resolved filter set the query actually ran with, after normalization and defaults. Echoes back so the agent can confirm how its inputs were interpreted.',
      ),
  }),
  enrichment: {
    totalCount: z
      .number()
      .describe('Total training listings matching the query before pagination.'),
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
    ctx.log.info('reliefweb_search_training', {
      text: input.text,
      country: input.country,
      format: input.format,
      limit: input.limit,
    });

    const country = input.country?.trim() ? input.country.toUpperCase() : undefined;

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.source?.trim() ? { source: input.source } : {}),
      ...(input.format?.trim() ? { format: input.format } : {}),
      ...(input.career_category?.trim() ? { careerCategory: input.career_category } : {}),
      ...(input.language?.trim() ? { language: input.language } : {}),
      ...(input.date_start_from?.trim() ? { dateStartFrom: input.date_start_from } : {}),
      ...(input.date_start_to?.trim() ? { dateStartTo: input.date_start_to } : {}),
      sort: 'date.created:desc',
      limit: input.limit,
      offset: input.offset,
    };

    const result = await getReliefWebService()
      .searchTraining(
        {
          ...(input.text?.trim() ? { text: input.text } : {}),
          ...(country ? { country } : {}),
          ...(input.source?.trim() ? { source: input.source } : {}),
          ...(input.format?.trim() ? { format: input.format } : {}),
          ...(input.career_category?.trim() ? { careerCategory: input.career_category } : {}),
          ...(input.language?.trim() ? { language: input.language } : {}),
          ...(input.date_start_from?.trim() ? { dateStartFrom: input.date_start_from } : {}),
          ...(input.date_start_to?.trim() ? { dateStartTo: input.date_start_to } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        throw ctx.fail('upstream_error', 'ReliefWeb API error while searching training.', {
          cause: err,
          ...ctx.recoveryFor('upstream_error'),
        });
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (country) filters.push(`country=${country}`);
      if (input.source) filters.push(`source="${input.source}"`);
      if (input.format) filters.push(`format="${input.format}"`);
      if (input.career_category) filters.push(`career_category="${input.career_category}"`);
      if (input.language) filters.push(`language=${input.language}`);
      if (input.date_start_from) filters.push(`start_from=${input.date_start_from}`);
      if (input.date_start_to) filters.push(`start_to=${input.date_start_to}`);
      ctx.enrich.notice(
        `No training matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try broader keywords, remove date range constraints, or check the format spelling.',
      );
    }

    return { items: result.items, appliedFilters };
  },

  format: (result) => {
    const lines: string[] = [renderAppliedFilters(result.appliedFilters)];
    for (const item of result.items) {
      lines.push(`\n## ${item.title}`);
      lines.push(`**ID:** ${item.id}`);
      if (item.sources?.length) lines.push(`**Organizer:** ${item.sources.join(', ')}`);
      if (item.formats?.length) lines.push(`**Format:** ${item.formats.join(', ')}`);
      if (item.countries?.length) lines.push(`**Countries:** ${item.countries.join(', ')}`);
      if (item.careerCategories?.length)
        lines.push(`**Career category:** ${item.careerCategories.join(', ')}`);
      if (item.languages?.length) lines.push(`**Languages:** ${item.languages.join(', ')}`);
      if (item.themes?.length) lines.push(`**Themes:** ${item.themes.join(', ')}`);
      if (item.dateStart) lines.push(`**Starts:** ${item.dateStart}`);
      if (item.dateEnd) lines.push(`**Ends:** ${item.dateEnd}`);
      if (item.dateRegistration) lines.push(`**Registration deadline:** ${item.dateRegistration}`);
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
  format?: string | undefined;
  careerCategory?: string | undefined;
  language?: string | undefined;
  dateStartFrom?: string | undefined;
  dateStartTo?: string | undefined;
  sort: string;
  limit: number;
  offset: number;
}): string {
  const parts: string[] = [];
  if (f.text != null) parts.push(`text="${f.text}"`);
  if (f.country != null) parts.push(`country=${f.country}`);
  if (f.source != null) parts.push(`source="${f.source}"`);
  if (f.format != null) parts.push(`format="${f.format}"`);
  if (f.careerCategory != null) parts.push(`careerCategory="${f.careerCategory}"`);
  if (f.language != null) parts.push(`language=${f.language}`);
  if (f.dateStartFrom != null) parts.push(`dateStartFrom=${f.dateStartFrom}`);
  if (f.dateStartTo != null) parts.push(`dateStartTo=${f.dateStartTo}`);
  parts.push(`sort=${f.sort}`, `limit=${f.limit}`, `offset=${f.offset}`);
  return `**Applied filters:** ${parts.join(', ')}`;
}
