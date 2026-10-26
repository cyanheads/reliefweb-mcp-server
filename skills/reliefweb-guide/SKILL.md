---
name: reliefweb-guide
description: Use reliefweb_* tools for country or disaster research and humanitarian job or training shortlists. Resolve names, distinguish historical coverage, and check completeness before concluding that evidence or opportunities are absent.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use ReliefWeb for curated humanitarian reports, country and disaster profiles, vacancies, and training. Editorial indexing can lag events: an empty search does not establish that an emergency has not occurred. Geographic filtering is by country, not coordinates or a bounding box. These tools retrieve published material; they do not submit applications, registrations, or content.

## Identifiers

When the user gives a country name rather than an ISO3 code, find it with `reliefweb_list_countries` and reuse the returned ISO3 across the task. Do not substitute the name into a country filter. Resolve an unfamiliar organization with `reliefweb_list_sources` and use its returned shortname, not its numeric source ID. If no shortname is returned, do not invent one.

Resolve a disaster name or GLIDE number with `reliefweb_search_disasters`. Its numeric disaster ID identifies both the disaster detail and the disaster's linked reports; it is not a report ID. Report, job, and training searches yield IDs for their respective detail tools.

## Gates

- Before declaring no matches, inspect the applied filters and `totalCount`. An empty page with a positive total is a pagination boundary, not an empty corpus. Use the effective page size disclosed by the response when a requested limit was clamped; follow `nextOffset` where provided.
- Before declaring historical coverage complete, choose the right archive: archived disaster/job/training records require archive-inclusive searches; archived country/disaster curated links require the profile's archive pages. Reports have no separate archived class, so changing their archive switch cannot broaden coverage.
- Before claiming a curated list contains no older material, read its archive and follow returned `nextOffset` values until absent. Those pages use upstream order and cannot be filtered or sorted. A report search is not a substitute for a curated-link archive.
- Before drawing a conclusion from document text, retrieve the relevant detail and, if it is an outline, the needed named sections. An outline establishes available sections, not their contents. Use tools for section and archive retrieval; resource reads return the whole active record without those selectors.
- Before retrying a rejected query, correct the input identified by `invalid_query`. For malformed text, prefer plain keywords or repair balanced parentheses and complete boolean expressions. Do not change filters in response to an upstream availability failure or treat that failure as zero results.

## Core chain

For a country brief, resolve ISO3, read `reliefweb_get_country`, and search country-tagged reports and disasters. For a named disaster, resolve the disaster first, read `reliefweb_get_disaster`, then search reports linked to that disaster ID. Use dates and document text from the selected reports to support the brief; distinguish their source publication dates from index dates.

## Workflows

### Humanitarian evidence and historical research

Start with the country or disaster profile's curated material, then search for the evidence the question needs. Keep country-wide findings separate from reports linked to one disaster. For a historical period, check record coverage and curated-link archives separately before reporting an absence. Report the searched period and filters with any negative finding; editorial coverage is not a complete event register.

For compound report conditions beyond named filters, use the report tool's raw filter: conditions refer to report fields. In that context `id` is the report ID and `disaster.id` is its linked disaster ID. Prefer the named disaster filter for the ordinary chain.

### Jobs and training

For a country-based shortlist, resolve ISO3 first. A disaster name or GLIDE number remains a text-search target for jobs and training; it is not a country code. Resolve the organizer separately when organization scope matters.

Use role titles as text searches and career categories as career tracks; a sector/theme is a separate classification. Use current listings for an opportunities snapshot and archive-inclusive searches for posting or course history. Historical training also needs an explicit period when the task is period-specific; an ordinary unbounded training search starts from now.

For training, distinguish the listing's language from the language of instruction. Use delivery-language and cost metadata for those requirements; an English listing can describe French-delivered training. Missing delivery-language or fee metadata does not establish a language or that a course is free.

Read `reliefweb_get_job` or `reliefweb_get_training` for shortlisted candidates before describing application instructions, registration requirements, or fee details. Archived details support historical analysis; retrieving them does not establish that applications or registration remain open.
