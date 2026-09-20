# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.2.2](changelog/0.2.x/0.2.2.md) — 2026-09-20 · 🛡️ Security

mcp-ts-core ^0.13.6 brings InvalidParams/RequestCancelled error classification and an explicit stateless session mode; fixes a ReliefWeb appname leaking through client-facing error data on upstream failures.

## [0.2.1](changelog/0.2.x/0.2.1.md) — 2026-08-25

Framework bump to mcp-ts-core ^0.12.3 tightens the wire — tool inputs reject undeclared argument keys, the outputSchema declares the error envelope, and schemas emit as JSON Schema 2020-12 — plus scaffolded community-health files, a Docker multi-arch build fix, and a devcheck audit-classifier fix for Bun 1.4.

## [0.2.0](changelog/0.2.x/0.2.0.md) — 2026-08-06

reliefweb_get_job and reliefweb_get_training complete the search-to-get pattern for jobs and training, all five by-ID detail tools outline oversized records instead of truncating them, and reliefweb_get_country/reliefweb_get_disaster can page each curated list's archived entries.

## [0.1.16](changelog/0.1.x/0.1.16.md) — 2026-08-06

search_reports.format and search_disasters.status now match ReliefWeb's real closed vocabularies and reject unmatched values instead of returning an empty page, include_archived reaches the jobs and training archives, and malformed resource URI IDs are rejected instead of silently coerced to a different record.

## [0.1.15](changelog/0.1.x/0.1.15.md) — 2026-08-06

Upstream 400s now quote ReliefWeb's own rejection text and classify separately from service failures, date-range bounds accept a bare calendar date, search_training defaults to upcoming courses, and paging past the end of a result set names the last valid offset instead of reporting no matches.

## [0.1.14](changelog/0.1.x/0.1.14.md) — 2026-07-13

Bounds get_country/get_disaster to ReliefWeb's currently-active curated links, fixing crisis-country responses that exceeded the client token limit; adds a sort input to search_jobs and search_training, with training now defaulting to soonest-starting.

## [0.1.13](changelog/0.1.x/0.1.13.md) — 2026-07-13

Corrects filter behavior across the search tools — country filters match all tagged countries, list_sources text search covers organization short names, and documented type/format/status values match the ReliefWeb taxonomy; adopts mcp-ts-core ^0.10.14 and clears a transitive js-yaml advisory.

## [0.1.12](changelog/0.1.x/0.1.12.md) — 2026-06-20

mcp-ts-core ^0.10.9 maintenance: dependency-specifier + plugin-manifest devcheck guards, fresh-scaffold devcheck fixes, vendored framework skill sync

## [0.1.11](changelog/0.1.x/0.1.11.md) — 2026-06-15

Typed upstream_error contracts on all six search/list tools; appliedFilters echo and complete empty-result notices across the four search tools; notice enrichment on both list tools

## [0.1.10](changelog/0.1.x/0.1.10.md) — 2026-06-15

Server-level instructions on initialize; plugin manifest display identity unscoped to the hyphenated repo name; vitest ^4.1.9

## [0.1.9](changelog/0.1.x/0.1.9.md) — 2026-06-12

Adopt mcp-ts-core ^0.10.6; explicit createApp name/title identity; MCPB bundle cleaner; Docker OCI version label + healthcheck

## [0.1.8](changelog/0.1.x/0.1.8.md) — 2026-06-04

Three data-shape bug fixes: GET endpoint array envelope, profile sub-field nesting, source type single-object field

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-06-02

mcp-ts-core ^0.9.21: per-request log context fix, secret-scrubbing in fetchWithTimeout, withRetry fail-fast on non-retryable errors

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-05-30

enrichment adoption: search/list tools surface true upstream totals and empty-result guidance via typed enrichment block; structuredContent output.notice renamed from output.message

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-05-28

mcp-ts-core ^0.9.9 → ^0.9.13: 413 body cap, HTTP session-init gate, quieter 401/403/400/404 logging, GET /mcp keywords; plugin metadata files; skill updates

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-05-24

Code simplification, error code corrections, description alignment, mcp-ts-core ^0.9.7 → ^0.9.9

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-05-24

Fix empty RELIEFWEB_APP_NAME validation and crisis_briefing country/disaster disambiguation

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-05-23

Metadata alignment — package.json, Dockerfile, manifest.json, server.json, README, AGENTS.md, bunfig.toml

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-05-23

ReliefWeb humanitarian crisis data — 9 tools, 3 resources, 1 prompt

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-05-23

Initial release — ReliefWeb humanitarian data API: 9 tools, 3 resources, 1 prompt
