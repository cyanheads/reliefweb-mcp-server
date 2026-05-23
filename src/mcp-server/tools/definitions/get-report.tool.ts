/**
 * @fileoverview Fetch a single ReliefWeb report by ID with full body text and metadata.
 * @module mcp-server/tools/definitions/get-report
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

export const reliefwebGetReport = tool('reliefweb_get_report', {
  title: 'Get ReliefWeb Report',
  description:
    'Fetch a single ReliefWeb report by its numeric ID with full body text, file attachments, and all metadata. ' +
    'Use after reliefweb_search_reports to retrieve document content — body is excluded from search results to manage context budget. ' +
    'Report bodies can be 10–100KB; call this only when you need the full document text.',
  annotations: { readOnlyHint: true },
  input: z.object({
    id: z
      .number()
      .int()
      .positive()
      .describe('ReliefWeb numeric report ID. Obtained from reliefweb_search_reports results.'),
  }),
  output: z.object({
    id: z.number().describe('ReliefWeb numeric report ID.'),
    title: z.string().describe('Report title.'),
    dateOriginal: z.string().optional().describe('Source publication date (ISO 8601).'),
    dateCreated: z.string().optional().describe('ReliefWeb index date (ISO 8601).'),
    primaryCountry: z.string().optional().describe('Primary country name for this report.'),
    countries: z.array(z.string()).optional().describe('All countries tagged on this report.'),
    sources: z.array(z.string()).optional().describe('Publishing organizations (short names).'),
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
    body: z
      .string()
      .optional()
      .describe(
        'Full report body text (HTML). Present for most reports; absent for binary-only documents.',
      ),
  }),
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No report found with the given ID.',
      recovery:
        'Verify the ID is a valid ReliefWeb numeric ID obtained from search results. Use reliefweb_search_reports to discover valid IDs.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_get_report', { id: input.id });
    const report = await getReliefWebService().getReport(input.id, ctx);
    if (!report) {
      throw ctx.fail(
        'not_found',
        `No report found with ID ${input.id}. Verify the ID is a valid ReliefWeb numeric ID.`,
        { ...ctx.recoveryFor('not_found') },
      );
    }
    return report;
  },

  format: (result) => {
    const lines: string[] = [`# ${result.title}`];
    lines.push(`**ID:** ${result.id}`);
    if (result.dateOriginal) lines.push(`**Published:** ${result.dateOriginal}`);
    if (result.dateCreated) lines.push(`**Indexed:** ${result.dateCreated}`);
    if (result.primaryCountry) lines.push(`**Primary country:** ${result.primaryCountry}`);
    if (result.countries?.length) lines.push(`**Countries:** ${result.countries.join(', ')}`);
    if (result.sources?.length) lines.push(`**Sources:** ${result.sources.join(', ')}`);
    if (result.formats?.length) lines.push(`**Format:** ${result.formats.join(', ')}`);
    if (result.themes?.length) lines.push(`**Themes:** ${result.themes.join(', ')}`);
    if (result.languages?.length) lines.push(`**Languages:** ${result.languages.join(', ')}`);
    if (result.headlineSummary) lines.push(`\n**Summary:** ${result.headlineSummary}`);
    if (result.urlAlias) lines.push(`**URL:** ${result.urlAlias}`);
    if (result.fileUrls?.length) lines.push(`**Files:** ${result.fileUrls.join(', ')}`);
    if (result.body) lines.push(`\n---\n\n${result.body}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
