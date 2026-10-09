<div align="center">
  <h1>@cyanheads/reliefweb-mcp-server</h1>
  <p><b>Search ReliefWeb humanitarian reports, disasters, jobs, training, and country profiles via MCP. STDIO or Streamable HTTP.</b>
  <div>11 Tools • 3 Resources • 1 Prompt</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.2-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/reliefweb-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.2.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/reliefweb-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/reliefweb-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.2-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/reliefweb-mcp-server/releases/latest/download/reliefweb-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=reliefweb-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvcmVsaWVmd2ViLW1jcC1zZXJ2ZXIiXSwiZW52Ijp7IlJFTElFRldFQl9BUFBfTkFNRSI6InlvdXItYXBwLW5hbWUifX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22reliefweb-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Freliefweb-mcp-server%22%5D%2C%22env%22%3A%7B%22RELIEFWEB_APP_NAME%22%3A%22your-app-name%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://reliefweb.caseyjhand.com/mcp](https://reliefweb.caseyjhand.com/mcp)

</div>

---

## Overview

Humanitarian reports, disasters, jobs, training opportunities, and country profiles from ReliefWeb, OCHA's information hub for crisis response. Search, fetch, and page through all six ReliefWeb content types from any MCP client. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

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

### Resources

| Resource | Description |
|:---|:---|
| `reliefweb://reports/{id}` | Full report record by numeric ID — metadata, body text, and file URLs. The ID segment must be digits only |
| `reliefweb://disasters/{id}` | Disaster record by numeric ID — type, status, GLIDE, description, and content links. The ID segment must be digits only |
| `reliefweb://countries/{iso3}` | Country profile by ISO3 code — overview, situation summary, and active response plans |

### Prompts

| Prompt | Description |
|:---|:---|
| `reliefweb_crisis_briefing` | Generate a structured humanitarian briefing for a country or disaster |

## Capability reference

### `reliefweb_search_reports` <sub>tool</sub>

- Full-text query plus filters: country (ISO3), disaster ID, format, theme, language (ISO 639-1), and source shortname
- Date range filtering on source publication date (`date_from`/`date_to`) — a bare `2024-01-15` works alongside full ISO 8601
- Format is a closed set: `News and Press Release`, `Situation Report`, `Map`, `Infographic`, `Analysis`, `Other`, `Assessment`, `Manual and Guideline`, `Appeal`, `UN Document`, `Evaluation and Lessons Learned` — matched ignoring case, spacing, and punctuation; anything else is rejected with the list
- Raw `filter` object for compound conditions the named params don't cover
- Pagination via `offset`/`limit`, up to 1,000 per call (default 10)
- `include_archived` has no effect — reports carry no archived class, so every report is already in scope

---

### `reliefweb_get_report` <sub>tool</sub>

- Full body HTML, all metadata, and file attachment URLs
- Use after `reliefweb_search_reports` to retrieve content — bodies run 10–100KB
- Over the response budget, returns a section outline instead; `sections: ["body"]` pulls the body back on its own
- Returns structured `not_found` when the ID doesn't exist

---

### `reliefweb_search_disasters` <sub>tool</sub>

- Filtering by disaster type, country, status, and GLIDE number for cross-system correlation
- Date range filtering on disaster creation date (`date_from`/`date_to`) — a bare `2024-01-15` works alongside full ISO 8601
- Status is a closed set: `alert`, `ongoing`, `past`, `alert-archive`; comma-separate for multiple, matched ignoring case, spacing, and punctuation
- `alert-archive` is reachable only with `include_archived=true` — the default preset hides it
- Pagination via `offset`/`limit`, up to 1,000 per call (default 10)
- Returns IDs for `reliefweb_get_disaster` and as the `disaster_id` filter in `reliefweb_search_reports`

---

### `reliefweb_get_disaster` <sub>tool</sub>

- Full description, profile overview, affected countries, and GLIDE number
- Three curated lists — `keyContent`, `appealsResponsePlans`, `usefulLinks` — each returns only its currently-active entries; archived entries page via `archive: { list: <name> }`
- Major disasters run to tens of KB; over the response budget the record becomes a section outline, and `sections: ["description"]` or `["profileOverview"]` pulls one narrative at a time
- `sections` and `archive` are alternative modes — a call supplying both is rejected
- Returns structured `not_found` when the ID doesn't exist

---

### `reliefweb_get_country` <sub>tool</sub>

- Situation overview text curated by OCHA editors
- Three curated lists — `keyContent`, `appealsResponsePlans`, `usefulLinks` — each returns only its currently-active entries; archived entries (thousands deep for a long-running crisis) page via `archive: { list: <name> }`
- `sections` and `archive` are alternative modes — a call supplying both is rejected
- Carries the same section-outline behavior as the other detail tools, though an active-only profile is small enough that it rarely reaches the budget
- Use `reliefweb_list_countries` to discover valid ISO3 codes
- Returns structured `not_found` for an unknown ISO3 code

---

### `reliefweb_list_countries` <sub>tool</sub>

- Optional `crisis_only=true` to limit to active humanitarian situations (status ongoing)
- Returns ISO3 codes, status, and canonical URLs — use ISO3 with `reliefweb_get_country`
- Pagination up to 1,000 entries per call (default 100)

---

### `reliefweb_search_jobs` <sub>tool</sub>

- Filtering by country, organization shortname, career category, theme, and experience level
- Returns current open postings by default; `include_archived=true` reaches the closed archive, far larger than the open set
- Sortable by newest posting (`date.created:desc`, default) or soonest closing (`date.closing:asc`)
- Pagination via `offset`/`limit`, up to 1,000 per call (default 10)
- Returns IDs for `reliefweb_get_job`

---

### `reliefweb_get_job` <sub>tool</sub>

- Full vacancy description and application instructions — neither is in search results
- Posting status, indexed / closing / last-modified dates, hiring organization, countries, career category, experience level, and job type
- Both canonical URLs (the readable alias and the node URL)
- Reaches expired postings as well as open ones
- Over the response budget, returns a section outline; `sections: ["howToApply"]` pulls the instructions without the whole description
- Returns structured `not_found` pointing back at `reliefweb_search_jobs`

---

### `reliefweb_search_training` <sub>tool</sub>

- Filtering by country, source, format (`on-site` or `online`), career category, and language
- Date range filtering on training start date (`date_start_from`/`date_start_to`) — a bare `2024-06-01` works alongside full ISO 8601
- Scoped to training starting from now when neither date bound is given; supply either one for an explicit range, including a historical one
- `include_archived=true` reaches concluded listings and drops the start-from-now default, so an otherwise unbounded search reaches the whole record
- Ordered by soonest start date by default (`date.start:asc`, distinct from report date fields); override with `sort`
- Returns IDs for `reliefweb_get_training`

---

### `reliefweb_get_training` <sub>tool</sub>

- Full description and registration instructions — neither is in search results
- Cost class, the organizer's fee detail, and the organizer's own event URL
- Listing status, start / end / registration / indexed dates, host cities, format, type, listing and delivery languages, organizing source, and both canonical URLs
- Reaches concluded listings as well as current ones
- Over the response budget, returns a section outline; `sections: ["cost", "feeInformation", "howToRegister"]` pulls just the practicalities
- Returns structured `not_found` pointing back at `reliefweb_search_training`

---

### `reliefweb_list_sources` <sub>tool</sub>

- Optional filtering by name text or organization `type`: `Government`, `International Organization`, `Non-governmental Organization`, `Academic and Research Institution`, `Media`, `Red Cross/Red Crescent Movement`, `Other`
- Returns short names, types, organization URLs, and homepage URLs
- Pagination via `offset`/`limit`, up to 1,000 per call (default 10)
- Use `shortname` with the `source` filter in `reliefweb_search_reports`, `reliefweb_search_jobs`, and `reliefweb_search_training`

---

### `reliefweb://reports/{id}` <sub>resource</sub>

- Full report record as `application/json` — metadata, body text, and file URLs
- `id` must be digits only, exactly as search returned it
- Always returns the whole record — no section selector; use `reliefweb_get_report` for an oversized report

---

### `reliefweb://disasters/{id}` <sub>resource</sub>

- Disaster record as `application/json` — type, status, GLIDE, description, and curated content links
- `id` must be digits only, exactly as search returned it
- Always returns the whole record — no section selector; use `reliefweb_get_disaster` for an oversized disaster or to page an archive

---

### `reliefweb://countries/{iso3}` <sub>resource</sub>

- Country profile as `application/json` — overview, situation summary, and active response plans
- Equivalent to calling `reliefweb_get_country`
- `iso3` must be a 3-letter ISO 3166-1 alpha-3 code

---

### `reliefweb_crisis_briefing` <sub>prompt</sub>

- Arguments: `country_or_disaster` required (name, ISO3 code, or GLIDE number); `focus` optional — `situation`, `jobs`, or `full` (default)
- Returns one user message instructing the agent to gather data with the ReliefWeb tools, then synthesize a briefing citing report titles and dates

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

ReliefWeb-specific:

- Full coverage of all six ReliefWeb content types: reports, disasters, countries, jobs, training, and sources
- Compound filter builder supporting nested AND/OR conditions for the ReliefWeb API v2
- Vocabulary matching for `format` and `status` filters normalizes case, spacing, and punctuation instead of requiring exact ReliefWeb spelling
- `RELIEFWEB_APP_NAME` validated at startup — required by the API since November 2025
- 1,000 calls/day API quota, surfaced in each search and list tool's upstream-error recovery text

Agent-friendly output:

- Body text excluded from search results by design — agents fetch it explicitly with the matching `reliefweb_get_*` tool to control context budget
- Oversized records outline rather than truncate, with a section selector to retrieve exactly what's needed
- Curated-profile archives are paged rather than dropped, with honest totals and a next offset while more remain
- Typed `not_found` error contracts and empty-result notices that echo applied filters and suggest how to broaden

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

Or with Docker:

```json
{
  "mcpServers": {
    "reliefweb-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "-e", "RELIEFWEB_APP_NAME=your-app-name",
        "ghcr.io/cyanheads/reliefweb-mcp-server:latest"
      ]
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

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env and set RELIEFWEB_APP_NAME
```

## Configuration

| Variable | Description | Default |
|:---|:---|:---|
| `RELIEFWEB_APP_NAME` | **Required.** Pre-approved appname for the ReliefWeb API v2. Register at reliefweb.int/help/api. | — |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path where the MCP server is mounted | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments | none |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_SESSION_MODE` | HTTP session handling: `stateless`, `stateful`, or `auto` (which resolves to `stateful`). The server declares `stateless` in `src/index.ts` — no handler needs a session — so set this only to override. | `stateless` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC pressure loop (ms). Try `60000` if heap growth is observed under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

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

### Docker

```sh
docker build -t reliefweb-mcp-server .
docker run --rm -e RELIEFWEB_APP_NAME=your-app-name -p 3010:3010 reliefweb-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/reliefweb-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

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
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
