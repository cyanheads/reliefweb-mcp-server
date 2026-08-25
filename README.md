<div align="center">
  <h1>@cyanheads/reliefweb-mcp-server</h1>
  <p><b>Search ReliefWeb humanitarian reports, disasters, jobs, training, and country profiles via MCP. STDIO or Streamable HTTP.</b>
  <div>11 Tools • 3 Resources • 1 Prompt</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/reliefweb-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/reliefweb-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/reliefweb-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/reliefweb-mcp-server/releases/latest/download/reliefweb-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=reliefweb-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvcmVsaWVmd2ViLW1jcC1zZXJ2ZXIiXSwiZW52Ijp7IlJFTElFRldFQl9BUFBfTkFNRSI6InlvdXItYXBwLW5hbWUifX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22reliefweb-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Freliefweb-mcp-server%22%5D%2C%22env%22%3A%7B%22RELIEFWEB_APP_NAME%22%3A%22your-app-name%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://reliefweb.caseyjhand.com/mcp](https://reliefweb.caseyjhand.com/mcp)

</div>

---

## Tools

11 tools for working with ReliefWeb humanitarian data:

| Tool | Description |
|:---|:---|
| `reliefweb_search_reports` | Search humanitarian reports with filtering by country, disaster, format, theme, language, source, and date |
| `reliefweb_get_report` | Fetch a single report by numeric ID with full body text and metadata |
| `reliefweb_search_disasters` | Search disasters by type, country, status, GLIDE number, and date range |
| `reliefweb_get_disaster` | Fetch a disaster record with profile, key content links, appeals, and response plans |
| `reliefweb_get_country` | Fetch a country profile by ISO3 code with overview, appeals, and curated links |
| `reliefweb_list_countries` | List all countries tracked by ReliefWeb, filterable to active humanitarian situations |
| `reliefweb_search_jobs` | Search humanitarian job listings by country, organization, career category, and experience level |
| `reliefweb_get_job` | Fetch a job posting by numeric ID with the full vacancy description and application instructions |
| `reliefweb_search_training` | Search training and learning opportunities by format, country, career category, and date — upcoming starts by default |
| `reliefweb_get_training` | Fetch a training listing by numeric ID with the full description, registration instructions, and cost detail |
| `reliefweb_list_sources` | Browse contributing organizations by name and type |

### Oversized records

The five `reliefweb_get_*` tools never truncate. Under a fixed byte budget they return the record whole; over it they return a complete section outline — every section, its real serialized size, and how to reach it — and a `sections: [...]` re-call returns exactly the named sections plus identity metadata. The re-call is self-contained: the record is re-fetched from its ID and sliced, so nothing has to be replayed. Both modes carry the same information in `structuredContent` and `content[]`.

The resources always return the whole record — a resource read has no way to name sections, so reach for the tool when a record is too large.

### Curated-profile archives

A country or disaster profile returns only what ReliefWeb currently curates in each of its three link lists. Each list also has an archive, thousands of entries deep for a long-running crisis — Syria carries 2,328 archived key content links and 120 archived appeals and response plans. `reliefweb_get_country` and `reliefweb_get_disaster` page that archive on request:

```jsonc
{ "iso3": "SYR", "archive": { "list": "keyContent", "offset": 0, "limit": 25 } }
```

The response replaces the profile with one page: the list it came from, the true total, how many entries it holds, its offset, the entries, and the next offset while more remain — absent once the page reaches the end. Lists are `keyContent`, `appealsResponsePlans`, and `usefulLinks`, named for the fields the active half lands on.

`sections` and `archive` are alternative modes and a call carrying both is rejected: `sections` slices the record, `archive` replaces it with a page. A record over the response budget still answers an archive call with the page — a page is bounded by `limit` and carries no record prose, so it never outlines.

### `reliefweb_search_reports`

Search humanitarian reports on ReliefWeb with rich filtering.

- Full-text search across title, body, and key metadata fields
- Filtering by country (ISO3), disaster ID, format, theme, language, and source organization
- Date range filtering on source publication date — a bare `2024-01-15` is accepted alongside full ISO 8601
- Raw filter object for compound conditions not covered by named params
- Pagination via offset and limit (up to 1,000 per call)
- Format is a closed set: `News and Press Release`, `Situation Report`, `Map`, `Infographic`, `Analysis`, `Other`, `Assessment`, `Manual and Guideline`, `Appeal`, `UN Document`, `Evaluation and Lessons Learned` — matched ignoring case, spacing, and punctuation; anything else is rejected with the list
- `include_archived` has no effect here — reports have no archived class, so all of them are in scope by default
- Returns paginated summaries — use `reliefweb_get_report` to fetch full body text
- Rate limit: 1,000 calls/day

---

### `reliefweb_get_report`

Fetch a single ReliefWeb report by its numeric ID with full body text.

- Full body HTML, all metadata, and file attachment URLs
- Use after `reliefweb_search_reports` to retrieve document content (10–100KB each)
- Over the response budget, returns a section outline instead; `sections: ["body"]` pulls the body back on its own
- Returns structured `not_found` when the ID doesn't exist

---

### `reliefweb_search_disasters`

Search active and historical disasters on ReliefWeb.

- Filtering by disaster type (Earthquake, Flood, Cyclone, etc.), country, and status
- GLIDE number lookup for cross-system disaster correlation
- Date range filtering on disaster creation date — a bare `2024-01-15` is accepted alongside full ISO 8601
- Status values: `alert`, `ongoing`, `past`, `alert-archive`; multiple values comma-separated, matched ignoring case, spacing, and punctuation
- Optional `include_archived=true` to reach `alert-archive` entries, which the default preset hides
- Returns IDs for use with `reliefweb_get_disaster` and as `disaster_id` filter in `reliefweb_search_reports`

---

### `reliefweb_get_disaster`

Fetch a disaster record by ReliefWeb numeric ID with full details.

- Full description, profile overview, affected countries, and GLIDE number
- Currently-active curated key content links from the ReliefWeb editorial team (the present set, not the full archive)
- Currently-active appeals and response plans linked to the disaster
- Currently-active useful external links curated by ReliefWeb editors
- Major disasters run to tens of KB of prose; over the response budget the record comes back as a section outline, and `sections: ["description"]` or `sections: ["profileOverview"]` pulls one narrative at a time
- `archive: { list: "keyContent" }` pages the archived entries each curated list leaves out

---

### `reliefweb_get_country`

Fetch a country profile from ReliefWeb by ISO3 code.

- Situation overview text curated by OCHA editors
- Currently-active key content links maintained by ReliefWeb editors (the present curated set, not the full archive)
- Currently-active humanitarian appeals and response plans
- Currently-active useful external links for the country
- Country profiles are the authoritative situation summary for humanitarian responders
- `archive: { list: "keyContent" }` pages the archived entries each curated list leaves out — 2,328 of them for Syria
- Carries the same outline-and-`sections` behavior as the other detail tools, though an active-only profile is small enough that it rarely reaches the budget

---

### `reliefweb_list_countries`

List all countries and territories tracked by ReliefWeb.

- Optional `crisis_only=true` to limit to active humanitarian situations (status ongoing)
- Returns ISO3 codes, status, and canonical URLs — use ISO3 with `reliefweb_get_country`
- Pagination up to 1,000 entries per call

---

### `reliefweb_search_jobs`

Search humanitarian job listings on ReliefWeb.

- Filtering by country, organization short name, career category, theme, and experience level
- Career category values: Programme and Project Management, Information and Communications Technology, Logistics and Telecommunications, and others
- Returns current open positions — expired postings excluded by default
- Optional `include_archived=true` to search expired postings too; the archive dwarfs the open set, so use it for labour-market history rather than a hiring snapshot
- Sortable by newest posting (`date.created:desc`, default) or soonest closing (`date.closing:asc`)
- Pagination with closing date and canonical URL per listing
- Returns IDs for use with `reliefweb_get_job`

---

### `reliefweb_get_job`

Fetch a job posting by ReliefWeb numeric ID with everything needed to evaluate and apply.

- Full vacancy description and application instructions — neither is in search results
- Posting status, indexed / closing / last-modified dates, hiring organization, countries, career category, experience level, and job type
- Both canonical URLs (the readable alias and the node URL)
- Reaches expired postings as well as open ones
- Over the response budget, returns a section outline; `sections: ["howToApply"]` pulls the instructions without the whole description
- Returns structured `not_found` pointing back at `reliefweb_search_jobs`

---

### `reliefweb_search_training`

Search humanitarian training and learning opportunities.

- Covers on-site and online capacity-building events
- Filtering by country, source, format, career category, and language
- Date range filtering on training start date (`date_start_from` / `date_start_to`) — a bare `2024-06-01` is accepted alongside full ISO 8601
- Scoped to training starting from now when neither bound is given; supply either one to search an explicit range, including a historical one
- Optional `include_archived=true` to search concluded listings too; it also drops the start-from-now default bound, so an otherwise unbounded search reaches the whole record
- Ordered by soonest start date by default (`date.start:asc`); override with `sort`
- Distinct from report date fields — uses `date.start` / `date.end`
- Returns IDs for use with `reliefweb_get_training`

---

### `reliefweb_get_training`

Fetch a training listing by ReliefWeb numeric ID with everything needed to evaluate and register.

- Full description and registration instructions — neither is in search results
- Cost class and the organizer's fee detail, plus the organizer's own event URL
- Listing status, start / end / registration / indexed dates, host cities, format, type, listing and delivery languages, and organizing source
- Both canonical URLs (the readable alias and the node URL)
- Reaches concluded listings as well as current ones
- Over the response budget, returns a section outline; `sections: ["cost", "feeInformation", "howToRegister"]` pulls just the practicalities
- Returns structured `not_found` pointing back at `reliefweb_search_training`

---

### `reliefweb_list_sources`

Browse organizations that contribute content to ReliefWeb.

- Optional filtering by name text or organization type (Government, International Organization, Non-governmental Organization, Academic and Research Institution, Media, Red Cross/Red Crescent Movement, Other)
- Returns short names, types, organization URLs, and homepage URLs
- Use `shortname` with the `source` filter in `reliefweb_search_reports`, `reliefweb_search_jobs`, and `reliefweb_search_training`

## Resources and prompt

| Type | Name | Description |
|:---|:---|:---|
| Resource | `reliefweb://reports/{id}` | Full report record by numeric ID — metadata, body text, and file URLs. The ID segment must be digits only |
| Resource | `reliefweb://disasters/{id}` | Disaster record by numeric ID — type, status, GLIDE, description, and content links. The ID segment must be digits only |
| Resource | `reliefweb://countries/{iso3}` | Country profile by ISO3 code — overview, situation summary, and active response plans |
| Prompt | `reliefweb_crisis_briefing` | Generate a structured humanitarian briefing for a country or disaster |

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling across all tools
- Pluggable auth (`none`, `jwt`, `oauth`)
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- Runs locally (stdio/HTTP) or on Cloudflare Workers from the same codebase

ReliefWeb-specific:

- Full coverage of six ReliefWeb content types: reports, disasters, countries, jobs, training, sources
- Compound filter builder supporting nested AND/OR conditions for the ReliefWeb API v2
- `RELIEFWEB_APP_NAME` validated at startup (required by the API since November 2025)
- 1,000 calls/day quota awareness — prominently documented on each tool

Agent-friendly output:

- Body text excluded from search results by design — agents fetch it explicitly with the matching `reliefweb_get_*` tool to control context budget
- Oversized records outline rather than truncate, with a section selector to retrieve what's needed
- Curated-profile archives are paged rather than dropped, with honest totals and a next offset
- Recovery hints on empty results — echoes applied filters and suggests how to broaden
- Typed `not_found` error contracts on get-by-ID tools with actionable recovery text

## Getting started

### Prerequisites

- [Bun v1.3.2](https://bun.sh/) or higher.
- A **pre-approved ReliefWeb appname** — register at [ReliefWeb API](https://reliefweb.int/help/api) and set `RELIEFWEB_APP_NAME`. The API has required pre-approved appnames since November 2025; requests without one are rejected.

### Public Hosted Instance

A public instance is available at `https://reliefweb.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "reliefweb-mcp-server": {
      "type": "streamable-http",
      "url": "https://reliefweb.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "reliefweb-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/reliefweb-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "RELIEFWEB_APP_NAME": "your-app-name"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "reliefweb-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/reliefweb-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info",
        "RELIEFWEB_APP_NAME": "your-app-name"
      }
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 RELIEFWEB_APP_NAME=your-app-name bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/reliefweb-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd reliefweb-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

## Configuration

All configuration is validated at startup via Zod schemas. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `RELIEFWEB_APP_NAME` | **Required.** Pre-approved appname for the ReliefWeb API v2. Register at reliefweb.int/help/api. | — |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path where the MCP server is mounted | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments | none |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_SESSION_MODE` | HTTP session handling: `stateless`, `stateful`, or `auto`. Shipped as `stateless` — no handler needs a session. | `auto` (resolves to `stateful`) |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC pressure loop (ms). Try `60000` if heap growth is observed under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

## Running the server

### Local development

- **Build and run the production version**:

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:http
  # or
  bun run start:stdio
  ```

- **Run checks and tests**:
  ```sh
  bun run devcheck  # Lints, formats, type-checks, and more
  bun run test      # Runs the test suite
  ```

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Eleven tools across reports, disasters, countries, jobs, training, and sources, plus the shared pagination, section-outline, and profile-archive helpers. |
| `src/mcp-server/resources` | Resource definitions. Report, disaster, and country resources. |
| `src/mcp-server/prompts` | Prompt definitions. Crisis briefing prompt. |
| `src/services/reliefweb` | ReliefWeb API service layer — HTTP client, filter builder, and response normalizers for all six content types. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `tests/` | Unit and integration tests, mirroring the `src/` structure. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
