/**
 * @fileoverview Search humanitarian job listings on ReliefWeb.
 * @module mcp-server/tools/definitions/search-jobs
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

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
  }),
  enrichment: {
    totalCount: z.number().describe('Total jobs matching the query before pagination.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — echoes filters applied and suggests how to broaden.',
      ),
  },
  async handler(input, ctx) {
    ctx.log.info('reliefweb_search_jobs', {
      text: input.text,
      country: input.country,
      careerCategory: input.career_category,
      limit: input.limit,
    });

    const result = await getReliefWebService().searchJobs(
      {
        ...(input.text?.trim() ? { text: input.text } : {}),
        ...(input.country?.trim() ? { country: input.country.toUpperCase() } : {}),
        ...(input.source?.trim() ? { source: input.source } : {}),
        ...(input.career_category?.trim() ? { careerCategory: input.career_category } : {}),
        ...(input.theme?.trim() ? { theme: input.theme } : {}),
        ...(input.experience?.trim() ? { experience: input.experience } : {}),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (input.country) filters.push(`country=${input.country}`);
      if (input.career_category) filters.push(`career_category="${input.career_category}"`);
      ctx.enrich.notice(
        `No jobs matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try broader keywords, remove the country filter, or check the career category spelling.',
      );
    }

    return { items: result.items };
  },

  format: (result) => {
    const lines: string[] = [];
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
