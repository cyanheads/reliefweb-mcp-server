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
| `reliefweb_search_jobs` | Search humanitarian job listings by country, organization, career category, and theme. | `text`, `country`, `source`, `career_category`, `theme`, `experience`, `limit`, `offset` | `readOnlyHint: true` |
| `reliefweb_search_training` | Search humanitarian training and learning opportunities by country, format, date, source, and career category. | `text`, `country`, `source`, `format`, `career_category`, `language`, `date_start_from`, `date_start_to`, `limit`, `offset` | `readOnlyHint: true` |
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

The `format` filter for reports uses these names: `Situation Report`, `Assessment`, `Analysis`, `Map`, `Infographic`, `Manual and Guideline`, `News and Press Release`, `Policy Document`, `Appeal`, `Financial Report`, `Evaluation and Lessons Learned`, `Other`.

### Disaster Status Values

`alert` — just declared; `current` — ongoing; `past` — resolved; `alert-archive` — alert archived; `archive` — fully archived. The `minimal` and `latest` presets filter to `alert | current | past`. The `analysis` preset includes `alert-archive` and `archive` for historical research. When passing a `status` filter directly, use these exact string values.

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
| `status` | reports, jobs, training, countries, sources, disasters | Disaster status values: `alert`, `current`, `past`, `alert-archive`, `archive`. Filter directly: `{"field": "status", "value": ["alert", "current"]}`. Presets already set defaults — use explicit filter only when overriding. |
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

The `profile.key_content`, `profile.appeals_response_plans`, `profile.useful_links` sub-arrays contain the curated links ReliefWeb maintains for the country — worth surfacing directly rather than forcing a separate reports search.

### `reliefweb_get_disaster` — disaster with linked content

One GET (`GET /v2/disasters/{id}?appname={name}&profile=full`); the `profile` sub-object on disasters contains the same key content structure as country profiles (`profile.overview`, `profile.key_content`, `profile.appeals_response_plans`, `profile.useful_links`).

---

## Parameter Descriptions

Key `.describe()` text for implementation. Every parameter needs this — list only the non-obvious ones.

| Tool | Parameter | Description text |
|:-----|:----------|:-----------------|
| all search tools | `text` | Full-text search query. Matches against title, body, and key metadata fields. Use plain natural language or keywords. |
| all search tools | `country` | ISO 3166-1 alpha-3 country code (e.g., `SYR`, `AFG`, `UKR`). Filters to content tagged with this country. |
| all search tools | `limit` | Number of results to return (1–1000, default 10). Use a smaller value for targeted lookups; larger for bulk research. Note: each call counts against the 1,000-calls/day quota. |
| all search tools | `offset` | Zero-based offset for pagination. Use with `limit` and `totalCount` from the response to page through large result sets. |
| `reliefweb_search_reports` | `format` | Content format filter. Valid values: `Situation Report`, `Assessment`, `Analysis`, `Map`, `Infographic`, `Manual and Guideline`, `News and Press Release`, `Policy Document`, `Appeal`, `Financial Report`, `Evaluation and Lessons Learned`, `Other`. |
| `reliefweb_search_reports` | `theme` | Sector or cross-cutting theme (e.g., `Health`, `Food and Nutrition`, `Shelter and NFI`, `Protection`). Matches `theme.name`. |
| `reliefweb_search_reports` | `date_from` | Earliest publication date (ISO 8601, e.g., `2024-01-15T00:00:00+00:00`). Filters on `date.original` (source publication date). |
| `reliefweb_search_reports` | `date_to` | Latest publication date (ISO 8601). Pair with `date_from` for a date range. |
| `reliefweb_search_reports` | `disaster_id` | ReliefWeb numeric disaster ID. Filters to reports linked to a specific disaster. Get the ID from `reliefweb_search_disasters`. |
| `reliefweb_search_reports` | `language` | ISO 639-1 language code (e.g., `en`, `fr`, `es`, `ar`). Filters on `language.code`. |
| `reliefweb_search_reports` | `source` | Organization short name (e.g., `UNHCR`, `OCHA`, `WFP`). Filters on `source.shortname`. |
| `reliefweb_search_reports` | `sort` | Sort order. Use `date.original:desc` for newest first (default), `date.original:asc` for oldest first, `score:desc` for relevance. |
| `reliefweb_search_reports` | `include_archived` | Include archived/to-review content in addition to published. Uses `preset=analysis`. Off by default. |
| `reliefweb_search_reports` | `filter` | Raw ReliefWeb filter object for compound conditions not covered by named params. See API docs for syntax. Example: `{"operator": "AND", "conditions": [{"field": "format.name", "value": "Map"}, {"field": "language.code", "value": "fr"}]}`. |
| `reliefweb_search_disasters` | `disaster_type` | Disaster type name (e.g., `Earthquake`, `Flood`, `Drought`, `Cyclone`). Filters on `type.name`. |
| `reliefweb_search_disasters` | `status` | Disaster status filter. Values: `alert` (newly declared), `current` (ongoing), `past` (resolved), `alert-archive`, `archive`. Default preset includes `alert`, `current`, `past`. Pass `include_archived: true` for full historical set. |
| `reliefweb_search_disasters` | `glide` | GLIDE number (global disaster identifier, e.g., `EQ-2023-000053-TUR`). Use for cross-system disaster correlation. |
| `reliefweb_get_country` | `iso3` | ISO 3166-1 alpha-3 country code (e.g., `SYR`, `AFG`, `UKR`). Used to look up the country's ReliefWeb profile. |
| `reliefweb_list_countries` | `crisis_only` | When true, filters to countries with an active humanitarian situation (status not empty/inactive). |
| `reliefweb_search_jobs` | `career_category` | Humanitarian career track (e.g., `Programme and Project Management`, `Information and Communications Technology`, `Logistics and Telecommunications`). Filters on `career_categories.name`. |
| `reliefweb_search_jobs` | `experience` | Experience level (e.g., `0-2 years`, `3-4 years`, `5-9 years`). Filters on `experience.name`. |
| `reliefweb_search_training` | `date_start_from` | Training start date lower bound (ISO 8601). Filters on `date.start` — use to find training starting after a given date. |
| `reliefweb_search_training` | `date_start_to` | Training start date upper bound (ISO 8601). Filters on `date.start` — pair with `date_start_from` for a window. |
| `reliefweb_list_sources` | `type` | Organization type (e.g., `Government`, `International Organization`, `NGO`, `Academia`). Filters on `type.name`. |

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

The `preset=analysis` flag includes archived disasters and expired jobs that `minimal`/`latest` hide. Exposed as a `include_archived` boolean on relevant tools rather than surfacing the preset concept directly.

### 8. `reliefweb_crisis_briefing` prompt over an instruction tool

A crisis briefing is best served as a reusable prompt template (agent-invokable, client-surfaceable) rather than an instruction tool. It doesn't need live state from the server — it structures how the LLM should *use* the other tools. A prompt is the right primitive.

---

## Error Handling

### Common failure modes (all tools)

| Origin | Code | When | Retryable |
|:-------|:-----|:-----|:----------|
| Missing/unapproved appname | `Unauthorized` | API returns 403 `AccessDeniedHttpException` | No — fix `RELIEFWEB_APP_NAME` config |
| Rate limit exceeded | `ServiceUnavailable` | API returns 429 or daily 1,000-call quota hit | Yes — back off; advise caching |
| Upstream timeout/5xx | `ServiceUnavailable` | Network failure or ReliefWeb service degraded | Yes — retry with backoff |
| Invalid filter value | `InvalidParams` | Bad ISO3 code, unrecognized format name, out-of-range limit | No — fix the input |
| Record not found | `NotFound` | Valid ID format but no matching record | No — verify the ID |
| Empty result set | Not an error | Valid query with zero matches — return empty array with `totalCount: 0` | N/A |

### Error message guidance

- **403 from API**: "ReliefWeb API returned 403. Verify `RELIEFWEB_APP_NAME` is set to a pre-approved appname. Register at https://apidoc.reliefweb.int/parameters#appname"
- **Not found**: "No {content_type} found with ID '{id}'. Verify the ID is a valid ReliefWeb numeric ID."
- **Rate limit**: "ReliefWeb daily call quota (1,000 calls) exceeded. Results can be cached to reduce API usage."

### Retry policy

Retry on 5xx and network errors with exponential backoff (base 500ms, max 3 attempts). Do not retry 4xx responses — they indicate a client error the agent should resolve.

---

## Known Limitations

- **1,000 calls/day limit** — for bulk analysis tasks, users must cache results or request a limit increase from OCHA. The server exposes pagination and offsets to make efficient use of the budget.
- **Appname approval delay** — ReliefWeb reviews appname requests manually. New users can't self-serve immediately; they must wait for OCHA approval before the server will work.
- **No full-text body in search results** — the `body` field is large (often 10–100KB per report). It's excluded from list results and only fetched in `reliefweb_get_report`. Agents must call `get_report` for document content.
- **No geospatial queries** — ReliefWeb's API filters by country, not bounding box or coordinates. Pairing with NWS/earthquake servers is the right path for geo-contextual disaster research.
- **Publishing API is separate** — creating or updating ReliefWeb content requires a Publishing API key and separate auth flow. This server is read-only.
- **Data quality is editorial, not real-time** — ReliefWeb content is curated by OCHA editors. There can be a lag between a disaster event and indexed reports.
- **Training date fields differ from report date fields** — training uses `date.start` / `date.end` / `date.registration`, not `date.original`. The search tool exposes `date_start_from` / `date_start_to` accordingly.
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

- `minimal` — sensible status filters (published/current only)
- `latest` — status filters + sort by date desc
- `analysis` — includes archived/expired content for historical analysis

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
