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
    key_content?: Array<{ title?: string; url?: string }>;
    appeals_response_plans?: Array<{ title?: string; url?: string; date?: string }>;
    useful_links?: Array<{ title?: string; url?: string }>;
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
    key_content?: Array<{ title?: string; url?: string }>;
    appeals_response_plans?: Array<{ title?: string; url?: string; date?: string }>;
    useful_links?: Array<{ title?: string; url?: string }>;
  };
  status?: string;
  url_alias?: string;
}

export interface RawJobFields {
  body?: string;
  career_categories?: Array<{ name?: string }>;
  country?: Array<{ name?: string; iso3?: string }>;
  date?: { created?: string; closing?: string };
  experience?: Array<{ name?: string }>;
  id?: number;
  source?: Array<{ shortname?: string; name?: string }>;
  theme?: Array<{ name?: string }>;
  title?: string;
  type?: Array<{ name?: string }>;
  url_alias?: string;
}

export interface RawTrainingFields {
  body?: string;
  career_categories?: Array<{ name?: string }>;
  country?: Array<{ name?: string; iso3?: string }>;
  date?: { start?: string; end?: string; registration?: string; created?: string };
  format?: Array<{ name?: string }>;
  id?: number;
  language?: Array<{ code?: string; name?: string }>;
  source?: Array<{ shortname?: string; name?: string }>;
  theme?: Array<{ name?: string }>;
  title?: string;
  url_alias?: string;
}

export interface RawSourceFields {
  homepage?: string;
  id?: number;
  name?: string;
  shortname?: string;
  type?: Array<{ name?: string }>;
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
