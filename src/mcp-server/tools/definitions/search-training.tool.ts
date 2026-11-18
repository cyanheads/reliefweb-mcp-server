/**
 * @fileoverview Search humanitarian training and learning opportunities on ReliefWeb.
 * @module mcp-server/tools/definitions/search-training
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { escapeMarkdownInline, markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { countryCodesInput, parseCountryCodes } from '@/mcp-server/tools/country-codes.js';
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
import { TRAINING_DEFAULT_SORT } from '@/services/reliefweb/types.js';
import {
  isRejectedQueryError,
  rejectedQueryMessage,
  upstreamErrorMessage,
} from '@/services/reliefweb/upstream-errors.js';
import {
  CAREER_CATEGORIES,
  CAREER_CATEGORY_MATCHING,
  resolveVocabulary,
  TRAINING_COSTS,
  unknownValueMessage,
} from '@/services/reliefweb/vocabularies.js';

export const reliefwebSearchTraining = tool('reliefweb_search_training', {
  title: 'Search ReliefWeb Training',
  description:
    'Search humanitarian training and learning opportunities on ReliefWeb by country, format, date, source, career category, cost, listing language, and delivery language. Covers on-site and online capacity-building events. Training date fields use date.start / date.end — different from report date fields. With neither date bound supplied, the search covers training starting from now plus listings with no start date (most online courses have none): dated listings come first, soonest-starting first, then undated ones, newest-posted first (date.start:asc, date.created:desc). Supply date_start_from or date_start_to to search an explicit start-date window instead, including a historical one; a window leaves undated listings out. Use include_archived=true to search concluded listings as well, which are far more numerous than the current ones.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    text: z
      .string()
      .optional()
      .describe('Full-text search query. Matches against training title and description.'),
    country: countryCodesInput('training'),
    source: z.string().optional().describe('Organization short name. Filters on source.shortname.'),
    format: z
      .enum(['on-site', 'online'])
      .optional()
      .describe('Training format. Valid values: on-site, online. Filters on format.name.'),
    career_category: z
      .string()
      .optional()
      .describe(
        `ReliefWeb career category. One of: ${CAREER_CATEGORIES.join(', ')}. Also accepts the abbreviations ${Object.keys(CAREER_CATEGORY_MATCHING.aliases).join(', ')}, and a word found in only one category name (Logistics resolves to Logistics/Procurement). Separate several categories with commas to require all of them. Case, spacing, and punctuation are ignored; any other value is rejected with the valid list. Matches whole career-category tags.`,
      ),
    language: z
      .string()
      .optional()
      .describe(
        'Listing language code (ISO 639-1, e.g., en, fr, es). Case-insensitive; sent lower-cased, the form ReliefWeb stores. Filters on language.code; use training_language for the course delivery language.',
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
        'Course delivery language code (ISO 639-1, e.g., en, fr, es). Case-insensitive; sent lower-cased. Filters on training_language.code independently of the listing language.',
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
        'Training start date lower bound. Filters on date.start — use to find training starting after a given date. A bare calendar date resolves to start of that day in UTC, and a datetime carrying any offset is resolved to UTC. A supplied bound leaves listings with no start date out. Omit this and date_start_to together to default the search to training starting from now plus listings with no start date, unless include_archived is set, which leaves the range open.',
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
        'Training start date upper bound. Filters on date.start — pair with date_start_from for a window. A bare calendar date resolves to end of that day in UTC, and a datetime carrying any offset is resolved to UTC. Supplying this alone searches everything up to it, with no lower bound injected; listings with no start date are left out.',
      ),
    sort: z
      .string()
      .optional()
      .describe(
        'Sort order. Defaults to date.start:asc then date.created:desc: soonest-starting first, then listings with no start date, newest-posted first. Alternatives: date.start:desc for latest-starting, date.created:desc for most recently posted, or score:desc for relevance; a supplied sort is sent as the only key.',
      ),
    include_archived: z
      .boolean()
      .optional()
      .describe(
        'Search concluded listings alongside the current ones. Uses preset=analysis. Off by default. Setting this also drops the default scope (training starting from now, plus listings with no start date), so an otherwise unbounded search reaches back through the whole record, dated or not; pair it with date_start_from and date_start_to to study a specific period.',
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
            countryIso3s: z
              .array(z.string())
              .optional()
              .describe(
                'Uppercase ISO3 codes of the countries tagged on this training — the form the country filters and reliefweb_get_country take.',
              ),
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
        country: z
          .string()
          .optional()
          .describe('Country codes as normalized: uppercased ISO3, comma-separated when several.'),
        source: z.string().optional().describe('Source short name filter applied.'),
        format: z.string().optional().describe('Training format name filter applied.'),
        careerCategory: z
          .string()
          .optional()
          .describe(
            'Career category names applied, in canonical ReliefWeb spelling and comma-separated when several (listings must carry every one).',
          ),
        language: z
          .string()
          .optional()
          .describe('Listing language code filter applied, lower-cased.'),
        cost: z.string().optional().describe('Canonical training cost filter applied.'),
        trainingLanguage: z
          .string()
          .optional()
          .describe('Course delivery language code filter applied, lower-cased.'),
        dateStartFrom: z
          .string()
          .optional()
          .describe(
            'Training start date lower bound applied — the caller-supplied value, or the current timestamp when neither date bound was given and include_archived was off. That default scope also includes listings with no start date (undatedIncluded).',
          ),
        dateStartTo: z.string().optional().describe('Training start date upper bound applied.'),
        undatedIncluded: z
          .boolean()
          .optional()
          .describe(
            'True when the default scope applied: listings with no start date are included alongside those starting from dateStartFrom. Absent when a date bound was given or include_archived was set.',
          ),
        sort: z
          .string()
          .describe(
            'Sort order the query used (resolved, including the default); comma-separated keys apply in order.',
          ),
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
      reason: 'unknown_career_category',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A career_category value names no single ReliefWeb career category — an unknown name, a word shared by several category names, or words from more than one.',
      recovery:
        'Use a career category from the list in the error message, or ICT, M&E, or HR; a single word works only when it appears in one category name, such as Logistics. Separate several categories with commas to require all of them.',
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

    const countryCodes = parseCountryCodes(input.country);
    const country = countryCodes?.join(',');
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
    const explicitStartFrom = resolveBound('date_start_from', 'from');
    /**
     * An unbounded search is asking what is coming up, but date.start:asc opens on the
     * oldest listing in the corpus — every training that already started sorts ahead of
     * the next one. Scope it to listings starting from now, plus those with no start date:
     * most current listings carry none, and a start-date range alone would drop them. A
     * caller who supplied either bound is doing explicit (possibly historical) research, so
     * their range is left exactly as given — and so is a caller who asked for the archive,
     * since a start-from-now bound would hide the very listings include_archived exists to
     * reach.
     */
    const upcomingFrom =
      explicitStartFrom === undefined && dateStartTo === undefined && !input.include_archived
        ? currentDateBound()
        : undefined;
    const dateStartFrom = explicitStartFrom ?? upcomingFrom;
    const cost = resolveVocabulary(input.cost, TRAINING_COSTS);
    if (cost.unmatched.length > 0) {
      throw ctx.fail('unknown_cost', unknownValueMessage('cost', cost.unmatched, TRAINING_COSTS));
    }
    const careerCategory = resolveVocabulary(
      input.career_category,
      CAREER_CATEGORIES,
      CAREER_CATEGORY_MATCHING,
    );
    if (careerCategory.unmatched.length > 0) {
      throw ctx.fail(
        'unknown_career_category',
        unknownValueMessage(
          'career_category',
          careerCategory.unmatched,
          CAREER_CATEGORIES,
          CAREER_CATEGORY_MATCHING,
        ),
      );
    }
    // ReliefWeb stores language codes lower-cased, and both fields match case-sensitively.
    const language = input.language?.trim().toLowerCase() || undefined;
    const trainingLanguage = input.training_language?.trim().toLowerCase() || undefined;

    const appliedFilters = {
      ...(input.text?.trim() ? { text: input.text } : {}),
      ...(country ? { country } : {}),
      ...(input.source?.trim() ? { source: input.source } : {}),
      ...(input.format?.trim() ? { format: input.format } : {}),
      ...(careerCategory.value ? { careerCategory: careerCategory.value } : {}),
      ...(language ? { language } : {}),
      ...(cost.value ? { cost: cost.value } : {}),
      ...(trainingLanguage ? { trainingLanguage } : {}),
      ...(dateStartFrom ? { dateStartFrom } : {}),
      ...(dateStartTo ? { dateStartTo } : {}),
      ...(upcomingFrom ? { undatedIncluded: true } : {}),
      sort: input.sort?.trim() || TRAINING_DEFAULT_SORT.join(','),
      preset: input.include_archived ? 'analysis' : 'latest',
      limit: input.limit,
      offset: input.offset,
    };

    const result = await getReliefWebService()
      .searchTraining(
        {
          ...(input.text?.trim() ? { text: input.text } : {}),
          ...(countryCodes ? { country: countryCodes } : {}),
          ...(input.source?.trim() ? { source: input.source } : {}),
          ...(input.format?.trim() ? { format: input.format } : {}),
          ...(careerCategory.value ? { careerCategory: careerCategory.value } : {}),
          ...(language ? { language } : {}),
          ...(cost.value ? { cost: cost.value } : {}),
          ...(trainingLanguage ? { trainingLanguage } : {}),
          ...(explicitStartFrom ? { dateStartFrom: explicitStartFrom } : {}),
          ...(dateStartTo ? { dateStartTo } : {}),
          ...(upcomingFrom ? { upcomingOrUndatedFrom: upcomingFrom } : {}),
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
      if (careerCategory.value) filters.push(`career_category="${careerCategory.value}"`);
      if (language) filters.push(`language=${language}`);
      if (cost.value) filters.push(`cost=${cost.value}`);
      if (trainingLanguage) filters.push(`training_language=${trainingLanguage}`);
      if (explicitStartFrom) filters.push(`start_from=${explicitStartFrom}`);
      if (upcomingFrom) filters.push(`start_from=${upcomingFrom} or no start date`);
      if (dateStartTo) filters.push(`start_to=${dateStartTo}`);
      notice(
        `No training matched ${filters.length > 0 ? filters.join(', ') : 'the given filters'}. Try broader keywords, widen or remove the date range, remove the cost or training_language filter, or set include_archived=true to search concluded listings as well.`,
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
      if (item.countryIso3s?.length)
        lines.push(`**Country ISO3 codes:** ${escapeMarkdownInline(item.countryIso3s.join(', '))}`);
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
  undatedIncluded?: boolean | undefined;
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
  if (f.undatedIncluded != null) parts.push(`undatedIncluded=${f.undatedIncluded}`);
  parts.push(
    `sort=${escapeMarkdownInline(f.sort)}`,
    `preset=${f.preset}`,
    `limit=${f.limit}`,
    `offset=${f.offset}`,
  );
  return `**Applied filters:** ${parts.join(', ')}`;
}
