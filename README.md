<div align="center">
  <h1>@cyanheads/reliefweb-mcp-server</h1>
  <p><b>Search ReliefWeb humanitarian reports, disasters, jobs, and training from OCHA via MCP. STDIO or Streamable HTTP.</b>
  <div>9 Tools • 3 Resources • 1 Prompt</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.2-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/reliefweb-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/reliefweb-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/reliefweb-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.2-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/reliefweb-mcp-server/releases/latest/download/reliefweb-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=reliefweb-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvcmVsaWVmd2ViLW1jcC1zZXJ2ZXIiXSwiZW52Ijp7IlJFTElFRldFQl9BUFBfTkFNRSI6InlvdXItYXBwLW5hbWUifX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22reliefweb-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Freliefweb-mcp-server%22%5D%2C%22env%22%3A%7B%22RELIEFWEB_APP_NAME%22%3A%22your-app-name%22%7D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Tools

9 tools for working with ReliefWeb humanitarian data:

| Tool | Description |
|:---|:---|
| `reliefweb_search_reports` | Search humanitarian reports with filtering by country, disaster, format, theme, language, source, and date |
| `reliefweb_get_report` | Fetch a single report by numeric ID with full body text and metadata |
| `reliefweb_search_disasters` | Search disasters by type, country, status, GLIDE number, and date range |
| `reliefweb_get_disaster` | Fetch a disaster record with profile, key content links, appeals, and response plans |
| `reliefweb_get_country` | Fetch a country profile by ISO3 code with overview, appeals, and curated links |
| `reliefweb_list_countries` | List all countries tracked by ReliefWeb, filterable to active humanitarian situations |
| `reliefweb_search_jobs` | Search humanitarian job listings by country, organization, career category, and experience level |
| `reliefweb_search_training` | Search training and learning opportunities by format, country, career category, and date |
| `reliefweb_list_sources` | Browse contributing organizations by name and type |

### `reliefweb_search_reports`

Search humanitarian reports on ReliefWeb with rich filtering.

- Full-text search across title, body, and key metadata fields
- Filtering by country (ISO3), disaster ID, format, theme, language, and source organization
- Date range filtering on source publication date
- Raw filter object for compound conditions not covered by named params
- Pagination via offset and limit (up to 1,000 per call)
- Optional `include_archived=true` for historical research (includes expired and archived content)
- Returns paginated summaries — use `reliefweb_get_report` to fetch full body text
- Rate limit: 1,000 calls/day

---

### `reliefweb_get_report`

Fetch a single ReliefWeb report by its numeric ID with full body text.

- Full body HTML, all metadata, and file attachment URLs
- Use after `reliefweb_search_reports` to retrieve document content (10–100KB each)
- Returns structured `not_found` when the ID doesn't exist

---

### `reliefweb_search_disasters`

Search active and historical disasters on ReliefWeb.

- Filtering by disaster type (Earthquake, Flood, Cyclone, etc.), country, and status
- GLIDE number lookup for cross-system disaster correlation
- Date range filtering on disaster creation date
- Status values: `alert`, `current`, `past`, `alert-archive`, `archive`; multiple values comma-separated
- Optional `include_archived=true` for historical research
- Returns IDs for use with `reliefweb_get_disaster` and as `disaster_id` filter in `reliefweb_search_reports`

---

### `reliefweb_get_disaster`

Fetch a disaster record by ReliefWeb numeric ID with full details.

- Full description, profile overview, affected countries, and GLIDE number
- Curated key content links from the ReliefWeb editorial team
- Active appeals and response plans linked to the disaster
- Useful external links curated by ReliefWeb editors

---

### `reliefweb_get_country`

Fetch a country profile from ReliefWeb by ISO3 code.

- Situation overview text curated by OCHA editors
- Key content links maintained by ReliefWeb editors
- Active humanitarian appeals and response plans
- Useful external links for the country
- Country profiles are the authoritative situation summary for humanitarian responders

---

### `reliefweb_list_countries`

List all countries and territories tracked by ReliefWeb.

- Optional `crisis_only=true` to limit to active humanitarian situations (status alert or current)
- Returns ISO3 codes, status, and canonical URLs — use ISO3 with `reliefweb_get_country`
- Pagination up to 1,000 entries per call

---

### `reliefweb_search_jobs`

Search humanitarian job listings on ReliefWeb.

- Filtering by country, organization short name, career category, theme, and experience level
- Career category values: Programme and Project Management, Information and Communications Technology, Logistics and Telecommunications, and others
- Returns current open positions — archived jobs excluded by default
- Pagination with closing date and canonical URL per listing

---

### `reliefweb_search_training`

Search humanitarian training and learning opportunities.

- Covers workshops, e-learning, conferences, seminars, and other capacity-building events
- Filtering by country, source, format, career category, and language
- Date range filtering on training start date (`date_start_from` / `date_start_to`)
- Distinct from report date fields — uses `date.start` / `date.end`

---

### `reliefweb_list_sources`

Browse organizations that contribute content to ReliefWeb.

- Optional filtering by name text or organization type (Government, International Organization, NGO, Academia)
- Returns short names, types, organization URLs, and homepage URLs
- Use `shortname` with the `source` filter in `reliefweb_search_reports`, `reliefweb_search_jobs`, and `reliefweb_search_training`

## Resources and prompt

| Type | Name | Description |
|:---|:---|:---|
| Resource | `reliefweb://reports/{id}` | Full report record by numeric ID — metadata, body text, and file URLs |
| Resource | `reliefweb://disasters/{id}` | Disaster record by numeric ID — type, status, GLIDE, description, and content links |
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

- Body text excluded from search results by design — agents fetch it explicitly with `reliefweb_get_report` to control context budget
- Recovery hints on empty results — echoes applied filters and suggests how to broaden
- Typed `not_found` error contracts on get-by-ID tools with actionable recovery text

## Getting started

### Prerequisites

- [Bun v1.3.2](https://bun.sh/) or higher.
- A **pre-approved ReliefWeb appname** — register at [ReliefWeb API](https://reliefweb.int/help/api) and set `RELIEFWEB_APP_NAME`. The API has required pre-approved appnames since November 2025; requests without one are rejected.

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "reliefweb": {
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
    "reliefweb": {
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
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Nine tools across reports, disasters, countries, jobs, training, and sources. |
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
