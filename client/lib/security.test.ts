import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(root: string): string[] { return readdirSync(root).flatMap((name) => { const path = join(root, name); return statSync(path).isDirectory() ? files(path) : [path]; }); }

describe('browser security boundaries', () => {
  const source = files(join(process.cwd(), 'client')).filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith('.test.ts')).map((file) => readFileSync(file, 'utf8')).join('\n');
  it('never references a service-role browser variable', () => expect(source).not.toMatch(/VITE_.*SERVICE|service[_-]?role/i));
  it('contains no AI or LLM integration surface', () => expect(source).not.toMatch(/anthropic|openai|ai_feature_consents|ai_runs/i));
  it('does not register a service worker or realtime channel', () => { expect(source).not.toMatch(/serviceWorker\.register/); expect(source).not.toMatch(/\.channel\(/); });
});
