import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/community-table.webp': ['community-table.webp', 'image/webp'],
  '/intersectionist-party-overview.pdf': ['intersectionist-party-overview.pdf', 'application/pdf'],
};

const assets = {};
for (const [route, [name, type]] of Object.entries(files)) {
  const bytes = await readFile(new URL('../public/' + name, import.meta.url));
  assets[route] = { type, base64: bytes.toString('base64') };
}

const views = await readFile(new URL('../worker/views.mjs', import.meta.url), 'utf8');
const emailAuth = await readFile(new URL('../worker/email-auth.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');
const trustSitesIdentity = existsSync(new URL('../.openai/hosting.json', import.meta.url));
const output = new URL('../dist/server/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL('index.js', output),
  'const trustSitesIdentity = ' + trustSitesIdentity + ';\n'
    + 'const staticAssets = ' + JSON.stringify(assets) + ';\n\n' + views + '\n\n' + emailAuth + '\n\n' + app,
);
