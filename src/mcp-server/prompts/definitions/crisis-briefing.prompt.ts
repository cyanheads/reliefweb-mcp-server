/**
 * @fileoverview Structured briefing template for a country or disaster situation on ReliefWeb.
 * @module mcp-server/prompts/definitions/crisis-briefing
 */

import { prompt, z } from '@cyanheads/mcp-ts-core';

export const reliefwebCrisisBriefing = prompt('reliefweb_crisis_briefing', {
  description:
    'Generate a structured humanitarian briefing for a country or disaster. ' +
    'Instructs the agent to use available ReliefWeb tools to gather recent reports, active disasters, open positions, and training opportunities, ' +
    'then synthesize a concise situation overview. ' +
    'Specify focus=situation for a situation-only brief, focus=jobs for open positions, or focus=full for the complete briefing.',
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
- Use reliefweb_get_country (if this is a country) or reliefweb_get_disaster (if this is a disaster) to fetch the current overview and key content links.
- Search for the 5 most recent Situation Reports using reliefweb_search_reports with text="${target}" and format="Situation Report".
- Search for active disasters with reliefweb_search_disasters filtered by country or text.
- Summarize the current humanitarian situation in 3–5 sentences, citing report titles and dates.
- List active disasters with status, GLIDE number, and primary type.
- List key appeals and response plans from the country/disaster profile.`;

    const jobsSection = `## Open Positions
- Determine whether "${target}" is a country/ISO3 code or a disaster name/GLIDE number.
  - If it is a country or ISO3 code: call reliefweb_search_jobs with country="${target}".
  - If it is a disaster name or GLIDE number: call reliefweb_search_jobs with text="${target}" (the country= filter expects an ISO3 code; passing a disaster name returns no results).
- Group by organization and career category.
- List title, organization, closing date, and URL for each position.
- Note total count and any recurring roles (e.g., multiple UNHCR positions).`;

    const trainingSection = `## Training Opportunities
- Determine whether "${target}" is a country/ISO3 code or a disaster name/GLIDE number.
  - If it is a country or ISO3 code: call reliefweb_search_training with country="${target}".
  - If it is a disaster name or GLIDE number: call reliefweb_search_training with text="${target}".
- List title, organizer, start date, format, and URL for each opportunity.`;

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

${sections}

## Notes
- If the country/disaster is not found, say so and suggest checking the spelling or using reliefweb_list_countries.
- Use ISO3 codes (AFG, SYR, UKR) when filtering by country.
- Limit API calls: use field-specific searches rather than broad full-text queries to stay within the 1,000-call/day quota.
- All dates in ISO 8601 format.`;

    return [{ role: 'user', content: { type: 'text', text: message } }];
  },
});
