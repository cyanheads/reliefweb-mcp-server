/**
 * @fileoverview ReliefWeb API v2 service — POST query builder, retry, field selection,
 * normalization helpers for all content types. Non-OK responses are classified and
 * carry ReliefWeb's own error text (see `upstream-errors.ts`).
 * @module services/reliefweb/reliefweb-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import type {
  ContentType,
  CountryArchive,
  CountryDetail,
  CountrySummary,
  CuratedLink,
  DatedCuratedLink,
  DateRangeValue,
  DisasterArchive,
  DisasterDetail,
  DisasterSummary,
  FilterCondition,
  JobDetail,
  JobSummary,
  LinkedDisaster,
  ProfileArchiveEntry,
  ProfileArchiveList,
  RawApiResponse,
  RawCountryFields,
  RawDisasterFields,
  RawJobFields,
  RawRecord,
  RawReportFields,
  RawSourceFields,
  RawTrainingFields,
  ReliefWebQuery,
  ReportDetail,
  ReportSummary,
  SourceSummary,
  TrainingDetail,
  TrainingSummary,
} from './types.js';
import { TRAINING_DEFAULT_SORT } from './types.js';
import { upstreamHttpError } from './upstream-errors.js';

const BASE_URL = 'https://api.reliefweb.int/v2';

// Field selections for list views — trim payload to avoid burning context.
const REPORT_LIST_FIELDS = [
  'id',
  'title',
  'date.original',
  'date.created',
  'primary_country.name',
  'primary_country.iso3',
  'country.name',
  'country.iso3',
  'disaster.id',
  'disaster.name',
  'disaster.glide',
  'source.shortname',
  'format.name',
  'theme.name',
  'language.code',
  'url_alias',
  'file.url',
  'headline.summary',
];

const DISASTER_LIST_FIELDS = [
  'id',
  'name',
  'status',
  'glide',
  'date.event',
  'date.created',
  'primary_country.name',
  'primary_country.iso3',
  'country.name',
  'country.iso3',
  'type.name',
  'primary_type.name',
  'url_alias',
];

const JOB_LIST_FIELDS = [
  'id',
  'title',
  'date.created',
  'date.closing',
  'source.shortname',
  'country.name',
  'country.iso3',
  'theme.name',
  'type.name',
  'career_categories.name',
  'experience.name',
  'url_alias',
];

const TRAINING_LIST_FIELDS = [
  'cost',
  'training_language.code',
  'id',
  'title',
  'date.start',
  'date.end',
  'date.registration',
  'source.shortname',
  'country.name',
  'country.iso3',
  'theme.name',
  'format.name',
  'language.code',
  'career_categories.name',
  'url_alias',
];

const SOURCE_LIST_FIELDS = ['id', 'name', 'shortname', 'type.name', 'url', 'homepage'];

export class ReliefWebService {
  // Config and storage reserved for future use (caching, rate limiting).
  // Currently only getServerConfig() is needed for the appname.
  constructor(_appConfig: AppConfig, _storage: StorageService) {
    // Eagerly validate the appname at construction time so errors surface in setup().
    getServerConfig();
  }

  // ─── Internal fetch ──────────────────────────────────────────────────────────

  private post<T>(
    contentType: ContentType,
    query: ReliefWebQuery,
    ctx: Context,
  ): Promise<RawApiResponse<T>> {
    const appName = getServerConfig().appName;
    const url = `${BASE_URL}/${contentType}?appname=${encodeURIComponent(appName)}`;

    return withRetry(
      async () => {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(query),
          signal: ctx.signal,
        });

        if (!response.ok) {
          throw await upstreamHttpError(response, { contentType });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('ReliefWeb returned HTML — likely rate-limited or blocked.', {
            contentType,
          });
        }

        return JSON.parse(text) as RawApiResponse<T>;
      },
      {
        operation: `reliefweb.${contentType}.post`,
        context: ctx as unknown as import('@cyanheads/mcp-ts-core/utils').RequestContext,
        baseDelayMs: 1_000,
        signal: ctx.signal,
      },
    );
  }

  private get<T>(
    contentType: ContentType,
    id: number,
    profile: 'full' | 'list' | 'minimal',
    ctx: Context,
  ): Promise<RawRecord<T> | null> {
    const appName = getServerConfig().appName;
    const url = `${BASE_URL}/${contentType}/${id}?appname=${encodeURIComponent(appName)}&profile=${profile}${contentType === 'disasters' ? '&preset=analysis' : ''}`;

    return withRetry(
      async () => {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: ctx.signal,
        });

        if (response.status === 404) return null;

        if (!response.ok) {
          throw await upstreamHttpError(response, { contentType, id });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('ReliefWeb returned HTML — likely rate-limited or blocked.', {
            contentType,
            id,
          });
        }

        const parsed = JSON.parse(text) as { data?: RawRecord<T>[] };
        return parsed.data?.[0] ?? null;
      },
      {
        operation: `reliefweb.${contentType}.get`,
        context: ctx as unknown as import('@cyanheads/mcp-ts-core/utils').RequestContext,
        baseDelayMs: 1_000,
        signal: ctx.signal,
      },
    );
  }

  /**
   * Fetches one record by ID through the search endpoint instead of `GET /{type}/{id}`.
   * The item endpoint answers 404 for an expired job or a concluded training — exactly the
   * records `include_archived` makes searchable — while an id-filtered search under
   * `preset: 'analysis'` reaches the current and the archived halves alike.
   */
  private async getByIdQuery<T>(
    contentType: ContentType,
    id: number,
    ctx: Context,
  ): Promise<RawRecord<T> | null> {
    const result = await this.post<T>(
      contentType,
      { filter: { field: 'id', value: id }, profile: 'full', preset: 'analysis', limit: 1 },
      ctx,
    );
    return result.data?.[0] ?? null;
  }

  // ─── Filter builder helpers ──────────────────────────────────────────────────

  private buildAndFilter(conditions: FilterCondition[]): FilterCondition | undefined {
    if (conditions.length === 0) return;
    if (conditions.length === 1) return conditions[0];
    return { operator: 'AND', conditions };
  }

  private mergeFilters(
    builtConditions: FilterCondition[],
    rawFilter: FilterCondition | undefined,
  ): FilterCondition | undefined {
    if (rawFilter && builtConditions.length > 0) {
      return { operator: 'AND', conditions: [...builtConditions, rawFilter] };
    }
    if (rawFilter) return rawFilter;
    return this.buildAndFilter(builtConditions);
  }

  /**
   * Builds a `{ from, to }` range condition. Bounds arrive already resolved to full ISO
   * 8601 datetimes — `resolveDateBound` runs at the tool layer, where the resolved value
   * also feeds `appliedFilters`, so both response paths echo the query that ran.
   */
  private makeDateFilter(
    field: string,
    from: string | undefined,
    to: string | undefined,
  ): FilterCondition {
    const value: DateRangeValue = {};
    if (from) value.from = from;
    if (to) value.to = to;
    return { field, value };
  }

  /**
   * Builds the condition for a list of canonical vocabulary values: the value alone when
   * there is one, else an array combined with `operator`, which must travel with it —
   * ReliefWeb ORs an array that carries none.
   */
  private makeListFilter(field: string, values: string[], operator: 'AND' | 'OR'): FilterCondition {
    return values.length === 1
      ? { field, value: values[0] as string }
      : { field, value: values, operator };
  }

  /**
   * Content tagged with every listed country. The analyzed `country.iso3` drops English
   * stopwords, so `ARE` (United Arab Emirates) and `AND` (Andorra) match nothing there; the
   * un-analyzed `.exact` subfield matches every code, and it stores them lower-cased.
   */
  private countryFilter(codes: string[]): FilterCondition {
    return this.makeListFilter(
      'country.iso3.exact',
      codes.map((code) => code.toLowerCase()),
      'AND',
    );
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  async searchReports(
    params: {
      text?: string;
      /** ISO3 codes, uppercase; several match content tagged with every one. */
      country?: string[];
      disasterId?: number;
      format?: string;
      /** Canonical names, comma-joined; several match reports carrying every one. */
      theme?: string;
      language?: string;
      source?: string;
      dateFrom?: string;
      dateTo?: string;
      sort?: string;
      rawFilter?: FilterCondition;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<{ items: ReportSummary[]; totalCount: number }> {
    ctx.log.debug('searchReports', { params });

    const conditions: FilterCondition[] = [];
    if (params.country) conditions.push(this.countryFilter(params.country));
    if (params.disasterId !== undefined)
      conditions.push({ field: 'disaster.id', value: params.disasterId });
    if (params.format) conditions.push({ field: 'format.name', value: params.format });
    /**
     * Whole tags on the `.exact` subfield: the analyzed `theme.name` matches each word of
     * the value against any tag, so `Coordination` there also returns every report tagged
     * Camp Coordination and Camp Management.
     */
    if (params.theme)
      conditions.push(this.makeListFilter('theme.name.exact', params.theme.split(','), 'AND'));
    if (params.language) conditions.push({ field: 'language.code', value: params.language });
    if (params.source) conditions.push({ field: 'source.shortname', value: params.source });
    if (params.dateFrom || params.dateTo) {
      conditions.push(this.makeDateFilter('date.original', params.dateFrom, params.dateTo));
    }

    const filter = this.mergeFilters(conditions, params.rawFilter);
    const query: ReliefWebQuery = {
      fields: { include: REPORT_LIST_FIELDS },
      ...(filter ? { filter } : {}),
      sort: [params.sort ?? 'date.original:desc'],
      /**
       * Reports carry no archived class — `latest`, `minimal`, and `analysis` all return
       * the same 1.14M records, and the whole-corpus `status` facet holds only `published`
       * and `to-review`, neither of which any preset excludes. So there is no archive to
       * unlock here and no preset to choose between.
       */
      preset: 'latest',
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
    if (params.text) query.query = { value: params.text, operator: 'AND' };

    const result = await this.post<RawReportFields>('reports', query, ctx);
    return {
      items: (result.data ?? []).map((r) => normalizeReportSummary(r.fields, r.id)),
      totalCount: result.totalCount,
    };
  }

  async getReport(id: number, ctx: Context): Promise<ReportDetail | null> {
    ctx.log.debug('getReport', { id });
    const record = await this.get<RawReportFields>('reports', id, 'full', ctx);
    if (!record) return null;
    return normalizeReportDetail(record.fields, record.id);
  }

  // ─── Disasters ───────────────────────────────────────────────────────────────

  async searchDisasters(
    params: {
      text?: string;
      /** ISO3 codes, uppercase; several match content tagged with every one. */
      country?: string[];
      disasterType?: string;
      status?: string;
      glide?: string;
      dateFrom?: string;
      dateTo?: string;
      sort?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<{ items: DisasterSummary[]; totalCount: number }> {
    ctx.log.debug('searchDisasters', { params });

    const conditions: FilterCondition[] = [];
    if (params.country) conditions.push(this.countryFilter(params.country));
    if (params.disasterType) conditions.push({ field: 'type.name', value: params.disasterType });
    if (params.status) {
      const values = params.status
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      conditions.push({
        field: 'status',
        value: values.length === 1 ? (values[0] as string) : values,
      });
    }
    if (params.glide) conditions.push({ field: 'glide', value: params.glide });
    if (params.dateFrom || params.dateTo) {
      conditions.push(this.makeDateFilter('date.created', params.dateFrom, params.dateTo));
    }

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: DISASTER_LIST_FIELDS },
      ...(filter ? { filter } : {}),
      sort: [params.sort ?? 'date.created:desc'],
      preset: params.includeArchived ? 'analysis' : 'latest',
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
    if (params.text) query.query = { value: params.text, operator: 'AND' };

    const result = await this.post<RawDisasterFields>('disasters', query, ctx);
    return {
      items: (result.data ?? []).map((r) => normalizeDisasterSummary(r.fields, r.id)),
      totalCount: result.totalCount,
    };
  }

  async getDisaster(id: number, ctx: Context): Promise<DisasterDetail | null> {
    ctx.log.debug('getDisaster', { id });
    const record = await this.get<RawDisasterFields>('disasters', id, 'full', ctx);
    if (!record) return null;
    return normalizeDisasterDetail(record.fields, record.id);
  }

  /** The archived half of one curated profile list on a disaster. See `getCountryArchive`. */
  async getDisasterArchive(
    id: number,
    list: ProfileArchiveList,
    ctx: Context,
  ): Promise<DisasterArchive | null> {
    ctx.log.debug('getDisasterArchive', { id, list });
    const record = await this.get<RawDisasterFields>('disasters', id, 'full', ctx);
    if (!record) return null;
    return {
      ...normalizeDisasterSummary(record.fields, record.id),
      entries: profileArchiveEntries(record.fields.profile, list),
    };
  }

  // ─── Countries ───────────────────────────────────────────────────────────────

  private async fetchCountryRecord(
    iso3: string,
    ctx: Context,
  ): Promise<RawRecord<RawCountryFields> | null> {
    const query: ReliefWebQuery = {
      // The exact field, lower-cased as stored: the analyzed `iso3` drops ARE and AND as stopwords.
      filter: { field: 'iso3.exact', value: iso3.toLowerCase() },
      profile: 'full',
      limit: 1,
    };
    const result = await this.post<RawCountryFields>('countries', query, ctx);
    return result.data?.[0] ?? null;
  }

  async getCountry(iso3: string, ctx: Context): Promise<CountryDetail | null> {
    ctx.log.debug('getCountry', { iso3 });
    const record = await this.fetchCountryRecord(iso3, ctx);
    if (!record) return null;
    return normalizeCountryDetail(record.fields, record.id);
  }

  /**
   * The archived half of one curated profile list, whole. `getCountry` drops it to keep the
   * default profile bounded; this returns every archived entry so the caller can page it.
   * Same upstream call as `getCountry` — the archive travels in the `profile=full` record
   * already, so reaching it costs nothing extra against the daily quota.
   */
  async getCountryArchive(
    iso3: string,
    list: ProfileArchiveList,
    ctx: Context,
  ): Promise<CountryArchive | null> {
    ctx.log.debug('getCountryArchive', { iso3, list });
    const record = await this.fetchCountryRecord(iso3, ctx);
    if (!record) return null;
    return {
      ...normalizeCountrySummary(record.fields, record.id),
      entries: profileArchiveEntries(record.fields.profile, list),
    };
  }

  async listCountries(
    params: { text?: string; crisisOnly?: boolean; limit?: number; offset?: number },
    ctx: Context,
  ): Promise<{ items: CountrySummary[]; totalCount: number }> {
    ctx.log.debug('listCountries', { params });

    const conditions: FilterCondition[] = [];
    if (params.crisisOnly) {
      conditions.push({ field: 'status', value: ['ongoing'], operator: 'OR' });
    }

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: ['id', 'name', 'iso3', 'status', 'url_alias'] },
      ...(filter ? { filter } : {}),
      sort: ['name:asc'],
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    };
    if (params.text) {
      query.query = { value: params.text, operator: 'AND', fields: ['name', 'shortname'] };
    }

    const result = await this.post<RawCountryFields>('countries', query, ctx);
    return {
      items: (result.data ?? []).map((r) => normalizeCountrySummary(r.fields, r.id)),
      totalCount: result.totalCount,
    };
  }

  // ─── Jobs ────────────────────────────────────────────────────────────────────

  async searchJobs(
    params: {
      text?: string;
      /** ISO3 codes, uppercase; several match content tagged with every one. */
      country?: string[];
      source?: string;
      /** Canonical names, comma-joined; several match postings carrying every one. */
      careerCategory?: string;
      /** Canonical names, comma-joined; several match postings carrying every one. */
      theme?: string;
      /** Canonical names, comma-joined; several match postings of any of those types. */
      jobType?: string;
      experience?: string;
      sort?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<{ items: JobSummary[]; totalCount: number }> {
    ctx.log.debug('searchJobs', { params });

    const conditions: FilterCondition[] = [];
    if (params.country) conditions.push(this.countryFilter(params.country));
    if (params.source) conditions.push({ field: 'source.shortname', value: params.source });
    if (params.careerCategory)
      conditions.push(
        this.makeListFilter(
          'career_categories.name.exact',
          params.careerCategory.split(','),
          'AND',
        ),
      );
    if (params.theme)
      conditions.push(this.makeListFilter('theme.name.exact', params.theme.split(','), 'AND'));
    // Each type's words are its own, so the analyzed field already matches whole types.
    if (params.jobType)
      conditions.push(this.makeListFilter('type.name', params.jobType.split(','), 'OR'));
    if (params.experience) conditions.push({ field: 'experience.name', value: params.experience });

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: JOB_LIST_FIELDS },
      ...(filter ? { filter } : {}),
      sort: [params.sort ?? 'date.created:desc'],
      /**
       * `latest` serves only the currently-open postings; the expired ones — two orders of
       * magnitude more of them — live behind `analysis`. Same split as disasters.
       */
      preset: params.includeArchived ? 'analysis' : 'latest',
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
    if (params.text) query.query = { value: params.text, operator: 'AND' };

    const result = await this.post<RawJobFields>('jobs', query, ctx);
    return {
      items: (result.data ?? []).map((r) => normalizeJobSummary(r.fields, r.id)),
      totalCount: result.totalCount,
    };
  }

  async getJob(id: number, ctx: Context): Promise<JobDetail | null> {
    ctx.log.debug('getJob', { id });
    const record = await this.getByIdQuery<RawJobFields>('jobs', id, ctx);
    if (!record) return null;
    return normalizeJobDetail(record.fields, record.id);
  }

  // ─── Training ────────────────────────────────────────────────────────────────

  async searchTraining(
    params: {
      cost?: string;
      trainingLanguage?: string;
      text?: string;
      /** ISO3 codes, uppercase; several match content tagged with every one. */
      country?: string[];
      source?: string;
      format?: string;
      /** Canonical names, comma-joined; several match listings carrying every one. */
      careerCategory?: string;
      language?: string;
      dateStartFrom?: string;
      dateStartTo?: string;
      /**
       * The default scope: listings starting at or after this bound, plus every listing with
       * no start date. `dateStartFrom` stays a plain range, which leaves undated listings out.
       */
      upcomingOrUndatedFrom?: string;
      sort?: string;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<{ items: TrainingSummary[]; totalCount: number }> {
    ctx.log.debug('searchTraining', { params });

    const conditions: FilterCondition[] = [];
    if (params.cost) conditions.push({ field: 'cost', value: params.cost });
    if (params.trainingLanguage)
      conditions.push({ field: 'training_language.code', value: params.trainingLanguage });
    if (params.country) conditions.push(this.countryFilter(params.country));
    if (params.source) conditions.push({ field: 'source.shortname', value: params.source });
    if (params.format) conditions.push({ field: 'format.name', value: params.format });
    if (params.careerCategory)
      conditions.push(
        this.makeListFilter(
          'career_categories.name.exact',
          params.careerCategory.split(','),
          'AND',
        ),
      );
    if (params.language) conditions.push({ field: 'language.code', value: params.language });
    if (params.dateStartFrom || params.dateStartTo) {
      conditions.push(this.makeDateFilter('date.start', params.dateStartFrom, params.dateStartTo));
    }
    if (params.upcomingOrUndatedFrom) {
      /**
       * A range on date.start excludes every record without one — most current listings,
       * nearly all of them online courses — so the default scope ORs in the missing case.
       */
      conditions.push({
        operator: 'OR',
        conditions: [
          this.makeDateFilter('date.start', params.upcomingOrUndatedFrom, undefined),
          { field: 'date.start', negate: true },
        ],
      });
    }

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: TRAINING_LIST_FIELDS },
      ...(filter ? { filter } : {}),
      sort: params.sort ? [params.sort] : [...TRAINING_DEFAULT_SORT],
      /** `latest` serves the current listings; the concluded ones live behind `analysis`. */
      preset: params.includeArchived ? 'analysis' : 'latest',
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
    if (params.text) query.query = { value: params.text, operator: 'AND' };

    const result = await this.post<RawTrainingFields>('training', query, ctx);
    return {
      items: (result.data ?? []).map((r) => normalizeTrainingSummary(r.fields, r.id)),
      totalCount: result.totalCount,
    };
  }

  async getTraining(id: number, ctx: Context): Promise<TrainingDetail | null> {
    ctx.log.debug('getTraining', { id });
    const record = await this.getByIdQuery<RawTrainingFields>('training', id, ctx);
    if (!record) return null;
    return normalizeTrainingDetail(record.fields, record.id);
  }

  // ─── Sources ─────────────────────────────────────────────────────────────────

  async listSources(
    params: { text?: string; type?: string; limit?: number; offset?: number },
    ctx: Context,
  ): Promise<{ items: SourceSummary[]; totalCount: number }> {
    ctx.log.debug('listSources', { params });

    const conditions: FilterCondition[] = [];
    if (params.type) conditions.push({ field: 'type.name', value: params.type });

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: SOURCE_LIST_FIELDS },
      ...(filter ? { filter } : {}),
      sort: ['name:asc'],
      preset: 'minimal',
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    };
    if (params.text) {
      query.query = { value: params.text, operator: 'AND', fields: ['name', 'shortname'] };
    }

    const result = await this.post<RawSourceFields>('sources', query, ctx);
    return {
      items: (result.data ?? []).map((r) => normalizeSourceSummary(r.fields, r.id)),
      totalCount: result.totalCount,
    };
  }
}

// ─── Init/accessor pattern ────────────────────────────────────────────────────

let _service: ReliefWebService | undefined;

export function initReliefWebService(config: AppConfig, storage: StorageService): void {
  _service = new ReliefWebService(config, storage);
}

export function getReliefWebService(): ReliefWebService {
  if (!_service) {
    throw new Error('ReliefWebService not initialized — call initReliefWebService() in setup()');
  }
  return _service;
}

// ─── Normalization helpers ────────────────────────────────────────────────────

type LinkEntry = { title?: string; url?: string };
type LinkWithDate = LinkEntry & { date?: string };

/**
 * Curated entries link to a report through its node URL, sometimes still carrying the
 * editor's `/edit` suffix, and the node ID is the report ID. The match is whole and strict:
 * a `/report/<country>/<slug>` alias also names a report, but only a lookup can say which.
 */
const REPORT_NODE_URL = /^https:\/\/reliefweb\.int\/node\/([1-9]\d*)(?:\/edit)?$/;

/** The report ID a curated URL names, read from the URL and never looked up. */
function reportIdFromUrl(url: string): number | undefined {
  const digits = REPORT_NODE_URL.exec(url)?.[1];
  if (digits === undefined) return;
  const id = Number(digits);
  return Number.isSafeInteger(id) ? id : undefined;
}

/**
 * One curated entry, or none when it has no title or no URL — an entry that cannot be linked
 * is not a retrievable entry. Every curated list, active or archived, is read through here.
 */
function curatedLink(item: LinkEntry): CuratedLink | undefined {
  if (!item.title || !item.url) return;
  const reportId = reportIdFromUrl(item.url);
  return { title: item.title, url: item.url, ...(reportId === undefined ? {} : { reportId }) };
}

function datedCuratedLink(item: LinkWithDate): DatedCuratedLink | undefined {
  const link = curatedLink(item);
  return link && item.date ? { ...link, date: item.date } : link;
}

function normalizeLinks(items: LinkEntry[] | undefined): CuratedLink[] | undefined {
  const out = items?.flatMap((item) => curatedLink(item) ?? []);
  return out?.length ? out : undefined;
}

function normalizeDatedLinks(items: LinkWithDate[] | undefined): DatedCuratedLink[] | undefined {
  const out = items?.flatMap((item) => datedCuratedLink(item) ?? []);
  return out?.length ? out : undefined;
}

/**
 * Uppercased ISO3 codes of a country list, or none when no entry carries one. ReliefWeb sends
 * them lowercase; every country input and every code this server returns is uppercase.
 */
function iso3Codes(countries: Array<{ iso3?: string }> | undefined): string[] | undefined {
  const codes = countries?.flatMap((c) => (c.iso3 ? [c.iso3.toUpperCase()] : []));
  return codes?.length ? codes : undefined;
}

/**
 * The disasters a report is tagged with, in the form `reliefweb_get_disaster` and the
 * `disaster_id` filter take. Their status is the disaster record's to report; an entry with no
 * ID or no name gives the caller nothing to follow, so it is dropped.
 */
function linkedDisasters(raw: RawReportFields['disaster']): LinkedDisaster[] | undefined {
  const out = raw?.flatMap((d) =>
    d.id && d.name ? [{ id: d.id, name: d.name, ...(d.glide ? { glide: d.glide } : {}) }] : [],
  );
  return out?.length ? out : undefined;
}

/** Domain list name → the raw API key that holds it. */
const ARCHIVE_RAW_KEY = {
  keyContent: 'key_content',
  appealsResponsePlans: 'appeals_response_plans',
  usefulLinks: 'useful_links',
} as const satisfies Record<ProfileArchiveList, keyof NonNullable<RawCountryFields['profile']>>;

/**
 * Every archived entry of one curated list, in ReliefWeb's own archive order, read by the
 * same rule as the active half. Country and disaster profiles carry the identical sub-object
 * shape, so one function serves both.
 */
function profileArchiveEntries(
  profile: RawCountryFields['profile'] | RawDisasterFields['profile'],
  list: ProfileArchiveList,
): ProfileArchiveEntry[] {
  const raw: LinkWithDate[] = profile?.[ARCHIVE_RAW_KEY[list]]?.archive ?? [];
  return raw.flatMap((item) => datedCuratedLink(item) ?? []);
}

function normalizeReportSummary(f: RawReportFields, id: number): ReportSummary {
  const r: ReportSummary = { id: f.id ?? id, title: f.title ?? '(untitled)' };
  if (f.date?.original) r.dateOriginal = f.date.original;
  if (f.date?.created) r.dateCreated = f.date.created;
  if (f.primary_country?.name) r.primaryCountry = f.primary_country.name;
  if (f.primary_country?.iso3) r.primaryCountryIso3 = f.primary_country.iso3.toUpperCase();
  if (f.country?.length) r.countries = f.country.map((c) => c.name ?? '').filter(Boolean);
  const countryIso3s = iso3Codes(f.country);
  if (countryIso3s) r.countryIso3s = countryIso3s;
  const disasters = linkedDisasters(f.disaster);
  if (disasters) r.disasters = disasters;
  if (f.source?.length)
    r.sources = f.source.map((s) => s.shortname ?? s.name ?? '').filter(Boolean);
  if (f.format?.length) r.formats = f.format.map((x) => x.name ?? '').filter(Boolean);
  if (f.theme?.length) r.themes = f.theme.map((x) => x.name ?? '').filter(Boolean);
  if (f.language?.length) r.languages = f.language.map((x) => x.code ?? '').filter(Boolean);
  if (f.url_alias) r.urlAlias = f.url_alias;
  if (f.file?.length) r.fileUrls = f.file.map((x) => x.url ?? '').filter(Boolean);
  if (f.headline?.summary) r.headlineSummary = f.headline.summary;
  return r;
}

function normalizeReportDetail(f: RawReportFields, id: number): ReportDetail {
  const summary = normalizeReportSummary(f, id);
  if (f.body) return { ...summary, body: f.body };
  return summary;
}

function normalizeDisasterSummary(f: RawDisasterFields, id: number): DisasterSummary {
  const r: DisasterSummary = { id: f.id ?? id, name: f.name ?? '(unnamed)' };
  if (f.status) r.status = f.status;
  if (f.glide) r.glide = f.glide;
  if (f.date?.event) r.dateEvent = f.date.event;
  if (f.date?.created) r.dateCreated = f.date.created;
  if (f.primary_country?.name) r.primaryCountry = f.primary_country.name;
  if (f.primary_country?.iso3) r.primaryCountryIso3 = f.primary_country.iso3.toUpperCase();
  if (f.country?.length) r.countries = f.country.map((c) => c.name ?? '').filter(Boolean);
  const countryIso3s = iso3Codes(f.country);
  if (countryIso3s) r.countryIso3s = countryIso3s;
  if (f.type?.length) r.types = f.type.map((t) => t.name ?? '').filter(Boolean);
  if (f.primary_type?.name) r.primaryType = f.primary_type.name;
  if (f.url_alias) r.urlAlias = f.url_alias;
  return r;
}

function normalizeDisasterDetail(f: RawDisasterFields, id: number): DisasterDetail {
  const r: DisasterDetail = { ...normalizeDisasterSummary(f, id) };
  if (f.description) r.description = f.description;
  /**
   * Most disasters store the overview as a byte-identical copy of the description; the rest
   * store it as a prefix the description extends with legacy link lists. A copy is flagged
   * rather than repeated, so it costs neither response bytes nor outline budget. A prefix is
   * kept whole: the record carries no offset to split the description at.
   */
  const overview = f.profile?.overview;
  if (overview && overview === f.description) r.profileOverviewSameAsDescription = true;
  else if (overview) r.profileOverview = overview;
  // Active set only — drop the archive half (see normalizeCountryDetail for the rationale).
  const kc = normalizeLinks(f.profile?.key_content?.active);
  if (kc) r.keyContent = kc;
  const ap = normalizeDatedLinks(f.profile?.appeals_response_plans?.active);
  if (ap) r.appealsResponsePlans = ap;
  const ul = normalizeLinks(f.profile?.useful_links?.active);
  if (ul) r.usefulLinks = ul;
  return r;
}

function normalizeCountrySummary(f: RawCountryFields, id: number): CountrySummary {
  const r: CountrySummary = { id: f.id ?? id, name: f.name ?? '(unnamed)' };
  if (f.iso3) r.iso3 = f.iso3.toUpperCase();
  if (f.status) r.status = f.status;
  if (f.url_alias) r.urlAlias = f.url_alias;
  return r;
}

function normalizeCountryDetail(f: RawCountryFields, id: number): CountryDetail {
  const r: CountryDetail = { ...normalizeCountrySummary(f, id) };
  if (f.profile?.overview) r.profileOverview = f.profile.overview;
  /**
   * Active set only — the archive runs to thousands of entries for long-running
   * crises (e.g. SYR key_content: 3 active vs 2,300+ archived) and blows the client
   * token budget. keyContent reflects what ReliefWeb currently curates, not its full history.
   */
  const kc = normalizeLinks(f.profile?.key_content?.active);
  if (kc) r.keyContent = kc;
  const ap = normalizeDatedLinks(f.profile?.appeals_response_plans?.active);
  if (ap) r.appealsResponsePlans = ap;
  const ul = normalizeLinks(f.profile?.useful_links?.active);
  if (ul) r.usefulLinks = ul;
  return r;
}

function normalizeJobSummary(f: RawJobFields, id: number): JobSummary {
  const r: JobSummary = { id: f.id ?? id, title: f.title ?? '(untitled)' };
  if (f.date?.created) r.dateCreated = f.date.created;
  if (f.date?.closing) r.dateClosing = f.date.closing;
  if (f.source?.length)
    r.sources = f.source.map((s) => s.shortname ?? s.name ?? '').filter(Boolean);
  if (f.country?.length) r.countries = f.country.map((c) => c.name ?? '').filter(Boolean);
  const countryIso3s = iso3Codes(f.country);
  if (countryIso3s) r.countryIso3s = countryIso3s;
  if (f.theme?.length) r.themes = f.theme.map((t) => t.name ?? '').filter(Boolean);
  if (f.type?.length) r.types = f.type.map((t) => t.name ?? '').filter(Boolean);
  if (f.career_categories?.length)
    r.careerCategories = f.career_categories.map((c) => c.name ?? '').filter(Boolean);
  if (f.experience?.length)
    r.experienceLevels = f.experience.map((e) => e.name ?? '').filter(Boolean);
  if (f.url_alias) r.urlAlias = f.url_alias;
  return r;
}

function normalizeJobDetail(f: RawJobFields, id: number): JobDetail {
  const r: JobDetail = { ...normalizeJobSummary(f, id) };
  if (f.status) r.status = f.status;
  if (f.date?.changed) r.dateChanged = f.date.changed;
  if (f.body) r.body = f.body;
  if (f.how_to_apply) r.howToApply = f.how_to_apply;
  if (f.url) r.url = f.url;
  return r;
}

function normalizeTrainingSummary(f: RawTrainingFields, id: number): TrainingSummary {
  const r: TrainingSummary = { id: f.id ?? id, title: f.title ?? '(untitled)' };
  if (f.cost) r.cost = f.cost;
  if (f.training_language?.length) {
    r.trainingLanguages = f.training_language.map((l) => l.code ?? '').filter(Boolean);
  }
  if (f.date?.start) r.dateStart = f.date.start;
  if (f.date?.end) r.dateEnd = f.date.end;
  if (f.date?.registration) r.dateRegistration = f.date.registration;
  if (f.source?.length)
    r.sources = f.source.map((s) => s.shortname ?? s.name ?? '').filter(Boolean);
  if (f.country?.length) r.countries = f.country.map((c) => c.name ?? '').filter(Boolean);
  const countryIso3s = iso3Codes(f.country);
  if (countryIso3s) r.countryIso3s = countryIso3s;
  if (f.theme?.length) r.themes = f.theme.map((t) => t.name ?? '').filter(Boolean);
  if (f.format?.length) r.formats = f.format.map((x) => x.name ?? '').filter(Boolean);
  if (f.language?.length) r.languages = f.language.map((l) => l.code ?? '').filter(Boolean);
  if (f.career_categories?.length)
    r.careerCategories = f.career_categories.map((c) => c.name ?? '').filter(Boolean);
  if (f.url_alias) r.urlAlias = f.url_alias;
  return r;
}

function normalizeTrainingDetail(f: RawTrainingFields, id: number): TrainingDetail {
  const r: TrainingDetail = { ...normalizeTrainingSummary(f, id) };
  if (f.status) r.status = f.status;
  if (f.date?.created) r.dateCreated = f.date.created;
  if (f.city?.length) r.cities = f.city.map((c) => c.name ?? '').filter(Boolean);
  if (f.type?.length) r.types = f.type.map((t) => t.name ?? '').filter(Boolean);
  if (f.body) r.body = f.body;
  if (f.how_to_register) r.howToRegister = f.how_to_register;
  if (f.event_url) r.eventUrl = f.event_url;
  if (f.fee_information) r.feeInformation = f.fee_information;
  if (f.url) r.url = f.url;
  return r;
}

function normalizeSourceSummary(f: RawSourceFields, id: number): SourceSummary {
  const r: SourceSummary = { id: f.id ?? id, name: f.name ?? '(unnamed)' };
  if (f.shortname) r.shortname = f.shortname;
  if (f.type?.name) r.types = [f.type.name];
  if (f.url) r.url = f.url;
  if (f.homepage) r.homepage = f.homepage;
  return r;
}
