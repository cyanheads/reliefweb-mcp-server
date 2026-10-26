/**
 * @fileoverview Real Bun/Node startup policy, including .env before static schema construction.
 * @module tests/config/limit-startup.test
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'reliefweb-limit-startup-'));
const outputParent = join(root, 'node_modules', '.cache');
mkdirSync(outputParent, { recursive: true });
const output = mkdtempSync(join(outputParent, 'reliefweb-limit-startup-'));
const bundle = join(output, 'probe.mjs');

beforeAll(() => {
  const entry = join(output, 'probe.ts');
  writeFileSync(
    entry,
    `import { z } from '@cyanheads/mcp-ts-core';
import { reliefwebSearchJobs } from '${root}/src/mcp-server/tools/definitions/search-jobs.tool.ts';
import { reliefwebGetCountry } from '${root}/src/mcp-server/tools/definitions/get-country.tool.ts';
import { getLimitConfig } from '${root}/src/config/server-config.ts';
const search = z.toJSONSchema(reliefwebSearchJobs.input).properties.limit;
const profile = z.toJSONSchema(reliefwebGetCountry.input).properties.archive.properties.limit;
process.stdout.write(JSON.stringify({ enabled: getLimitConfig().clampLimits, searchMaximum: search.maximum ?? null, archiveMaximum: profile.maximum ?? null, searchAccepted: reliefwebSearchJobs.input.safeParse({limit:1001}).success, archiveAccepted: reliefwebGetCountry.input.safeParse({iso3:'SYR',archive:{list:'keyContent',limit:101}}).success }));
`,
  );
  execFileSync(
    'bun',
    [
      'build',
      entry,
      '--target=node',
      '--packages=external',
      '--outfile',
      bundle,
      '--tsconfig-override',
      join(root, 'tsconfig.json'),
    ],
    { cwd: root, stdio: 'pipe', timeout: 10000 },
  );
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
});

describe.each(['bun', 'node'])('%s startup limit policy', (runtime) => {
  it.each([
    ['default', undefined, undefined, true],
    ['shell false', 'false', undefined, false],
    ['dotenv false', undefined, 'false', false],
    ['shell overrides dotenv', 'true', 'false', true],
    ['stringbool off', 'off', undefined, false],
  ] as const)('%s resolves before schemas without an appname', (_label, shell, dotenv, enabled) => {
    const cwd = mkdtempSync(join(scratch, 'case-'));
    if (dotenv !== undefined)
      writeFileSync(join(cwd, '.env'), `RELIEFWEB_CLAMP_LIMITS=${dotenv}\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, RELIEFWEB_APP_NAME: '' };
    delete env.RELIEFWEB_CLAMP_LIMITS;
    if (shell !== undefined) env.RELIEFWEB_CLAMP_LIMITS = shell;
    const result = spawnSync(runtime, [bundle], { cwd, env, encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      enabled,
      searchMaximum: enabled ? Number.MAX_SAFE_INTEGER : 1000,
      archiveMaximum: enabled ? Number.MAX_SAFE_INTEGER : 100,
      searchAccepted: enabled,
      archiveAccepted: enabled,
    });
  });

  it('rejects an invalid boolean rather than treating it as truthy', () => {
    const cwd = mkdtempSync(join(scratch, 'invalid-'));
    const result = spawnSync(runtime, [bundle], {
      cwd,
      env: { ...process.env, RELIEFWEB_APP_NAME: '', RELIEFWEB_CLAMP_LIMITS: 'invalid' },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('RELIEFWEB_CLAMP_LIMITS');
  });
});
