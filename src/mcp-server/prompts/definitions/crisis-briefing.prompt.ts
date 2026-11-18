/**
 * @fileoverview Structured briefing template for a country or disaster situation on ReliefWeb.
 * @module mcp-server/prompts/definitions/crisis-briefing
 */

import { prompt, z } from '@cyanheads/mcp-ts-core';

export const reliefwebCrisisBriefing = prompt('reliefweb_crisis_briefing', {
  description:
    'Generate a structured humanitarian briefing for a country or disaster. Instructs the agent to use available ReliefWeb tools to gather recent reports, active disasters, open positions, and training opportunities, then synthesize a concise situation overview. Specify focus=situation for a situation-only brief, focus=jobs for open positions, or focus=full for the complete briefing.',
  args: z.object({
    country_or_disaster: z
      .string()
      .describe(
        'Country name or ISO3 code (e.g., "Afghanistan" or "AFG"), or a disaster name/GLIDE number (e.g., "Syria earthquake" or "EQ-2023-000053-TUR").',
      ),
    focus: z
      .enum(['situation', 'jobs', 'full'])
      .optional()
      .describe(
        'Briefing scope. situation = situation overview and recent reports only. jobs = open positions and training only. full = complete briefing including situation, reports, disasters, jobs, and training (default).',
      ),
  }),
  generate: (args) => {
    const focus = args.focus ?? 'full';
    const target = args.country_or_disaster;

    const situationSection = `## Situation Overview
- For a country, use reliefweb_get_country with iso3=<ISO3> for the overview and key content links. Search reliefweb_search_reports with country=<ISO3>, format="Situation Report", and limit=5; search reliefweb_search_disasters with country=<ISO3> and status="alert,ongoing" for active disasters.
- For a disaster name or GLIDE number, search reliefweb_search_disasters with text="${target}" to obtain its numeric ID, then use reliefweb_get_disaster with that ID. Search reliefweb_search_reports with disaster_id=<resolved ID>, format="Situation Report", and limit=5.
- Summarize the current humanitarian situation in 3–5 sentences, citing report titles and dates.
- List active disasters with status, GLIDE number, and primary type.
- List key appeals and response plans from the country/disaster profile.`;

    const jobsSection = `## Open Positions
- Use the country/disaster classification resolved above.
  - If it is a country or ISO3 code: call reliefweb_search_jobs with country=<ISO3>.
  - If it is a disaster name or GLIDE number: call reliefweb_search_jobs with text="${target}" (country= takes ISO3 codes only and rejects a disaster name).
- Group by organization and career category.
- List title, organization, closing date, and URL for each position.
- Note total count and any recurring roles (e.g., multiple UNHCR positions).`;

    const trainingSection = `## Training Opportunities
- Use the country/disaster classification resolved above.
  - If it is a country or ISO3 code: call reliefweb_search_training with country=<ISO3>.
  - If it is a disaster name or GLIDE number: call reliefweb_search_training with text="${target}".
- List title, organizer, format, and URL for each opportunity, plus its start date when it has one: the default search also returns listings with no start date (most online courses), so mark those as undated rather than leaving them out.`;

    let sections: string;
    if (focus === 'situation') {
      sections = situationSection;
    } else if (focus === 'jobs') {
      sections = `${jobsSection}\n\n${trainingSection}`;
    } else {
      sections = `${situationSection}\n\n${jobsSection}\n\n${trainingSection}`;
    }

    const message = `You are preparing a humanitarian briefing for: **${target}**

Use the available ReliefWeb tools to gather current data, then produce a structured briefing with the sections below. Cite specific report titles, IDs, and dates. Do not invent data — only include what the tools return.

## Resolve the target
- Determine whether "${target}" is a country name, an ISO3 code, or a disaster name/GLIDE number.
- A country name must first be resolved to its ISO3 code: call reliefweb_list_countries({text:"<country name>"}) and read the matching country's ISO3 code. text matches whole words of the official or short name, so an exonym or a partial name can miss; when it returns no match, fall back to the full listing, reliefweb_list_countries({limit:1000}), and if totalCount exceeds the returned page, continue with offset until the country is found or the listing is exhausted. An ISO3 input can be used directly.
- Reuse that code wherever <ISO3> appears below. Never substitute a country name into country= or iso3=. Keep disaster names and GLIDE numbers on the separate disaster branch; do not resolve them as countries.

${sections}

## Notes
- If the country/disaster is not found, say so and suggest checking the spelling or looking the country up by name with reliefweb_list_countries text.
- Use ISO3 codes (AFG, SYR, UKR) when filtering by country.
- Limit API calls: use field-specific searches rather than broad full-text queries to stay within the 1,000-call/day quota.
- All dates in ISO 8601 format.`;

    return [{ role: 'user', content: { type: 'text', text: message } }];
  },
});
