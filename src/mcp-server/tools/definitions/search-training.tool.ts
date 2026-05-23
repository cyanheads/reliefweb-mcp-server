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
  annotations: { readOnlyHint: true },
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
        'Zero-based offset for pagination. Use with limit and totalCount to page through results.',
      ),
  }),
  output: z.object({
    items: z
      .array(
        z.object({
          id: z.number().describe('ReliefWeb numeric training ID.'),
          title: z.string().describe('Training title.'),
          dateStart: z.string().optional().describe('Training start date (ISO 8601).'),
          dateEnd: z.string().optional().describe('Training end date (ISO 8601).'),
          dateRegistration: z.string().optional().describe('Registration deadline (ISO 8601).'),
          sources: z
            .array(z.string())
            .optional()
            .describe('Organizing organizations (short names).'),
          countries: z.array(z.string()).optional().describe('Countries tagged on this training.'),
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
        }),
      )
      .describe('Matching training opportunities.'),
    totalCount: z
      .number()
      .describe('Total training listings matching the query before pagination.'),
    message: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — echoes filters applied and suggests how to broaden.',
      ),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No training listings matched the query.',
      recovery:
        'Try broader keywords, remove date range filters, or check the format and career category spelling.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_search_training', {
      text: input.text,
      country: input.country,
      format: input.format,
      limit: input.limit,
    });

    const result = await getReliefWebService().searchTraining(
      {
        ...(input.text?.trim() ? { text: input.text } : {}),
        ...(input.country?.trim() ? { country: input.country.toUpperCase() } : {}),
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
    );

    if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (input.country) filters.push(`country=${input.country}`);
      if (input.format) filters.push(`format="${input.format}"`);
      if (input.date_start_from) filters.push(`start_from=${input.date_start_from}`);
      return {
        items: [],
        totalCount: 0,
        message:
          `No training matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try broader keywords, remove date range constraints, or check the format spelling.',
      };
    }

    return { items: result.items, totalCount: result.totalCount };
  },

  format: (result) => {
    const lines: string[] = [`**Total:** ${result.totalCount} training opportunities`];
    if (result.message) lines.push(`\n> ${result.message}`);
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
