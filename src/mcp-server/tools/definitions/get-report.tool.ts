/**
 * @fileoverview Fetch a single ReliefWeb report by ID with full body text and metadata.
 * Oversized records return a section outline instead, which a `sections` re-call resolves.
 * @module mcp-server/tools/definitions/get-report
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  documentOrOutline,
  OUTLINE_KIND,
  OUTLINE_NOTICE,
  OUTLINE_SECTIONS,
  renderOutline,
  sectionsInput,
} from '@/mcp-server/tools/document-sections.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';

/** Kept on every `sections` selection so a slice is still attributable to its record. */
const REPORT_IDENTITY = ['id', 'title', 'urlAlias'];

/**
 * Every field the full arm can carry. Declared required here and made `.partial()` in
 * `output` so the outline arm — which carries none of them — is a valid response too.
 */
const ReportFields = z.object({
  id: z.number().describe('ReliefWeb numeric report ID.'),
  title: z.string().describe('Report title.'),
  dateOriginal: z.string().describe('Source publication date (ISO 8601).'),
  dateCreated: z.string().describe('ReliefWeb index date (ISO 8601).'),
  primaryCountry: z.string().describe('Primary country name for this report.'),
  countries: z.array(z.string()).describe('All countries tagged on this report.'),
  sources: z.array(z.string()).describe('Publishing organizations (short names).'),
  formats: z.array(z.string()).describe('Content format names.'),
  themes: z.array(z.string()).describe('Humanitarian theme/sector names.'),
  languages: z.array(z.string()).describe('Language codes (ISO 639-1).'),
  urlAlias: z.string().describe('Canonical ReliefWeb URL for this report.'),
  fileUrls: z.array(z.string()).describe('Direct file download URLs attached to this report.'),
  headlineSummary: z
    .string()
    .describe('Short editorial summary from the headline block, when present.'),
  body: z
    .string()
    .describe(
      'Full report body text (HTML). Present for most reports; absent for binary-only documents.',
    ),
});

const ReportOutput = z.object({
  kind: OUTLINE_KIND,
  ...ReportFields.partial().shape,
  sections: OUTLINE_SECTIONS,
  outlineNotice: OUTLINE_NOTICE,
});

export const reliefwebGetReport = tool('reliefweb_get_report', {
  title: 'Get ReliefWeb Report',
  description:
    'Fetch a single ReliefWeb report by its numeric ID with full body text, file attachments, and all metadata. ' +
    'Use after reliefweb_search_reports to retrieve document content — body is excluded from search results to manage context budget. ' +
    'Report bodies can be 10–100KB. A record over the response budget comes back as a section outline naming every section and its byte size; ' +
    're-call with sections to pull only the ones needed. Nothing is truncated on either path.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    id: z
      .number()
      .int()
      .positive()
      .describe('ReliefWeb numeric report ID. Obtained from reliefweb_search_reports results.'),
    sections: sectionsInput('report'),
  }),
  output: ReportOutput,
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
    ctx.log.info('reliefweb_get_report', { id: input.id, sections: input.sections });
    const report = await getReliefWebService().getReport(input.id, ctx);
    if (!report) {
      throw ctx.fail(
        'not_found',
        `No report found with ID ${input.id}. Verify the ID is a valid ReliefWeb numeric ID.`,
      );
    }
    return documentOrOutline(report, input.sections, REPORT_IDENTITY);
  },

  format: (result) => [
    ...(result.id != null ? renderReport(result) : []),
    ...renderOutline(result),
  ],
});

/**
 * Renders the full arm — keyed on `id` presence by the caller, never on `kind`, so the
 * parity walk (one synthetic sample carrying every optional field at once) reaches both
 * arms.
 */
function renderReport(result: z.infer<typeof ReportOutput>) {
  const lines: string[] = [`# ${result.title ?? `Report ${result.id}`}`];
  lines.push(`**ID:** ${result.id}`);
  lines.push(`**Mode:** ${result.kind}`);
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
  return [{ type: 'text' as const, text: lines.join('\n') }];
}
