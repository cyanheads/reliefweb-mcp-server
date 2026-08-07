/**
 * @fileoverview Domain types for the ReliefWeb API v2 service layer.
 * Covers raw API response shapes, normalized domain objects, and query builder types.
 * @module services/reliefweb/types
 */

// ─── Raw API response envelopes ───────────────────────────────────────────────

export interface RawApiResponse<T> {
  /** Total number of records in this response page. */
  count: number;
  /** Result records. */
  data?: RawRecord<T>[];
  /** Link to the next page of results, if any. */
  next?: string;
  /** Self-link for the request. */
  self: string;
  /** HTTP status code returned by the API. */
  status: number;
  /** Time taken for the API to process the request. */
  time: number;
  /** Total number of records matching the query (before pagination). */
  totalCount: number;
}

export interface RawRecord<T> {
  /** The record's field data. */
  fields: T;
  /** URL of this record. */
  href?: string;
  /** Numeric ReliefWeb record ID. */
  id: number;
  /** Content type / API entity type (e.g. "reports", "disasters"). */
  type?: string;
}

// ─── Raw field shapes (from API — all optional, upstream is sparse) ────────────

export interface RawReportFields {
  body?: string;
  country?: Array<{ name?: string; iso3?: string }>;
  date?: { original?: string; created?: string };
  file?: Array<{ url?: string; filename?: string; mimetype?: string }>;
  format?: Array<{ name?: string }>;
  headline?: { summary?: string };
  id?: number;
  language?: Array<{ code?: string; name?: string }>;
  primary_country?: { name?: string; iso3?: string };
  source?: Array<{ shortname?: string; name?: string }>;
  theme?: Array<{ name?: string }>;
  title?: string;
  url_alias?: string;
}

export interface RawDisasterFields {
  country?: Array<{ name?: string; iso3?: string }>;
  date?: { created?: string; event?: string };
  description?: string;
  glide?: string;
  id?: number;
  name?: string;
  primary_country?: { name?: string; iso3?: string };
  primary_type?: { name?: string };
  profile?: {
    overview?: string;
    key_content?: {
      title?: string;
      active?: Array<{ title?: string; url?: string; cover?: string }>;
      archive?: Array<{ title?: string; url?: string; cover?: string }>;
    };
    appeals_response_plans?: {
      title?: string;
      active?: Array<{ title?: string; url?: string; date?: string }>;
      archive?: Array<{ title?: string; url?: string; date?: string }>;
    };
    useful_links?: {
      title?: string;
      active?: Array<{ title?: string; url?: string; cover?: string }>;
      archive?: Array<{ title?: string; url?: string; cover?: string }>;
    };
  };
  status?: string;
  type?: Array<{ name?: string }>;
  url_alias?: string;
}

export interface RawCountryFields {
  id?: number;
  iso3?: string;
  name?: string;
  profile?: {
    overview?: string;
    key_content?: {
      title?: string;
      active?: Array<{ title?: string; url?: string; cover?: string }>;
      archive?: Array<{ title?: string; url?: string; cover?: string }>;
    };
    appeals_response_plans?: {
      title?: string;
      active?: Array<{ title?: string; url?: string; date?: string }>;
      archive?: Array<{ title?: string; url?: string; date?: string }>;
    };
    useful_links?: {
      title?: string;
      active?: Array<{ title?: string; url?: string; cover?: string }>;
      archive?: Array<{ title?: string; url?: string; cover?: string }>;
    };
  };
  status?: string;
  url_alias?: string;
}

export interface RawJobFields {
  body?: string;
  career_categories?: Array<{ name?: string }>;
  country?: Array<{ name?: string; iso3?: string }>;
  date?: { created?: string; closing?: string; changed?: string };
  experience?: Array<{ name?: string }>;
  how_to_apply?: string;
  id?: number;
  source?: Array<{ shortname?: string; name?: string }>;
  status?: string;
  theme?: Array<{ name?: string }>;
  title?: string;
  type?: Array<{ name?: string }>;
  url?: string;
  url_alias?: string;
}

export interface RawTrainingFields {
  body?: string;
  career_categories?: Array<{ name?: string }>;
  city?: Array<{ name?: string }>;
  cost?: string;
  country?: Array<{ name?: string; iso3?: string }>;
  date?: { start?: string; end?: string; registration?: string; created?: string };
  event_url?: string;
  fee_information?: string;
  format?: Array<{ name?: string }>;
  how_to_register?: string;
  id?: number;
  language?: Array<{ code?: string; name?: string }>;
  source?: Array<{ shortname?: string; name?: string }>;
  status?: string;
  theme?: Array<{ name?: string }>;
  title?: string;
  training_language?: Array<{ code?: string; name?: string }>;
  type?: Array<{ name?: string }>;
  url?: string;
  url_alias?: string;
}

export interface RawSourceFields {
  homepage?: string;
  id?: number;
  name?: string;
  shortname?: string;
  type?: { name?: string };
  url?: string;
}

// ─── Normalized domain types ──────────────────────────────────────────────────

export interface ReportSummary {
  countries?: string[];
  dateCreated?: string;
  dateOriginal?: string;
  fileUrls?: string[];
  formats?: string[];
  headlineSummary?: string;
  id: number;
  languages?: string[];
  primaryCountry?: string;
  sources?: string[];
  themes?: string[];
  title: string;
  urlAlias?: string;
}

export interface ReportDetail extends ReportSummary {
  body?: string;
}

export interface DisasterSummary {
  countries?: string[];
  dateCreated?: string;
  dateEvent?: string;
  glide?: string;
  id: number;
  name: string;
  primaryCountry?: string;
  primaryType?: string;
  status?: string;
  types?: string[];
  urlAlias?: string;
}

export interface DisasterDetail extends DisasterSummary {
  appealsResponsePlans?: Array<{ title: string; url: string; date?: string }>;
  description?: string;
  keyContent?: Array<{ title: string; url: string }>;
  profileOverview?: string;
  usefulLinks?: Array<{ title: string; url: string }>;
}

export interface CountrySummary {
  id: number;
  iso3?: string;
  name: string;
  status?: string;
  urlAlias?: string;
}

export interface CountryDetail extends CountrySummary {
  appealsResponsePlans?: Array<{ title: string; url: string; date?: string }>;
  keyContent?: Array<{ title: string; url: string }>;
  profileOverview?: string;
  usefulLinks?: Array<{ title: string; url: string }>;
}

// ─── Curated-profile archives ─────────────────────────────────────────────────

/**
 * The curated profile lists that carry an `archive` half upstream. Named by the domain
 * field the active half lands on (`keyContent`), not by the raw API key (`key_content`),
 * so one vocabulary covers the tool surface and the normalized record alike.
 */
export const PROFILE_ARCHIVE_LISTS = ['keyContent', 'appealsResponsePlans', 'usefulLinks'] as const;

export type ProfileArchiveList = (typeof PROFILE_ARCHIVE_LISTS)[number];

/** One archived curated-profile entry. `date` is carried only by appeals and response plans. */
export interface ProfileArchiveEntry {
  date?: string;
  title: string;
  url: string;
}

/** A country's archived entries for one list, alongside enough identity to attribute them. */
export type CountryArchive = CountrySummary & { entries: ProfileArchiveEntry[] };

/** A disaster's archived entries for one list, alongside enough identity to attribute them. */
export type DisasterArchive = DisasterSummary & { entries: ProfileArchiveEntry[] };

export interface JobSummary {
  careerCategories?: string[];
  countries?: string[];
  dateClosing?: string;
  dateCreated?: string;
  experienceLevels?: string[];
  id: number;
  sources?: string[];
  themes?: string[];
  title: string;
  types?: string[];
  urlAlias?: string;
}

export interface JobDetail extends JobSummary {
  body?: string;
  dateChanged?: string;
  howToApply?: string;
  status?: string;
  url?: string;
}

export interface TrainingSummary {
  careerCategories?: string[];
  countries?: string[];
  dateEnd?: string;
  dateRegistration?: string;
  dateStart?: string;
  formats?: string[];
  id: number;
  languages?: string[];
  sources?: string[];
  themes?: string[];
  title: string;
  urlAlias?: string;
}

export interface TrainingDetail extends TrainingSummary {
  body?: string;
  cities?: string[];
  cost?: string;
  dateCreated?: string;
  eventUrl?: string;
  feeInformation?: string;
  howToRegister?: string;
  status?: string;
  trainingLanguages?: string[];
  types?: string[];
  url?: string;
}

export interface SourceSummary {
  homepage?: string;
  id: number;
  name: string;
  shortname?: string;
  types?: string[];
  url?: string;
}

// ─── Query builder types ──────────────────────────────────────────────────────

/** A ReliefWeb API filter condition or compound filter. */
export type FilterCondition =
  | { field: string; value: string | string[] | number | number[]; operator?: 'AND' | 'OR' }
  | { operator: 'AND' | 'OR'; conditions: FilterCondition[]; negate?: boolean };

/** POST body for the ReliefWeb search endpoint. */
export interface ReliefWebQuery {
  fields?: { include?: string[] };
  filter?: FilterCondition;
  limit?: number;
  offset?: number;
  preset?: 'minimal' | 'latest' | 'analysis';
  profile?: 'minimal' | 'list' | 'full';
  query?: { value: string; fields?: string[]; operator?: 'AND' | 'OR' };
  sort?: string[];
}

/** Content types supported by the API. */
export type ContentType = 'reports' | 'disasters' | 'countries' | 'jobs' | 'training' | 'sources';
