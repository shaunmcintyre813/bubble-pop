import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveRequestPath } from '../dev-server.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_BASE = new URL('https://example.github.io/bubble-pop/');
const MANIFEST_URL = new URL('manifest.webmanifest', PAGES_BASE);
const SERVICE_WORKER_URL = new URL('sw.js', PAGES_BASE);

async function assertProjectFile(url) {
  assert.equal(url.origin, PAGES_BASE.origin);
  assert.ok(url.pathname.startsWith(PAGES_BASE.pathname), `${url.href} must stay under /bubble-pop/`);
  const relativePath = decodeURIComponent(url.pathname.slice(PAGES_BASE.pathname.length));
  await access(resolve(ROOT, relativePath || 'index.html'));
}

test('HTML assets resolve to existing files beneath the GitHub Pages project path', async () => {
  const html = await readFile(resolve(ROOT, 'index.html'), 'utf8');
  const references = [...html.matchAll(/\b(?:src|href)="(\.\/[^"#]+)"/g)].map((match) => match[1]);
  assert.ok(references.length > 0, 'index.html should declare relative assets');

  for (const reference of references) await assertProjectFile(new URL(reference, PAGES_BASE));
});

test('manifest start URL, scope, and icons stay within /bubble-pop/', async () => {
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(new URL(manifest.start_url, MANIFEST_URL).pathname, PAGES_BASE.pathname);
  assert.equal(new URL(manifest.scope, MANIFEST_URL).pathname, PAGES_BASE.pathname);
  assert.ok(manifest.icons.length > 0);

  for (const icon of manifest.icons) await assertProjectFile(new URL(icon.src, MANIFEST_URL));
});

test('service worker registration and precache assets resolve within its project scope', async () => {
  const [game, worker] = await Promise.all([
    readFile(resolve(ROOT, 'game.js'), 'utf8'),
    readFile(resolve(ROOT, 'sw.js'), 'utf8')
  ]);
  assert.match(game, /register\('\.\/sw\.js',\s*\{\s*scope:\s*'\.\/'\s*\}\)/);
  assert.match(worker, /const CACHE_PREFIX = `bubble-pop-\$\{encodeURIComponent\(BASE_URL\.pathname\)\}-`/);
  assert.match(worker, /k\.startsWith\(CACHE_PREFIX\)/);

  const assetsMatch = worker.match(/const ASSET_PATHS = (\[[^;]+\]);/s);
  assert.ok(assetsMatch, 'service worker should declare its precache paths');
  const assets = [...assetsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(assets.length > 0);
  for (const asset of assets) await assertProjectFile(new URL(asset, SERVICE_WORKER_URL));
});

test('local server maps both root and /bubble-pop/ and rejects path traversal', () => {
  assert.equal(resolveRequestPath('/'), resolve(ROOT, 'index.html'));
  assert.equal(resolveRequestPath('/bubble-pop/'), resolve(ROOT, 'index.html'));
  assert.equal(resolveRequestPath('/bubble-pop/styles.css'), resolve(ROOT, 'styles.css'));
  assert.equal(resolveRequestPath('/bubble-pop/../../README.md'), null);
  assert.equal(resolveRequestPath('/.git/config'), null);
});

test('phone layout includes dynamic viewport and compact landscape rules without auto-fullscreen', async () => {
  const [html, css, game] = await Promise.all([
    readFile(resolve(ROOT, 'index.html'), 'utf8'),
    readFile(resolve(ROOT, 'styles.css'), 'utf8'),
    readFile(resolve(ROOT, 'game.js'), 'utf8')
  ]);
  assert.match(html, /id="quiet-sounds"/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /@media\s*\(max-height:\s*560px\)\s*and\s*\(orientation:\s*landscape\)/);
  assert.match(game, /visualViewport\?\.addEventListener\('resize'/);
  assert.doesNotMatch(game, /requestFullscreen/);
});
