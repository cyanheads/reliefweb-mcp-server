/**
 * @fileoverview Bundle pruning preserves runtime skill modules while removing dependency agent documents.
 */
import { describe, expect, it } from 'vitest';
import { filterAgentDocEntries } from '../../scripts/clean-mcpb.js';
import { AGENT_DOC_ENTRY } from '../../scripts/lint-packaging.js';

describe('MCPB agent-document pruning', () => {
  const documents = [
    'node_modules/plain/skills/guide/SKILL.md',
    'node_modules/@scope/pkg/framework-skills/add-tool/SKILL.md',
    'node_modules/plain/.claude/settings.json',
    'node_modules/@scope/pkg/.agents/config.json',
    'node_modules/outer/node_modules/@scope/inner/skills/guide/reference.md',
    'node_modules/@scope/outer/node_modules/inner/node_modules/deep/.claude/settings.json',
    'node_modules/plain/docs/SKILL.md',
  ];

  it('removes dependency agent documents, including nested package copies', () => {
    expect(filterAgentDocEntries(documents)).toEqual(documents);
    expect(documents.filter((entry) => AGENT_DOC_ENTRY.test(entry))).toEqual(documents);
  });

  it('preserves SDK skill runtime modules and the server guide', () => {
    const runtime = [
      'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
      'node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
      'node_modules/@modelcontextprotocol/server/dist/ext/skills/loader.mjs',
      'node_modules/outer/node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
      'node_modules/plain/lib/skills/read.js',
      'skills/reliefweb-guide/SKILL.md',
    ];
    expect(filterAgentDocEntries(runtime)).toEqual([]);
    expect(runtime.filter((entry) => AGENT_DOC_ENTRY.test(entry))).toEqual([]);
  });
});
