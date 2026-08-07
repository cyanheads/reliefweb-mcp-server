/**
 * @fileoverview Fetch a single ReliefWeb training listing by ID with its full description,
 * registration instructions, and cost information. Oversized records return a section
 * outline instead, which a `sections` re-call resolves.
 * @module mcp-server/tools/definitions/get-training
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
const TRAINING_IDENTITY = ['id', 'title', 'urlAlias'];

/**
 * Every field the full arm can carry. Declared required here and made `.partial()` in
 * `output` so the outline arm — which carries none of them — is a valid response too.
 */
const TrainingFields = z.object({
  id: z.number().describe('ReliefWeb numeric training ID.'),
  title: z.string().describe('Training title.'),
  status: z
    .string()
    .describe('Listing status: published while the training is current, expired once concluded.'),
  dateStart: z.string().describe('Training start date (ISO 8601).'),
  dateEnd: z.string().describe('Training end date (ISO 8601).'),
  dateRegistration: z.string().describe('Registration deadline (ISO 8601).'),
  dateCreated: z.string().describe('Date this listing was indexed (ISO 8601).'),
  sources: z.array(z.string()).describe('Organizing organizations (short names).'),
  countries: z.array(z.string()).describe('Countries tagged on this training.'),
  cities: z.array(z.string()).describe('Host cities, for on-site training.'),
  themes: z.array(z.string()).describe('Humanitarian theme/sector names.'),
  formats: z.array(z.string()).describe('Training format names: on-site or online.'),
  types: z.array(z.string()).describe('Training type names, such as Training/Workshop or Course.'),
  languages: z.array(z.string()).describe('Language codes of the listing (ISO 639-1).'),
  trainingLanguages: z
    .array(z.string())
    .describe('Language codes the training is delivered in (ISO 639-1).'),
  careerCategories: z.array(z.string()).describe('Career category names (humanitarian tracks).'),
  urlAlias: z.string().describe('Canonical ReliefWeb URL for this training listing.'),
  url: z.string().describe('ReliefWeb node URL for this training listing.'),
  eventUrl: z.string().describe("The organizer's own page for this training, when published."),
  cost: z.string().describe('Cost class as ReliefWeb records it, such as free or fee-based.'),
  feeInformation: z
    .string()
    .describe('Fee detail as published by the organizer — amounts, inclusions, and conditions.'),
  body: z.string().describe('Full training description (HTML) — content, audience, and logistics.'),
  howToRegister: z
    .string()
    .describe('Registration instructions (HTML) as published by the organizer.'),
});

const TrainingOutput = z.object({
  kind: OUTLINE_KIND,
  ...TrainingFields.partial().shape,
  sections: OUTLINE_SECTIONS,
  outlineNotice: OUTLINE_NOTICE,
});

export const reliefwebGetTraining = tool('reliefweb_get_training', {
  title: 'Get ReliefWeb Training',
  description:
    'Fetch a training listing by ReliefWeb numeric ID with the full description, registration instructions, event link, cost and fee information, dates, languages, and organizing source. ' +
    'Use after reliefweb_search_training, which returns summaries without the description, registration instructions, or cost detail. ' +
    'Reaches concluded listings as well as current ones. A record over the response budget comes back as a section outline naming every section and its byte size; ' +
    're-call with sections to pull only the ones needed. Nothing is truncated on either path.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    id: z
      .number()
      .int()
      .positive()
      .describe('ReliefWeb numeric training ID. Obtained from reliefweb_search_training results.'),
    sections: sectionsInput('training'),
  }),
  output: TrainingOutput,
  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No training listing found with the given ID.',
      recovery:
        'Verify the ID is a valid ReliefWeb numeric training ID. Use reliefweb_search_training to discover valid IDs, with include_archived=true when the training has already concluded.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('reliefweb_get_training', { id: input.id, sections: input.sections });
    const training = await getReliefWebService().getTraining(input.id, ctx);
    if (!training) {
      throw ctx.fail(
        'not_found',
        `No training listing found with ID ${input.id}. Verify the ID from reliefweb_search_training.`,
        { ...ctx.recoveryFor('not_found') },
      );
    }
    return documentOrOutline(training, input.sections, TRAINING_IDENTITY);
  },

  format: (result) => [
    ...(result.id != null ? renderTraining(result) : []),
    ...renderOutline(result),
  ],
});

/**
 * Renders the full arm — keyed on `id` presence by the caller, never on `kind`, so the
 * parity walk (one synthetic sample carrying every optional field at once) reaches both
 * arms.
 */
function renderTraining(result: z.infer<typeof TrainingOutput>) {
  const lines: string[] = [`# ${result.title ?? `Training ${result.id}`}`];
  lines.push(`**ID:** ${result.id}`);
  lines.push(`**Mode:** ${result.kind}`);
  if (result.status) lines.push(`**Status:** ${result.status}`);
  if (result.sources?.length) lines.push(`**Organizer:** ${result.sources.join(', ')}`);
  if (result.formats?.length) lines.push(`**Format:** ${result.formats.join(', ')}`);
  if (result.types?.length) lines.push(`**Type:** ${result.types.join(', ')}`);
  if (result.countries?.length) lines.push(`**Countries:** ${result.countries.join(', ')}`);
  if (result.cities?.length) lines.push(`**Cities:** ${result.cities.join(', ')}`);
  if (result.careerCategories?.length) {
    lines.push(`**Career category:** ${result.careerCategories.join(', ')}`);
  }
  if (result.themes?.length) lines.push(`**Themes:** ${result.themes.join(', ')}`);
  if (result.languages?.length) lines.push(`**Languages:** ${result.languages.join(', ')}`);
  if (result.trainingLanguages?.length) {
    lines.push(`**Taught in:** ${result.trainingLanguages.join(', ')}`);
  }
  if (result.dateStart) lines.push(`**Starts:** ${result.dateStart}`);
  if (result.dateEnd) lines.push(`**Ends:** ${result.dateEnd}`);
  if (result.dateRegistration) lines.push(`**Registration deadline:** ${result.dateRegistration}`);
  if (result.dateCreated) lines.push(`**Indexed:** ${result.dateCreated}`);
  if (result.cost) lines.push(`**Cost:** ${result.cost}`);
  if (result.feeInformation) lines.push(`**Fee information:** ${result.feeInformation}`);
  if (result.eventUrl) lines.push(`**Event URL:** ${result.eventUrl}`);
  if (result.urlAlias) lines.push(`**URL:** ${result.urlAlias}`);
  if (result.url) lines.push(`**Node URL:** ${result.url}`);
  if (result.body) lines.push(`\n## Description\n\n${result.body}`);
  if (result.howToRegister) lines.push(`\n## How to register\n\n${result.howToRegister}`);
  return [{ type: 'text' as const, text: lines.join('\n') }];
}
