#!/usr/bin/env node
/**
 * @fileoverview reliefweb-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
// Prompts
import { reliefwebCrisisBriefing } from './mcp-server/prompts/definitions/crisis-briefing.prompt.js';
import { countryResource } from './mcp-server/resources/definitions/country.resource.js';
import { disasterResource } from './mcp-server/resources/definitions/disaster.resource.js';
// Resources
import { reportResource } from './mcp-server/resources/definitions/report.resource.js';
import { reliefwebGetCountry } from './mcp-server/tools/definitions/get-country.tool.js';
import { reliefwebGetDisaster } from './mcp-server/tools/definitions/get-disaster.tool.js';
import { reliefwebGetReport } from './mcp-server/tools/definitions/get-report.tool.js';
import { reliefwebListCountries } from './mcp-server/tools/definitions/list-countries.tool.js';
import { reliefwebListSources } from './mcp-server/tools/definitions/list-sources.tool.js';
import { reliefwebSearchDisasters } from './mcp-server/tools/definitions/search-disasters.tool.js';
import { reliefwebSearchJobs } from './mcp-server/tools/definitions/search-jobs.tool.js';
// Tools
import { reliefwebSearchReports } from './mcp-server/tools/definitions/search-reports.tool.js';
import { reliefwebSearchTraining } from './mcp-server/tools/definitions/search-training.tool.js';
import { initReliefWebService } from './services/reliefweb/reliefweb-service.js';

await createApp({
  tools: [
    reliefwebSearchReports,
    reliefwebGetReport,
    reliefwebSearchDisasters,
    reliefwebGetDisaster,
    reliefwebGetCountry,
    reliefwebListCountries,
    reliefwebSearchJobs,
    reliefwebSearchTraining,
    reliefwebListSources,
  ],
  resources: [reportResource, disasterResource, countryResource],
  prompts: [reliefwebCrisisBriefing],
  setup(core) {
    initReliefWebService(core.config, core.storage);
  },
});
