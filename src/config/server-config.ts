/**
 * @fileoverview Server-specific configuration for reliefweb-mcp-server.
 * Reads RELIEFWEB_APP_NAME from the environment and fails fast at startup
 * if it is missing — the ReliefWeb API enforces pre-approved appnames since Nov 2025.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  appName: z.string().min(1).describe('Pre-approved appname for the ReliefWeb API v2.'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    appName: 'RELIEFWEB_APP_NAME',
  });
  return _config;
}
