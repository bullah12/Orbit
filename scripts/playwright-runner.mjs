import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const server = await preview({
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});

const cli = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: process.env,
  stdio: 'inherit',
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});

await new Promise((resolve) => server.httpServer.close(resolve));
process.exitCode = exitCode;
