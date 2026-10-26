/**
 * @fileoverview Search humanitarian training and learning opportunities on ReliefWeb.
 * @module mcp-server/tools/definitions/search-training
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { limitSchema, resolveLimit, SEARCH_MAX_LIMIT } from '@/mcp-server/tools/limits.js';
import { pagedPastEndNotice } from '@/mcp-server/tools/pagination.js';
import { renderPlainTextNotice } from '@/mcp-server/tools/plain-text-notice.js';
import {
  currentDateBound,
  DATE_BOUND_FORMAT_MESSAGE,
  DATE_BOUND_PATTERN,
  InvalidDateBoundError,
  resolveDateBound,
} from '@/services/reliefweb/date-utils.js';
import { getReliefWebService } from '@/services/reliefweb/reliefweb-service.js';
import {
  isRejectedQueryError,
  rejectedQueryMessage,
  upstreamErrorMessage,
} from '@/services/reliefweb/upstream-errors.js';
import {
  resolveVocabulary,
  TRAINING_COSTS,
  unknownValueMessage,
} from '@/services/reliefweb/vocabularies.js';

export const reliefwebSearchTraining = tool('reliefweb_search_training', {
  title: 'Search ReliefWeb Training',
  description:
    'Search humanitarian training and learning opportunities on ReliefWeb by country, format, date, source, career category, cost, listing language, and delivery language. ' +
    'Covers on-site and online capacity-building events. ' +
    'Training date fields use date.start / date.end — different from report date fields. ' +
    'Use date_start_from and date_start_to to find upcoming training within a window. ' +
    'Results default to soonest-starting first (date.start:asc). ' +
    'With neither date bound supplied the search is scoped to training starting from now, so the first page is upcoming opportunities; ' +
    'supply either bound to search an explicit range, including a historical one. ' +
    'Use include_archived=true to search concluded listings as well, which are far more numerous than the current ones.',
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
      .enum(['on-site', 'online'])
      .optional()
      .describe('Training format. Valid values: on-site, online. Filters on format.name.'),
    career_category: z
      .string()
      .optional()
      .describe(
        'ReliefWeb career-category name (e.g., Program/Project Management, Information and Communications Technology, Logistics/Procurement). Filters on career_categories.name.',
      ),
    language: z
      .string()
      .optional()
      .describe(
        'Listing language code (ISO 639-1, e.g., en, fr, es). Filters on language.code; use training_language for the course delivery language.',
      ),
    cost: z
      .string()
      .optional()
      .describe(
        'Training cost: free or fee-based. Case, spacing, and punctuation are ignored; blank is omitted.',
      ),
    training_language: z
      .string()
      .optional()
      .describe(
        'Course delivery language code (ISO 639-1, e.g., en, fr, es). Filters on training_language.code independently of the listing language.',
      ),
    date_start_from: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(DATE_BOUND_PATTERN, DATE_BOUND_FORMAT_MESSAGE)
          .describe(
            'Calendar date (2024-06-01) or full ISO 8601 datetime (2024-06-01T00:00:00+00:00).',
          ),
      ])
      .optional()
      .describe(
        'Training start date lower bound. Filters on date.start — use to find training starting after a given date. A bare calendar date resolves to start of that day in UTC, and a datetime carrying any offset is resolved to UTC. Omit this and date_start_to together to default the search to training starting from now, unless include_archived is set, which leaves the range open.',
      ),
    date_start_to: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(DATE_BOUND_PATTERN, DATE_BOUND_FORMAT_MESSAGE)
          .describe(
            'Calendar date (2024-12-31) or full ISO 8601 datetime (2024-12-31T23:59:59+00:00).',
          ),
      ])
      .optional()
      .describe(
        'Training start date upper bound. Filters on date.start — pair with date_start_from for a window. A bare calendar date resolves to end of that day in UTC, and a datetime carrying any offset is resolved to UTC. Supplying this alone searches everything up to it, with no lower bound injected.',
      ),
    sort: z
      .string()
      .optional()
      .describe(
        'Sort order. Use date.start:asc for soonest-starting training first (default), date.start:desc for latest-starting, date.created:desc for most recently posted, or score:desc for relevance.',
      ),
    include_archived: z
      .boolean()
      .optional()
      .describe(
        'Search concluded listings alongside the current ones. Uses preset=analysis. Off by default. Setting this also drops the start-from-now default bound, so an otherwise unbounded search reaches back through the whole record; pair it with date_start_from and date_start_to to study a specific period.',
      ),
    limit: limitSchema(SEARCH_MAX_LIMIT)
      .default(10)
      .describe(
        'Number of results to return (1–1000, default 10). Larger integers are clamped to 1000 with a notice when clamping is enabled; otherwise they are rejected. Each call counts against the 1,000-calls/day quota.',
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
            languages: z
              .array(z.string())
              .optional()
              .describe('Listing language codes (ISO 639-1).'),
            cost: z
              .string()
              .optional()
              .describe('Training cost category when supplied by the listing.'),
            trainingLanguages: z
              .array(z.string())
              .optional()
              .describe('Course delivery language codes (ISO 639-1).'),
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
        language: z.string().optional().describe('Listing language code filter applied.'),
        cost: z.string().optional().describe('Canonical training cost filter applied.'),
        trainingLanguage: z
          .string()
          .optional()
          .describe('Course delivery language code filter applied.'),
        dateStartFrom: z
          .string()
          .optional()
          .describe(
            'Training start date lower bound applied — the caller-supplied value, or the current timestamp when neither date bound was given and include_archived was off.',
          ),
        dateStartTo: z.string().optional().describe('Training start date upper bound applied.'),
        sort: z.string().describe('Sort order the query used (resolved, including the default).'),
        preset: z
          .string()
          .describe(
            'ReliefWeb preset the query used: latest (current listings only, default) or analysis when include_archived.',
          ),
        limit: z.number().describe('Result limit the query used.'),
        offset: z.number().describe('Pagination offset the query used.'),
      })
      .describe(
        'The resolved filter set the query actually ran with, after normalization and defaults. Echoes back so the agent can confirm how its inputs were interpreted.',
      ),
  }),
  enrichmentTrailer: { notice: { render: renderPlainTextNotice } },
  enrichment: {
    totalCount: z
      .number()
      .describe('Total training listings matching the query before pagination.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Discloses requested and applied limits when clamped. For empty pages, names the match count and last reachable offset when records matched; otherwise echoes filters and suggests how to broaden.',
      ),
  },
  errors: [
    {
      reason: 'unknown_cost',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The cost value does not name a ReliefWeb training cost category.',
      recovery: 'Use free or fee-based for cost; case, spacing, and punctuation do not matter.',
    },
    {
      reason: 'invalid_date',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A date bound contains impossible calendar or time components.',
      recovery:
        'Correct the named field using a valid calendar date or ISO 8601 datetime, then call again.',
    },
    {
      reason: 'invalid_query',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'ReliefWeb rejected the query — possible causes include malformed text, an unrecognized sort field, or a malformed date.',
      recovery:
        'Correct the value named in the error message and call again; an unchanged retry is rejected identically. Sort fields must be real ReliefWeb field names, and dates take a calendar date or a full ISO 8601 datetime. Malformed text is another possible cause: use plain keywords, balanced parentheses, and complete boolean expressions in text.',
    },
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'The ReliefWeb API was unreachable, timed out, or returned a server error.',
      recovery:
        'Wait a moment and retry. If the message names a configuration or quota problem — an unapproved appname, or the 1,000 calls/day limit — that must be resolved before any retry can succeed.',
    },
  ],

  async handler(requestedInput, ctx) {
    const { limit, notice } = resolveLimit(
      requestedInput.limit,
      SEARCH_MAX_LIMIT,
      'reliefweb_search_training',
      ctx,
    );
    const input = { ...requestedInput, limit };
    ctx.log.info('reliefweb_search_training', {
      text: input.text,
      country: input.country,
      format: input.format,
      limit: input.limit,
    });

    const country = input.country?.trim() ? input.country.toUpperCase() : undefined;
    const resolveBound = (field: 'date_start_from' | 'date_start_to', bound: 'from' | 'to') => {
      try {
        return resolveDateBound(input[field], bound);
      } catch (error) {
        if (error instanceof InvalidDateBoundError) {
          throw ctx.fail(
            'invalid_date',
            `Invalid ${field} value "${error.value}". ${DATE_BOUND_FORMAT_MESSAGE}`,
          );
        }
        throw error;
      }
    };
    const dateStartTo = resolveBound('date_start_to', 'to');
    /**
     * An unbounded search is asking what is coming up, but date.start:asc opens on the
     * oldest listing in the corpus — every training that already started sorts ahead of
     * the next one. Scope it to now. A caller who supplied either bound is doing explicit
     * (possibly historical) research, so their range is left exactly as given — and so is a
     * caller who asked for the archive, since a start-from-now bound would hide the very
     * listings include_archived exists to reach.
     */
    const dateStartFrom =
      resolveBound('date_start_from', 'from') ??
      (dateStartTo === undefined && !input.include_archived ? currentDateBound() : undefined);
    const cost = resolveVocabulary(input.cost, TRAINING_COSTS);
    if (cost.unmatched.length > 0) {
      throw ctx.fail('unknown_cost', unknownValueMessage('cost', cost.unmatched, TRAINING_COSTS));
    }

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.source?.trim() ? { source: input.source } : {}),
      ...(input.format?.trim() ? { format: input.format } : {}),
      ...(input.career_category?.trim() ? { careerCategory: input.career_category } : {}),
      ...(input.language?.trim() ? { language: input.language } : {}),
      ...(cost.value ? { cost: cost.value } : {}),
      ...(input.training_language?.trim() ? { trainingLanguage: input.training_language } : {}),
      ...(dateStartFrom ? { dateStartFrom } : {}),
      ...(dateStartTo ? { dateStartTo } : {}),
      sort: input.sort?.trim() || 'date.start:asc',
      preset: input.include_archived ? 'analysis' : 'latest',
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
          ...(cost.value ? { cost: cost.value } : {}),
          ...(input.training_language?.trim() ? { trainingLanguage: input.training_language } : {}),
          ...(dateStartFrom ? { dateStartFrom } : {}),
          ...(dateStartTo ? { dateStartTo } : {}),
          ...(input.sort?.trim() ? { sort: input.sort } : {}),
          ...(input.include_archived != null ? { includeArchived: input.include_archived } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        ctx,
      )
      .catch((err: unknown) => {
        if (isRejectedQueryError(err)) {
          throw ctx.fail('invalid_query', rejectedQueryMessage('training', err), undefined, {
            cause: err,
          });
        }
        throw ctx.fail(
          'upstream_error',
          upstreamErrorMessage('ReliefWeb API error while searching training.', err),
          undefined,
          { cause: err },
        );
      });

    ctx.enrich.total(result.totalCount);

    if (result.items.length === 0 && result.totalCount > 0) {
      notice(
        pagedPastEndNotice({
          subject: 'training listings',
          offset: input.offset,
          totalCount: result.totalCount,
          limit: input.limit,
        }),
      );
    } else if (result.items.length === 0) {
      const filters: string[] = [];
      if (input.text) filters.push(`text="${input.text}"`);
      if (country) filters.push(`country=${country}`);
      if (input.source) filters.push(`source="${input.source}"`);
      if (input.format) filters.push(`format="${input.format}"`);
      if (input.career_category) filters.push(`career_category="${input.career_category}"`);
      if (input.language) filters.push(`language=${input.language}`);
      if (cost.value) filters.push(`cost=${cost.value}`);
      if (input.training_language?.trim())
        filters.push(`training_language=${input.training_language}`);
      if (dateStartFrom) filters.push(`start_from=${dateStartFrom}`);
      if (dateStartTo) filters.push(`start_to=${dateStartTo}`);
      notice(
        `No training matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. ` +
          'Try broader keywords, widen or remove the date range, remove the cost or training_language filter, check the format spelling, ' +
          'or set include_archived=true to search concluded listings as well.',
      );
    }

    return { items: result.items, appliedFilters };
  },

  format: (result) => {
    const lines: string[] = [renderAppliedFilters(result.appliedFilters)];
    for (const item of result.items) {
      lines.push(`\n**${escapeMarkdownInline(item.title)}**`);
      lines.push(`**ID:** ${item.id}`);
      if (item.sources?.length)
        lines.push(`**Organizer:** ${escapeMarkdownInline(item.sources.join(', '))}`);
      if (item.formats?.length)
        lines.push(`**Format:** ${escapeMarkdownInline(item.formats.join(', '))}`);
      if (item.countries?.length)
        lines.push(`**Countries:** ${escapeMarkdownInline(item.countries.join(', '))}`);
      if (item.careerCategories?.length)
        lines.push(
          `**Career category:** ${escapeMarkdownInline(item.careerCategories.join(', '))}`,
        );
      if (item.languages?.length)
        lines.push(`**Listing languages:** ${escapeMarkdownInline(item.languages.join(', '))}`);
      if (item.cost) lines.push(`**Cost:** ${escapeMarkdownInline(item.cost)}`);
      if (item.trainingLanguages?.length)
        lines.push(
          `**Training languages:** ${escapeMarkdownInline(item.trainingLanguages.join(', '))}`,
        );
      if (item.themes?.length)
        lines.push(`**Themes:** ${escapeMarkdownInline(item.themes.join(', '))}`);
      if (item.dateStart) lines.push(`**Starts:** ${escapeMarkdownInline(item.dateStart)}`);
      if (item.dateEnd) lines.push(`**Ends:** ${escapeMarkdownInline(item.dateEnd)}`);
      if (item.dateRegistration)
        lines.push(`**Registration deadline:** ${escapeMarkdownInline(item.dateRegistration)}`);
      if (item.urlAlias) lines.push(`**URL:** ${markdownLink(item.urlAlias, item.urlAlias)}`);
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
  cost?: string | undefined;
  trainingLanguage?: string | undefined;
  dateStartFrom?: string | undefined;
  dateStartTo?: string | undefined;
  sort: string;
  preset: string;
  limit: number;
  offset: number;
}): string {
  const parts: string[] = [];
  if (f.text != null) parts.push(`text="${escapeMarkdownInline(f.text)}"`);
  if (f.country != null) parts.push(`country=${escapeMarkdownInline(f.country)}`);
  if (f.source != null) parts.push(`source="${escapeMarkdownInline(f.source)}"`);
  if (f.format != null) parts.push(`format="${f.format}"`);
  if (f.careerCategory != null)
    parts.push(`careerCategory="${escapeMarkdownInline(f.careerCategory)}"`);
  if (f.language != null) parts.push(`language=${escapeMarkdownInline(f.language)}`);
  if (f.cost != null) parts.push(`cost=${f.cost}`);
  if (f.trainingLanguage != null)
    parts.push(`trainingLanguage=${escapeMarkdownInline(f.trainingLanguage)}`);
  if (f.dateStartFrom != null) parts.push(`dateStartFrom=${f.dateStartFrom}`);
  if (f.dateStartTo != null) parts.push(`dateStartTo=${f.dateStartTo}`);
  parts.push(
    `sort=${escapeMarkdownInline(f.sort)}`,
    `preset=${f.preset}`,
    `limit=${f.limit}`,
    `offset=${f.offset}`,
  );
  return `**Applied filters:** ${parts.join(', ')}`;
}
