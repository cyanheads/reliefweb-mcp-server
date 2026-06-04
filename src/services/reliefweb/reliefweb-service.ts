/**
 * @fileoverview ReliefWeb API v2 service — POST query builder, retry, field selection,
 * normalization helpers for all content types.
 * @module services/reliefweb/reliefweb-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import type {
  ContentType,
  CountryDetail,
  CountrySummary,
  DisasterDetail,
  DisasterSummary,
  FilterCondition,
  JobSummary,
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
  TrainingSummary,
} from './types.js';

const BASE_URL = 'https://api.reliefweb.int/v2';

// Field selections for list views — trim payload to avoid burning context.
const REPORT_LIST_FIELDS = [
  'id',
  'title',
  'date.original',
  'date.created',
  'primary_country.name',
  'country.name',
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
  'country.name',
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
  'theme.name',
  'type.name',
  'career_categories.name',
  'experience.name',
  'url_alias',
];

const TRAINING_LIST_FIELDS = [
  'id',
  'title',
  'date.start',
  'date.end',
  'date.registration',
  'source.shortname',
  'country.name',
  'theme.name',
  'format.name',
  'language.code',
  'career_categories.name',
  'url_alias',
];

const SOURCE_LIST_FIELDS = ['id', 'name', 'shortname', 'type.name', 'url', 'homepage'];

// Date range filter shape — separate from FilterCondition to keep the type honest.
interface DateRangeValue {
  from?: string;
  to?: string;
}

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
          throw await httpErrorFromResponse(response, {
            service: 'ReliefWeb',
            data: { contentType, url },
          });
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
    const url = `${BASE_URL}/${contentType}/${id}?appname=${encodeURIComponent(appName)}&profile=${profile}`;

    return withRetry(
      async () => {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: ctx.signal,
        });

        if (response.status === 404) return null;

        if (!response.ok) {
          throw await httpErrorFromResponse(response, {
            service: 'ReliefWeb',
            data: { contentType, id, url },
          });
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

  private makeDateFilter(
    field: string,
    from: string | undefined,
    to: string | undefined,
  ): FilterCondition {
    const value: DateRangeValue = {};
    if (from) value.from = from;
    if (to) value.to = to;
    return { field, value } as FilterCondition;
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  async searchReports(
    params: {
      text?: string;
      country?: string;
      disasterId?: number;
      format?: string;
      theme?: string;
      language?: string;
      source?: string;
      dateFrom?: string;
      dateTo?: string;
      sort?: string;
      includeArchived?: boolean;
      rawFilter?: FilterCondition;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<{ items: ReportSummary[]; totalCount: number }> {
    ctx.log.debug('searchReports', { params });

    const conditions: FilterCondition[] = [];
    if (params.country) conditions.push({ field: 'primary_country.iso3', value: params.country });
    if (params.disasterId) conditions.push({ field: 'disaster.id', value: params.disasterId });
    if (params.format) conditions.push({ field: 'format.name', value: params.format });
    if (params.theme) conditions.push({ field: 'theme.name', value: params.theme });
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
      preset: params.includeArchived ? 'analysis' : 'latest',
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
      country?: string;
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
    if (params.country) conditions.push({ field: 'primary_country.iso3', value: params.country });
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

  // ─── Countries ───────────────────────────────────────────────────────────────

  async getCountry(iso3: string, ctx: Context): Promise<CountryDetail | null> {
    ctx.log.debug('getCountry', { iso3 });

    const query: ReliefWebQuery = {
      filter: { field: 'iso3', value: iso3.toUpperCase() },
      profile: 'full',
      limit: 1,
    };

    const result = await this.post<RawCountryFields>('countries', query, ctx);
    const record = result.data?.[0];
    if (!record) return null;
    return normalizeCountryDetail(record.fields, record.id);
  }

  async listCountries(
    params: { crisisOnly?: boolean; limit?: number; offset?: number },
    ctx: Context,
  ): Promise<{ items: CountrySummary[]; totalCount: number }> {
    ctx.log.debug('listCountries', { params });

    const conditions: FilterCondition[] = [];
    if (params.crisisOnly) {
      conditions.push({ field: 'status', value: ['alert', 'current'], operator: 'OR' });
    }

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: ['id', 'name', 'iso3', 'status', 'url_alias'] },
      ...(filter ? { filter } : {}),
      sort: ['name:asc'],
      limit: params.limit ?? 100,
      offset: params.offset ?? 0,
    };

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
      country?: string;
      source?: string;
      careerCategory?: string;
      theme?: string;
      experience?: string;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<{ items: JobSummary[]; totalCount: number }> {
    ctx.log.debug('searchJobs', { params });

    const conditions: FilterCondition[] = [];
    if (params.country) conditions.push({ field: 'country.iso3', value: params.country });
    if (params.source) conditions.push({ field: 'source.shortname', value: params.source });
    if (params.careerCategory)
      conditions.push({ field: 'career_categories.name', value: params.careerCategory });
    if (params.theme) conditions.push({ field: 'theme.name', value: params.theme });
    if (params.experience) conditions.push({ field: 'experience.name', value: params.experience });

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: JOB_LIST_FIELDS },
      ...(filter ? { filter } : {}),
      sort: ['date.created:desc'],
      preset: 'latest',
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

  // ─── Training ────────────────────────────────────────────────────────────────

  async searchTraining(
    params: {
      text?: string;
      country?: string;
      source?: string;
      format?: string;
      careerCategory?: string;
      language?: string;
      dateStartFrom?: string;
      dateStartTo?: string;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<{ items: TrainingSummary[]; totalCount: number }> {
    ctx.log.debug('searchTraining', { params });

    const conditions: FilterCondition[] = [];
    if (params.country) conditions.push({ field: 'country.iso3', value: params.country });
    if (params.source) conditions.push({ field: 'source.shortname', value: params.source });
    if (params.format) conditions.push({ field: 'format.name', value: params.format });
    if (params.careerCategory)
      conditions.push({ field: 'career_categories.name', value: params.careerCategory });
    if (params.language) conditions.push({ field: 'language.code', value: params.language });
    if (params.dateStartFrom || params.dateStartTo) {
      conditions.push(this.makeDateFilter('date.start', params.dateStartFrom, params.dateStartTo));
    }

    const filter = this.buildAndFilter(conditions);
    const query: ReliefWebQuery = {
      fields: { include: TRAINING_LIST_FIELDS },
      ...(filter ? { filter } : {}),
      sort: ['date.created:desc'],
      preset: 'latest',
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
    if (params.text) query.query = { value: params.text, operator: 'AND' };

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

function normalizeLinks(
  items: Array<LinkEntry> | undefined,
): Array<{ title: string; url: string }> | undefined {
  const out = items?.flatMap((item) =>
    item.title && item.url ? [{ title: item.title, url: item.url }] : [],
  );
  return out?.length ? out : undefined;
}

function normalizeDatedLinks(
  items: Array<LinkWithDate> | undefined,
): Array<{ title: string; url: string; date?: string }> | undefined {
  const out = items?.flatMap((item) => {
    if (!item.title || !item.url) return [];
    return [{ title: item.title, url: item.url, ...(item.date ? { date: item.date } : {}) }];
  });
  return out?.length ? out : undefined;
}

function normalizeReportSummary(f: RawReportFields, id: number): ReportSummary {
  const r: ReportSummary = { id: f.id ?? id, title: f.title ?? '(untitled)' };
  if (f.date?.original) r.dateOriginal = f.date.original;
  if (f.date?.created) r.dateCreated = f.date.created;
  if (f.primary_country?.name) r.primaryCountry = f.primary_country.name;
  if (f.country?.length) r.countries = f.country.map((c) => c.name ?? '').filter(Boolean);
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
  if (f.country?.length) r.countries = f.country.map((c) => c.name ?? '').filter(Boolean);
  if (f.type?.length) r.types = f.type.map((t) => t.name ?? '').filter(Boolean);
  if (f.primary_type?.name) r.primaryType = f.primary_type.name;
  if (f.url_alias) r.urlAlias = f.url_alias;
  return r;
}

function normalizeDisasterDetail(f: RawDisasterFields, id: number): DisasterDetail {
  const r: DisasterDetail = { ...normalizeDisasterSummary(f, id) };
  if (f.description) r.description = f.description;
  if (f.profile?.overview) r.profileOverview = f.profile.overview;
  const kcField = f.profile?.key_content;
  const kc = normalizeLinks([...(kcField?.active ?? []), ...(kcField?.archive ?? [])]);
  if (kc) r.keyContent = kc;
  const apField = f.profile?.appeals_response_plans;
  const ap = normalizeDatedLinks([...(apField?.active ?? []), ...(apField?.archive ?? [])]);
  if (ap) r.appealsResponsePlans = ap;
  const ulField = f.profile?.useful_links;
  const ul = normalizeLinks([...(ulField?.active ?? []), ...(ulField?.archive ?? [])]);
  if (ul) r.usefulLinks = ul;
  return r;
}

function normalizeCountrySummary(f: RawCountryFields, id: number): CountrySummary {
  const r: CountrySummary = { id: f.id ?? id, name: f.name ?? '(unnamed)' };
  if (f.iso3) r.iso3 = f.iso3;
  if (f.status) r.status = f.status;
  if (f.url_alias) r.urlAlias = f.url_alias;
  return r;
}

function normalizeCountryDetail(f: RawCountryFields, id: number): CountryDetail {
  const r: CountryDetail = { ...normalizeCountrySummary(f, id) };
  if (f.profile?.overview) r.profileOverview = f.profile.overview;
  const kcField = f.profile?.key_content;
  const kc = normalizeLinks([...(kcField?.active ?? []), ...(kcField?.archive ?? [])]);
  if (kc) r.keyContent = kc;
  const apField = f.profile?.appeals_response_plans;
  const ap = normalizeDatedLinks([...(apField?.active ?? []), ...(apField?.archive ?? [])]);
  if (ap) r.appealsResponsePlans = ap;
  const ulField = f.profile?.useful_links;
  const ul = normalizeLinks([...(ulField?.active ?? []), ...(ulField?.archive ?? [])]);
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
  if (f.theme?.length) r.themes = f.theme.map((t) => t.name ?? '').filter(Boolean);
  if (f.type?.length) r.types = f.type.map((t) => t.name ?? '').filter(Boolean);
  if (f.career_categories?.length)
    r.careerCategories = f.career_categories.map((c) => c.name ?? '').filter(Boolean);
  if (f.experience?.length)
    r.experienceLevels = f.experience.map((e) => e.name ?? '').filter(Boolean);
  if (f.url_alias) r.urlAlias = f.url_alias;
  return r;
}

function normalizeTrainingSummary(f: RawTrainingFields, id: number): TrainingSummary {
  const r: TrainingSummary = { id: f.id ?? id, title: f.title ?? '(untitled)' };
  if (f.date?.start) r.dateStart = f.date.start;
  if (f.date?.end) r.dateEnd = f.date.end;
  if (f.date?.registration) r.dateRegistration = f.date.registration;
  if (f.source?.length)
    r.sources = f.source.map((s) => s.shortname ?? s.name ?? '').filter(Boolean);
  if (f.country?.length) r.countries = f.country.map((c) => c.name ?? '').filter(Boolean);
  if (f.theme?.length) r.themes = f.theme.map((t) => t.name ?? '').filter(Boolean);
  if (f.format?.length) r.formats = f.format.map((x) => x.name ?? '').filter(Boolean);
  if (f.language?.length) r.languages = f.language.map((l) => l.code ?? '').filter(Boolean);
  if (f.career_categories?.length)
    r.careerCategories = f.career_categories.map((c) => c.name ?? '').filter(Boolean);
  if (f.url_alias) r.urlAlias = f.url_alias;
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
