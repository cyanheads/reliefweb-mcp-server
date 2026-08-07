# reliefweb-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `reliefweb_search_reports` | Search humanitarian reports with rich filtering by country, disaster, format, theme, date, source, and language. | `text`, `country`, `disaster_id`, `format`, `theme`, `language`, `source`, `date_from`, `date_to`, `sort`, `include_archived`, `filter`, `limit`, `offset` | `readOnlyHint: true` |
| `reliefweb_get_report` | Fetch a single report by ID with full body text, file attachments, and metadata. | `id` | `readOnlyHint: true` |
| `reliefweb_search_disasters` | Search active and historical disasters by type, country, status, and GLIDE number. | `text`, `country`, `disaster_type`, `status`, `glide`, `date_from`, `date_to`, `sort`, `include_archived`, `limit`, `offset` | `readOnlyHint: true` |
| `reliefweb_get_disaster` | Fetch a disaster record by ID including description, affected countries, and linked key content. | `id` | `readOnlyHint: true` |
| `reliefweb_get_country` | Fetch a country profile with overview, humanitarian situation summary, key content links, and active appeals/response plans. | `iso3` | `readOnlyHint: true` |
| `reliefweb_list_countries` | List all countries and territories tracked by ReliefWeb, optionally filtered by crisis status. | `crisis_only`, `limit`, `offset` | `readOnlyHint: true` |
| `reliefweb_search_jobs` | Search humanitarian job listings by country, organization, career category, and theme. | `text`, `country`, `source`, `career_category`, `theme`, `experience`, `sort`, `limit`, `offset` | `readOnlyHint: true` |
| `reliefweb_search_training` | Search humanitarian training and learning opportunities by country, format, date, source, and career category. Defaults to training starting from now when no date bound is given. | `text`, `country`, `source`, `format`, `career_category`, `language`, `date_start_from`, `date_start_to`, `sort`, `limit`, `offset` | `readOnlyHint: true` |
| `reliefweb_list_sources` | Browse source organizations that contribute content to ReliefWeb, optionally filtered by name or type. | `text`, `type`, `limit`, `offset` | `readOnlyHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `reliefweb://reports/{id}` | Full report record by ReliefWeb ID — metadata, body, file URLs. | No |
| `reliefweb://disasters/{id}` | Disaster record by ReliefWeb ID — type, status, affected countries, GLIDE, description. | No |
| `reliefweb://countries/{iso3}` | Country profile by ISO3 code — overview, situation summary, key content, response plans. | No |

### Prompts

| Name | Description | Args |
|:-----|:------------|:-----|
| `reliefweb_crisis_briefing` | Structured briefing template for a country or disaster — situation overview, key reports, active disasters, open positions. | `country_or_disaster`, `focus` (optional: `situation`, `jobs`, `full`) |

---

## Overview

`reliefweb-mcp-server` exposes OCHA's ReliefWeb humanitarian information platform via MCP. ReliefWeb is the canonical source for humanitarian crisis reports, disaster data, and sector job listings — carrying content since 1996 across 200+ countries, thousands of active disasters, and contributions from 7,000+ source organizations.

Target users: humanitarian aid workers, journalists, researchers, policy makers, and agents cross-referencing with earthquake/weather servers for disaster context.

Scope: read-only. No publishing API — the Publishing API requires an org-level key and is separate.

---

## Requirements

- ReliefWeb API v2 (`api.reliefweb.int/v2/`)
- Requires a pre-approved `appname` (mandatory since Nov 2025; users register at ReliefWeb's developer form)
- No auth beyond the appname URL parameter
- Rate limit: 1,000 API calls/day; max 1,000 results per call
- Pagination via `limit` + `offset`
- Field selection via `fields.include` array (reduces payload from ~70KB full to a few KB list)
- POST-body query system: `query` (full-text), `filter` (structured conditions), `sort`, `fields`, `preset`, `facets`
- Reports go back to 1996; Jobs/Training from 2011
- Content types: reports, disasters, countries, jobs, training, sources

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `ReliefWebService` | ReliefWeb API v2 (`api.reliefweb.int/v2/`) | All tools and resources |

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `RELIEFWEB_APP_NAME` | Yes | Pre-approved appname for the ReliefWeb API. Register at https://apidoc.reliefweb.int/parameters#appname |

---

## Implementation Order

1. Config and server setup (`RELIEFWEB_APP_NAME`, `src/config/server-config.ts`)
2. `ReliefWebService` — POST query builder, `fetchWithTimeout`, retry, field-selection helpers
3. Read-only tools (reports, disasters, countries, sources, jobs, training)
4. Resources (report, disaster, country by ID/iso3)
5. Prompt (`reliefweb_crisis_briefing`)

---

## Domain Mapping

### Nouns × Operations → API Endpoints

| Noun | API Endpoint | Operations |
|:-----|:-------------|:-----------|
| Report | `POST /v2/reports` | search (with query/filter/sort/fields) |
| Report | `GET /v2/reports/{id}` | get by ID |
| Disaster | `POST /v2/disasters` | search |
| Disaster | `GET /v2/disasters/{id}` | get by ID |
| Country | `POST /v2/countries` | list, search |
| Country | `GET /v2/countries/{id}` | get by RW ID (tools use iso3 filter instead) |
| Job | `POST /v2/jobs` | search |
| Training | `POST /v2/training` | search |
| Source | `POST /v2/sources` | search, list |

### Report Format Values

The complete `format.name` vocabulary, ordered by corpus size: `News and Press Release`, `Situation Report`, `Map`, `Infographic`, `Analysis`, `Other`, `Assessment`, `Manual and Guideline`, `Appeal`, `UN Document`, `Evaluation and Lessons Learned`. Closed set — the facet's per-value counts sum to the unfiltered `totalCount` under every preset. `Policy Document` and `Financial Report` are not ReliefWeb values and match nothing.

### Disaster Status Values

`alert` — just declared; `ongoing` — in progress; `past` — resolved; `alert-archive` — an alert that was archived. Closed set, confirmed the same way. The `minimal` and `latest` presets filter to `alert | ongoing | past`; `analysis` adds `alert-archive`, so asking for that status without `include_archived: true` legitimately returns nothing. `current` and `archive` are not values the API returns.

Both are matched case-insensitively upstream, and `format.name` is analyzed rather than exact, so `"news and press release"`, `"News & Press Release"`, and `"news-and-press-release"` are working filter values, not typos. Disaster `status` is a keyword field: `alert archive` matches nothing upstream, so the canonicalizer resolves it to `alert-archive` before the query goes out.

### Key Filterable Fields

| Field | Applies To | Notes |
|:------|:-----------|:------|
| `primary_country.iso3` | reports, disasters | ISO 3166-1 alpha-3 |
| `country.iso3` | all content types | Multi-country tag |
| `format.name` | reports, training | See format values above |
| `theme.name` | reports, jobs, training | Sector/cross-cutting theme |
| `disaster.id` | reports | Link reports to a disaster (integer ID) |
| `glide` | disasters | GLIDE number (global disaster ID) |
| `type.name` | disasters, jobs, sources | Disaster type (`type.name`), job type (`type.name`), org type (`type.name`); for disasters also `primary_type.name` for primary disaster type |
| `status` (disasters) | disasters | `alert`, `ongoing`, `past`, `alert-archive`. Filter directly: `{"field": "status", "value": ["alert", "ongoing"]}`. Presets already set defaults — use explicit filter only when overriding. |
| `status` (countries) | countries | `ongoing` (active crisis) or `normal` (non-crisis). `crisis_only=true` filters to `ongoing`. |
| `status` (sources) | sources | `active` or `inactive`. |
| `date.original` | reports | Source publication date |
| `date.created` | all | ReliefWeb index date |
| `source.shortname` | reports, jobs, training | Organization abbreviation |
| `language.code` | reports, training | ISO 639-1 |
| `career_categories.name` | jobs, training | Humanitarian career track |

---

## Workflow Analysis

### `reliefweb_search_reports` — primary workflow

Most humanitarians start here. A single POST to `/v2/reports` with structured filter conditions covers the 80% case.

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | `POST /v2/reports` | Full-text + filter search with field selection |

Fields requested for list view: `id`, `title`, `date.original`, `date.created`, `primary_country.name`, `country.name`, `source.shortname`, `format.name`, `theme.name`, `url_alias`, `file.url`, `headline.summary`.

Full body (`body`) only fetched in `reliefweb_get_report`.

### `reliefweb_get_country` — multi-field profile

Country profiles contain nested `profile` subfields with key content sections. A single POST to `/v2/countries` with iso3 filter and `profile=full` covers the whole thing; no fan-out needed.

| # | Call | Purpose |
|:--|:-----|:--------|
| 1 | `POST /v2/countries` with `{"filter": {"field": "iso3", "value": "<iso3>"}, "profile": "full"}` | Fetch full country profile with all sub-fields |

The `profile.key_content`, `profile.appeals_response_plans`, `profile.useful_links` sub-arrays contain the curated links ReliefWeb maintains for the country — worth surfacing directly rather than forcing a separate reports search. Only the currently-active links are surfaced from each sub-array; the `archive` halves (which run to thousands of entries for long-running crises — SYR carries 2,300+ archived `key_content` links) are dropped to keep the payload within the client token budget.

### `reliefweb_get_disaster` — disaster with linked content

One GET (`GET /v2/disasters/{id}?appname={name}&profile=full`); the `profile` sub-object on disasters contains the same key content structure as country profiles (`profile.overview`, `profile.key_content`, `profile.appeals_response_plans`, `profile.useful_links`). As with `reliefweb_get_country`, only the currently-active links in each sub-array are surfaced (the `archive` halves are dropped). The `description` and `profile.overview` prose can together run to tens of KB for major disasters; like `reliefweb_get_report`'s body, it's returned in full, so call this only when the narrative text is needed.

---

## Parameter Descriptions

Key `.describe()` text for implementation. Every parameter needs this — list only the non-obvious ones.

| Tool | Parameter | Description text |
|:-----|:----------|:-----------------|
| all search tools | `text` | Full-text search query. Matches against title, body, and key metadata fields. Use plain natural language or keywords. |
| all search tools | `country` | ISO 3166-1 alpha-3 country code (e.g., `SYR`, `AFG`, `UKR`). Filters to content tagged with this country. |
| all search tools | `limit` | Number of results to return (1–1000, default 10). Use a smaller value for targeted lookups; larger for bulk research. Note: each call counts against the 1,000-calls/day quota. |
| all search tools | `offset` | Zero-based offset for pagination. Use with `limit` and `totalCount` from the response to page through large result sets. |
| `reliefweb_search_reports` | `format` | Content format filter. One of: `News and Press Release`, `Situation Report`, `Map`, `Infographic`, `Analysis`, `Other`, `Assessment`, `Manual and Guideline`, `Appeal`, `UN Document`, `Evaluation and Lessons Learned`. Case, spacing, and punctuation ignored; any other value rejected with the valid list. |
| `reliefweb_search_reports` | `theme` | Sector or cross-cutting theme (e.g., `Health`, `Food and Nutrition`, `Shelter and Non-Food Items`, `Protection`). Open-ended — matches `theme.name` exactly as ReliefWeb spells it. |
| `reliefweb_search_reports` | `date_from` | Earliest publication date. Filters on `date.original` (source publication date). Accepts a bare calendar date (`2024-01-15`, resolved to start of day UTC) or a full ISO 8601 datetime in any offset, resolved to UTC. |
| `reliefweb_search_reports` | `date_to` | Latest publication date. Pair with `date_from` for a date range. A bare calendar date resolves to end of day UTC, so the range covers it in full. |
| `reliefweb_search_reports` | `disaster_id` | ReliefWeb numeric disaster ID. Filters to reports linked to a specific disaster. Get the ID from `reliefweb_search_disasters`. |
| `reliefweb_search_reports` | `language` | ISO 639-1 language code (e.g., `en`, `fr`, `es`, `ar`). Filters on `language.code`. |
| `reliefweb_search_reports` | `source` | Organization short name (e.g., `UNHCR`, `OCHA`, `WFP`). Filters on `source.shortname`. |
| `reliefweb_search_reports` | `sort` | Sort order. Use `date.original:desc` for newest first (default), `date.original:asc` for oldest first, `score:desc` for relevance. |
| `reliefweb_search_reports` | `include_archived` | No effect. Reports have no archived class, so every report is in scope whatever this is set to. Kept so existing calls keep working. |
| `reliefweb_search_reports` | `filter` | Raw ReliefWeb filter object for compound conditions not covered by named params. See API docs for syntax. Example: `{"operator": "AND", "conditions": [{"field": "format.name", "value": "Map"}, {"field": "language.code", "value": "fr"}]}`. |
| `reliefweb_search_disasters` | `disaster_type` | Disaster type name (e.g., `Earthquake`, `Flood`, `Drought`, `Cyclone`). Filters on `type.name`. |
| `reliefweb_search_disasters` | `status` | Disaster status filter. One of: `alert` (newly declared), `ongoing`, `past` (resolved), `alert-archive`. Comma-separate for multiple; case, spacing, and punctuation ignored; any other value rejected with the valid list. Default preset covers `alert`, `ongoing`, `past` — `alert-archive` additionally needs `include_archived: true`. |
| `reliefweb_search_disasters` | `glide` | GLIDE number (global disaster identifier, e.g., `EQ-2023-000053-TUR`). Use for cross-system disaster correlation. |
| `reliefweb_get_country` | `iso3` | ISO 3166-1 alpha-3 country code (e.g., `SYR`, `AFG`, `UKR`). Used to look up the country's ReliefWeb profile. |
| `reliefweb_list_countries` | `crisis_only` | When true, filters to countries with an active humanitarian situation (status `ongoing`). |
| `reliefweb_search_jobs` | `career_category` | Humanitarian career track (e.g., `Programme and Project Management`, `Information and Communications Technology`, `Logistics and Telecommunications`). Filters on `career_categories.name`. |
| `reliefweb_search_jobs` | `experience` | Experience level (e.g., `0-2 years`, `3-4 years`, `5-9 years`). Filters on `experience.name`. |
| `reliefweb_search_jobs` | `sort` | Sort order. `date.created:desc` for newest postings first (default), `date.closing:asc` to surface roles closing soonest, `score:desc` for relevance. |
| `reliefweb_search_jobs` | `include_archived` | Search expired postings alongside the open ones. Uses `preset=analysis`. Off by default — the open set is a small fraction of the archive. |
| `reliefweb_search_training` | `date_start_from` | Training start date lower bound. Filters on `date.start` — use to find training starting after a given date. Accepts a bare calendar date or a full ISO 8601 datetime. Omitting both start-date bounds defaults the lower bound to the current timestamp. |
| `reliefweb_search_training` | `date_start_to` | Training start date upper bound. Filters on `date.start` — pair with `date_start_from` for a window. A bare calendar date resolves to end of day UTC. Supplying it alone leaves the lower bound open. |
| `reliefweb_search_training` | `sort` | Sort order. `date.start:asc` for soonest-starting first (default), `date.start:desc` for latest-starting, `date.created:desc` for most recently posted, `score:desc` for relevance. |
| `reliefweb_search_training` | `include_archived` | Search concluded listings alongside the current ones. Uses `preset=analysis`. Also drops the start-from-now default bound, so an otherwise unbounded search reaches the whole record. Off by default. |
| `reliefweb_list_sources` | `type` | Organization type. One of: `Non-governmental Organization`, `International Organization`, `Academic and Research Institution`, `Other`, `Government`, `Media`, `Red Cross/Red Crescent Movement`. Filters on `type.name`. |

---

## Design Decisions

### 1. POST-body query system exposed as structured params, not passthrough

The API's native query format (nested JSON with `filter.conditions[]`, `query.fields[]`, etc.) is powerful but verbose for an LLM to assemble from scratch. Each tool exposes named, typed params (`country`, `format`, `theme`, etc.) that map to filter conditions internally. For power users who need compound conditions beyond what named params cover, `reliefweb_search_reports` exposes a `filter` escape hatch accepting the raw filter object.

### 2. Appname is required config, not optional

ReliefWeb made appname mandatory in Nov 2025. The server fails fast at startup (`parseEnvConfig`) if `RELIEFWEB_APP_NAME` is missing, rather than silently passing 403s to the LLM at query time.

### 3. No direct-by-ID tool for jobs or training

Jobs and training entities don't carry content that warrants standalone lookup — the meaningful fields (title, body, application URL) all come through search results. Adding `reliefweb_get_job` and `reliefweb_get_training` would expand the surface for marginal gain. Deferred; add if demand surfaces.

### 4. Country profiles use iso3 not RW numeric IDs

ReliefWeb country records have numeric IDs, but iso3 codes (`AFG`, `SYR`, `UKR`) are universally recognized and stable across systems. The tool accepts iso3 and translates to a filter internally, keeping the interface intuitive.

### 5. `reliefweb_list_countries` is a separate tool from `reliefweb_get_country`

Listing all countries (with `crisis_only` filter) and fetching a single profile are distinct agent actions with different output shapes. Consolidating them under a `mode` enum would make the parameter surface more complicated without simplifying usage.

### 6. Facets omitted from initial design

The API's `facets` parameter supports powerful aggregate analysis (e.g., "top countries by report count"). It's useful for data analysis workflows but adds significant query complexity. Deferring to a future `reliefweb_facets` tool if research/analysis use cases emerge.

### 7. `analysis` preset for historical research

The `preset=analysis` flag reaches archived disasters, expired job postings, and concluded training that `minimal`/`latest` hide. Exposed as an `include_archived` boolean on the three tools where it changes the result set — disasters, jobs, training — rather than surfacing the preset concept directly. Reports are the exception: their corpus carries no archived class, every preset returns the same records, and the parameter is inert there.

### 8. `reliefweb_crisis_briefing` prompt over an instruction tool

A crisis briefing is best served as a reusable prompt template (agent-invokable, client-surfaceable) rather than an instruction tool. It doesn't need live state from the server — it structures how the LLM should *use* the other tools. A prompt is the right primitive.

---

## Error Handling

### Common failure modes (all tools)

| Origin | Code | When | Retryable |
|:-------|:-----|:-----|:----------|
| Missing/unapproved appname | `ServiceUnavailable` | API returns 403; reason `upstream_error`, with ReliefWeb's own "not using an approved appname" text quoted in the message | No — fix `RELIEFWEB_APP_NAME` config |
| Rate limit exceeded | `ServiceUnavailable` | API returns 429 or daily 1,000-call quota hit; reason `upstream_error` | Yes — back off; advise caching |
| Upstream timeout/5xx | `ServiceUnavailable` | Network failure or ReliefWeb service degraded | Yes — retry with backoff |
| Invalid filter value | `InvalidParams` | ReliefWeb rejects the query — unrecognized sort field, invalid raw filter object, malformed date. Reason `invalid_query`; ReliefWeb's own explanation is folded into the error message so it reaches `content[]` as well as `structuredContent` | No — fix the input |
| Record not found | `NotFound` | Valid ID format but no matching record | No — verify the ID |
| Empty result set | Not an error | Valid query with zero matches — return empty array with `totalCount: 0` and a broaden-your-search notice | N/A |
| Offset past the end | Not an error | Valid query, empty page, `totalCount > 0` — the notice names `totalCount` and the last reachable page offset instead of claiming nothing matched. Applies to every tool that pages: the four search tools, `list_sources`, and `list_countries` | N/A |

### Error message guidance

- **403 from API**: "ReliefWeb API returned 403. Verify `RELIEFWEB_APP_NAME` is set to a pre-approved appname. Register at https://apidoc.reliefweb.int/parameters#appname"
- **Not found**: "No {content_type} found with ID '{id}'. Verify the ID is a valid ReliefWeb numeric ID."
- **Rate limit**: "ReliefWeb daily call quota (1,000 calls) exceeded. Results can be cached to reduce API usage."

### Retry policy

Retry on 5xx and network errors with exponential backoff. Do not retry 4xx responses — they indicate a client error the agent should resolve. The tool error contract mirrors that split: a rejected request (`InvalidParams` / `InvalidRequest` / `ValidationError`) fails as `invalid_query` and tells the caller to correct the input, while everything else — 5xx, timeouts, rate limits, auth failures, and the HTML block page — stays on `upstream_error` with the wait-and-retry guidance. Both branches quote ReliefWeb's own explanation in the error message, so it reaches `content[]` and not only `structuredContent`.

---

## Known Limitations

- **1,000 calls/day limit** — for bulk analysis tasks, users must cache results or request a limit increase from OCHA. The server exposes pagination and offsets to make efficient use of the budget.
- **Appname approval delay** — ReliefWeb reviews appname requests manually. New users can't self-serve immediately; they must wait for OCHA approval before the server will work.
- **No full-text body in search results** — the `body` field is large (often 10–100KB per report). It's excluded from list results and only fetched in `reliefweb_get_report`. Agents must call `get_report` for document content.
- **No geospatial queries** — ReliefWeb's API filters by country, not bounding box or coordinates. Pairing with NWS/earthquake servers is the right path for geo-contextual disaster research.
- **Publishing API is separate** — creating or updating ReliefWeb content requires a Publishing API key and separate auth flow. This server is read-only.
- **Data quality is editorial, not real-time** — ReliefWeb content is curated by OCHA editors. There can be a lag between a disaster event and indexed reports.
- **Training date fields differ from report date fields** — training uses `date.start` / `date.end` / `date.registration`, not `date.original`. The search tool exposes `date_start_from` / `date_start_to` accordingly, and defaults an unbounded search to a lower bound of the current timestamp so the first page is upcoming rather than long-past starts.
- **`disaster.id` vs `id` in filter context** — when filtering reports by disaster, use `disaster.id` (the integer field on reports pointing to the linked disaster), not `id` (the report's own ID).

---

## API Reference

### Base URL

```
https://api.reliefweb.int/v2/{content_type}?appname={RELIEFWEB_APP_NAME}
```

### Content Types

`reports` | `disasters` | `countries` | `jobs` | `training` | `sources`

### Query Structure (POST body)

```json
{
  "query": { "value": "string", "fields": ["title", "body"], "operator": "AND|OR" },
  "filter": {
    "operator": "AND|OR",
    "conditions": [
      { "field": "country.iso3", "value": "SYR" },
      { "field": "format.name", "value": ["Situation Report", "Assessment"], "operator": "OR" }
    ]
  },
  "fields": { "include": ["id", "title", "date.original", "primary_country.name"] },
  "sort": ["date.original:desc"],
  "preset": "latest",
  "limit": 20,
  "offset": 0
}
```

### Pagination

Offset-based. `limit` (1–1000, default 10) + `offset` (default 0). Response includes `totalCount` for total matches.

### Profiles

- `minimal` — title/name only (default)
- `list` — fields suitable for list display
- `full` — all fields

Pass as `?profile=full` in GET requests or as `"profile": "full"` in POST body. Profiles affect which fields are returned by default; the `fields.include` parameter can supplement any profile.

### Presets

- `minimal` — status filters only
- `latest` — the same status filters plus sort by date desc
- `analysis` — no status filters; reaches archived and expired content

What the status filters exclude is per content type. Reports are unaffected — every preset returns the same records, since their `status` facet holds only `published` and `to-review` and no preset drops either. Disasters, jobs, and training each narrow under `minimal`/`latest` and open up under `analysis`; the counts are in Design Decision #7.

### Date Formats

ISO 8601: `2024-01-15T00:00:00+00:00`. Filter range uses `from`/`to` keys under `filter.value`.

### Individual Record Fetch

```
GET https://api.reliefweb.int/v2/{content_type}/{id}?appname={name}&profile=full
```

---

## Decisions Log

| Date | Decision | Rationale |
|:-----|:---------|:----------|
| 2026-05-23 | Target API v2, not v1 | v1 is decommissioned as of late 2024. All requests to v1 return 410. |
| 2026-05-23 | `RELIEFWEB_APP_NAME` is required env var | ReliefWeb enforces pre-approved appnames since Nov 2025. The server must fail fast at startup rather than propagating 403s to LLM callers. |
| 2026-05-23 | Named filter params with raw filter escape hatch | The API's native JSON filter syntax is expressive but verbose for LLM use. Named params cover 80% of queries; the raw `filter` param on search tools covers advanced compound conditions without exposing all the nested JSON boilerplate by default. |
| 2026-05-23 | No `reliefweb_get_job` or `reliefweb_get_training` tools | Jobs and training lack content depth that justifies standalone lookup — all meaningful data comes through search. Keeps the surface tight. |
| 2026-05-23 | Country profiles accessed by iso3 | iso3 codes (`AFG`, `UKR`) are universally understood and stable. RW numeric IDs are internal and not meaningful to users or agents. |
| 2026-05-23 | Facets deferred | Powerful for analysis but adds query complexity not yet justified by a clear agent workflow. Can be added as `reliefweb_facets` if research use cases emerge. |
| 2026-05-23 | Crisis briefing as Prompt, not instruction tool | Briefing structure is a reusable template for guiding LLM tool-use, not a state-inspecting advisor. Prompts are the right primitive; no live server state needed. |
| 2026-05-23 | Body field excluded from search results | Report bodies can be 10–100KB each. Fetching body in list queries would exhaust context budget rapidly. Agents call `get_report` for document content when needed. |
| 2026-07-13 | Country/disaster profile sub-arrays surface the active set only, not active+archive | The `profile.key_content` / `appeals_response_plans` / `useful_links` `archive` halves run to thousands of entries for long-running crises (SYR merged to 381KB, exceeding the client token limit). `keyContent` should reflect what ReliefWeb currently curates, not its full history — active-only is a ~78x reduction for SYR. Capping-to-N or pagination add complexity the numbers don't justify. |
| 2026-07-13 | `sort` exposed on `search_jobs` and `search_training`; training defaults to `date.start:asc` | Reports/disasters already exposed `sort`; jobs/training hardcoded `date.created:desc` with no input, so `appliedFilters.sort` never reflected a real value. Training is documented for finding upcoming training, so its default becomes soonest-starting (`date.start:asc`); jobs keep newest-posted (`date.created:desc`). |
| 2026-08-06 | Upstream failures split into `invalid_query` and `upstream_error`, and ReliefWeb's message is folded into the thrown message | The error text path renders only `message` plus `data.recovery.hint`, so an explanation left in `data.body` never reaches `content[]`. Classification is by error code (`InvalidParams` / `InvalidRequest` / `ValidationError`), not by 4xx-vs-5xx: 401/403/429 are 4xx the caller cannot fix by editing the query, so they keep the retry-flavored contract — but they quote the upstream text too, since a 403 naming an unapproved appname is useless if the operator only ever sees "wait and retry". |
| 2026-08-06 | Date bounds normalized in the tool handler, not in `makeDateFilter` or a Zod `.transform()` | `z.transform()` is barred from tool schemas (not JSON-Schema-serializable), and normalizing inside the shared service helper would leave `appliedFilters` echoing the unresolved raw value. Resolving once per field at the handler feeds both the service call and the echo, so `structuredContent` and `content[]` report the query that ran. Upper bounds resolve to end-of-day so an inclusive bare-date range covers its last day. ReliefWeb accepts exactly one datetime spelling on a range bound — `YYYY-MM-DDTHH:MM:SS` with a zero offset written `+00:00` or `+0000` — and answers `Z`, fractional seconds, a missing seconds component, and every non-zero offset with the same `It must be an ISO 8601 date.` 400, so the resolver converts the wider ISO 8601 surface to UTC rather than advertising forms that fail upstream. |
| 2026-08-06 | `search_training` injects a current-timestamp lower bound only when both start-date bounds are absent | `date.start:asc` over the whole corpus opens on listings that already started, so the default call answered the wrong question. Injecting whenever either bound was supplied would silently break historical research, so an explicit range is left exactly as given. The bound is built directly as a full ISO datetime rather than pushed back through the input schema, since it is applied after validation. |
| 2026-08-06 | Closed vocabularies (`search_reports.format`, `search_disasters.status`) are canonicalized in the handler, not constrained by `z.enum` | ReliefWeb matches both fields case-insensitively, and `format.name` is analyzed rather than exact — `"news and press release"`, `"News & Press Release"`, `"News  and  Press  Release"`, and `"news-and-press-release"` all return the same 644k reports today; `status` also takes comma-separated multi-value, which the service splits into an array before sending. A schema-level `z.enum` does exact single-literal matching and would reject all of those at the boundary — a regression on working calls. The fields stay `z.string()` and the handler matches on a normalized key (lower-cased, `&` read as `and`, other punctuation and spacing dropped) against the verified vocabulary, then substitutes the canonical spelling (per comma-separated token for `status`), which is what reaches the service and what `appliedFilters` echoes on both response paths. Normalizing punctuation also makes the hyphen in `alert-archive` optional, where upstream matches `status` as an exact keyword. A token that matches nothing fails through the tool's typed error contract with a message naming every valid value, so a typo produces an actionable error instead of an empty page advising the caller to broaden filters that were never the problem. `z.transform()` is barred from tool schemas, so the handler is the only place this can live. |
| 2026-08-06 | `include_archived` kept on `search_reports` as a documented no-op; the echoed preset stops flipping | Reports carry no archived class — `latest`, `minimal`, and `analysis` all return the same 1.14M records — so the parameter never changed a result set. Removing it would break an existing tool's input contract, so it stays, described plainly as having no effect, and the query and the echoed `appliedFilters.preset` are both pinned to `latest`. Echoing `analysis` while nothing changed was the misleading half: it implied a coverage difference that does not exist. |
| 2026-08-06 | `include_archived` on `search_training` also drops the start-from-now lower bound | The bound exists so an unbounded default answers "what is coming up". A caller who turns on the archive is asking for the historical record, and keeping a now-bound would hide exactly the concluded listings the flag exists to reach — leaving the parameter as inert on training as it was on reports. An explicit `date_start_from` still wins. |
| 2026-08-06 | Resource URI IDs must be a positive integer end to end | `parseInt` stops at the first character it cannot read, so `reliefweb://reports/4221539junk` served report 4221539 and `1.5` served record 1 — a malformed URI silently returned a record the caller never asked for, with nothing in the response to say so. The whole segment is now matched against `^[1-9]\d*$` and range-checked with `Number.isSafeInteger` before any upstream call. The tools were never affected: their ID inputs are already `z.number().int().positive()`. |
| 2026-08-06 | Empty page with `totalCount > 0` gets its own notice naming the last reachable offset | Keying the notice on `items.length === 0` alone described a correct 1,775-match query as matching nothing and advised dropping the filters. The last-page offset is page-aligned (`floor((totalCount - 1) / limit) * limit`) so the returned value is one an unchanged `limit` can actually page to. `list_countries` carried the same defect behind a static string that mentioned offsets as boilerplate without ever comparing `totalCount` to `offset`, so it takes the same branch. |
