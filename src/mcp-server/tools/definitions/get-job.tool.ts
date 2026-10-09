/**
 * @fileoverview Fetch a single ReliefWeb job posting by ID with its full description and
 * application instructions. Oversized records return a section outline instead, which a
 * `sections` re-call resolves.
 * @module mcp-server/tools/definitions/get-job
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
const JOB_IDENTITY = ['id', 'title', 'urlAlias'];

/**
 * Every field the full arm can carry. Declared required here and made `.partial()` in
 * `output` so the outline arm — which carries none of them — is a valid response too.
 */
const JobFields = z.object({
  id: z.number().describe('ReliefWeb numeric job ID.'),
  title: z.string().describe('Job title.'),
  status: z
    .string()
    .describe('Posting status: published while the vacancy is open, expired once it has closed.'),
  dateCreated: z.string().describe('Date this posting was indexed (ISO 8601).'),
  dateClosing: z.string().describe('Application closing date (ISO 8601).'),
  dateChanged: z.string().describe('Date this posting was last modified (ISO 8601).'),
  sources: z.array(z.string()).describe('Hiring organizations (short names).'),
  countries: z.array(z.string()).describe('Countries tagged on this job.'),
  themes: z.array(z.string()).describe('Humanitarian theme/sector names.'),
  types: z.array(z.string()).describe('Job type names, such as Job or Consultancy.'),
  careerCategories: z.array(z.string()).describe('Career category names (humanitarian tracks).'),
  experienceLevels: z.array(z.string()).describe('Required experience levels.'),
  urlAlias: z.string().describe('Canonical ReliefWeb URL for this job listing.'),
  url: z.string().describe('ReliefWeb node URL for this job listing.'),
  body: z
    .string()
    .describe('Full vacancy description (HTML) — duties, requirements, and conditions.'),
  howToApply: z
    .string()
    .describe('Application instructions (HTML) as published by the hiring organization.'),
});

const JobOutput = z.object({
  kind: OUTLINE_KIND,
  ...JobFields.partial().shape,
  sections: OUTLINE_SECTIONS,
  outlineNotice: OUTLINE_NOTICE,
});

export const reliefwebGetJob = tool('reliefweb_get_job', {
  title: 'Get ReliefWeb Job',
  description:
    'Fetch a job posting by ReliefWeb numeric ID with the full vacancy description, application instructions, dates, hiring organization, and location and taxonomy metadata. ' +
    'Use after reliefweb_search_jobs, which returns summaries without the description or application instructions. ' +
    'Reaches expired postings as well as open ones. A record over the response budget comes back as a section outline naming every section and its byte size; ' +
    're-call with sections to pull only the ones needed. Nothing is truncated on either path.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    id: z
      .number()
      .int()
      .positive()
      .describe('ReliefWeb numeric job ID. Obtained from reliefweb_search_jobs results.'),
    sections: sectionsInput('job'),
  }),
  output: JobOutput,
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No job posting found with the given ID.',
      recovery:
        'Verify the ID is a valid ReliefWeb numeric job ID. Use reliefweb_search_jobs to discover valid IDs, with include_archived=true when the posting has already closed.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_get_job', { id: input.id, sections: input.sections });
    const job = await getReliefWebService().getJob(input.id, ctx);
    if (!job) {
      throw ctx.fail(
        'not_found',
        `No job posting found with ID ${input.id}. Verify the ID from reliefweb_search_jobs.`,
      );
    }
    return documentOrOutline(job, input.sections, JOB_IDENTITY);
  },

  format: (result) => [...(result.id != null ? renderJob(result) : []), ...renderOutline(result)],
});

/**
 * Renders the full arm — keyed on `id` presence by the caller, never on `kind`, so the
 * parity walk (one synthetic sample carrying every optional field at once) reaches both
 * arms.
 */
function renderJob(result: z.infer<typeof JobOutput>) {
  const lines: string[] = [`# ${result.title ?? `Job ${result.id}`}`];
  lines.push(`**ID:** ${result.id}`);
  lines.push(`**Mode:** ${result.kind}`);
  if (result.status) lines.push(`**Status:** ${result.status}`);
  if (result.sources?.length) lines.push(`**Organization:** ${result.sources.join(', ')}`);
  if (result.countries?.length) lines.push(`**Countries:** ${result.countries.join(', ')}`);
  if (result.careerCategories?.length) {
    lines.push(`**Career category:** ${result.careerCategories.join(', ')}`);
  }
  if (result.experienceLevels?.length) {
    lines.push(`**Experience:** ${result.experienceLevels.join(', ')}`);
  }
  if (result.themes?.length) lines.push(`**Themes:** ${result.themes.join(', ')}`);
  if (result.types?.length) lines.push(`**Type:** ${result.types.join(', ')}`);
  if (result.dateCreated) lines.push(`**Indexed:** ${result.dateCreated}`);
  if (result.dateClosing) lines.push(`**Closing:** ${result.dateClosing}`);
  if (result.dateChanged) lines.push(`**Last modified:** ${result.dateChanged}`);
  if (result.urlAlias) lines.push(`**URL:** ${result.urlAlias}`);
  if (result.url) lines.push(`**Node URL:** ${result.url}`);
  if (result.body) lines.push(`\n## Description\n\n${result.body}`);
  if (result.howToApply) lines.push(`\n## How to apply\n\n${result.howToApply}`);
  return [{ type: 'text' as const, text: lines.join('\n') }];
}
