/**
 * @fileoverview Server-specific configuration for reliefweb-mcp-server.
 * Reads RELIEFWEB_APP_NAME from the environment and fails fast at startup
 * if it is missing — the ReliefWeb API enforces pre-approved appnames since Nov 2025.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { config, parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const LimitConfigSchema = z.object({
  clampLimits: z.stringbool().default(true).describe('Clamp over-cap integer page sizes.'),
});

let limitConfig: z.infer<typeof LimitConfigSchema> | undefined;

/** Resolves the startup schema policy after the framework loads Node's .env, without requiring an API appname. */
export function getLimitConfig(): z.infer<typeof LimitConfigSchema> {
  // The supported lazy core config access loads .env on Node before server parsing.
  void config.environment;
  limitConfig ??= parseEnvConfig(LimitConfigSchema, { clampLimits: 'RELIEFWEB_CLAMP_LIMITS' });
  return limitConfig;
}

const ServerConfigSchema = z.object({
  appName: z.string().min(1).describe('Pre-approved appname for the ReliefWeb API v2.'),
  clampLimits: z.boolean().describe('Whether over-cap integer page sizes are clamped.'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  const limits = getLimitConfig();
  _config ??= {
    ...parseEnvConfig(ServerConfigSchema.omit({ clampLimits: true }), {
      appName: 'RELIEFWEB_APP_NAME',
    }),
    ...limits,
  };
  return _config;
}
