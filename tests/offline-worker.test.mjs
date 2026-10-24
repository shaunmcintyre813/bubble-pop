import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://shaunmcintyre813.github.io';
const BASE_PATH = '/bubble-pop/';
const BUBBLE_POP_CACHE_PREFIX = `bubble-pop-${encodeURIComponent(BASE_PATH)}-`;
const OLD_RELEASE_CACHE = `${BUBBLE_POP_CACHE_PREFIX}v10`;
const MOONLINE_CACHE = `bubble-pop-${encodeURIComponent('/moonline/')}-v4`;

function createServiceWorker({ failAfter = -1, omitLastAsset = false } = {}) {
  const stores = new Map([
    [OLD_RELEASE_CACHE, new Map([['old-working-release', { body: 'old working release', ok: true }]])],
    [MOONLINE_CACHE, new Map([['moonline-resource', { body: 'another game', ok: true }]])],
    ['sol-lightkeeper-v6', new Map([['sol-resource', { body: 'another game', ok: true }]])]
  ]);
  const handlers = new Map();
  let skipWaitingCount = 0;
  let claimCount = 0;
  let networkCalls = 0;
  let offline = false;

  const normalizeUrl = (value, ignoreSearch = false) => {
    const url = new URL(typeof value === 'string' ? value : value.url);
    return `${url.origin}${url.pathname}${ignoreSearch ? '' : url.search}`;
  };
  const makeResponse = (url, body) => ({
    url,
    body,
    ok: true,
    clone() { return this; }
  });
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(requests) {
          for (let index = 0; index < requests.length; index++) {
            const request = requests[index];
            if (index === failAfter) throw new TypeError('simulated failed resource download');
            if (omitLastAsset && index === requests.length - 1) continue;
            entries.set(normalizeUrl(request), makeResponse(request.url, `cached:${request.url}`));
          }
        },
        async match(request, options = {}) {
          return entries.get(normalizeUrl(request, options.ignoreSearch)) || null;
        },
        async put(request, response) {
          entries.set(normalizeUrl(request), response);
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  class TestRequest {
    constructor(url, options = {}) {
      this.url = typeof url === 'string' ? url : url.url;
      this.method = options.method || 'GET';
      this.cache = options.cache;
    }
  }
  const self = {
    location: { href: `${ORIGIN}${BASE_PATH}sw.js`, origin: ORIGIN },
    clients: { async claim() { claimCount++; } },
    addEventListener(name, callback) { handlers.set(name, callback); },
    async skipWaiting() { skipWaitingCount++; }
  };
  vm.runInNewContext(workerSource, {
    self,
    caches,
    URL,
    Request: TestRequest,
    Response: { error: () => ({ ok: false, body: 'network error' }) },
    fetch: async request => {
      networkCalls++;
      if (offline) throw new TypeError('simulated offline network');
      return makeResponse(request.url, `network:${request.url}`);
    }
  });

  async function dispatch(name, request) {
    const waitUntil = [];
    let responsePromise;
    handlers.get(name)({
      ...request,
      waitUntil(promise) { waitUntil.push(promise); },
      respondWith(promise) { responsePromise = Promise.resolve(promise); }
    });
    await Promise.all(waitUntil);
    return responsePromise ? responsePromise : undefined;
  }

  return {
    dispatch,
    stores,
    setOffline(value) { offline = value; },
    get skipWaitingCount() { return skipWaitingCount; },
    get claimCount() { return claimCount; },
    get networkCalls() { return networkCalls; }
  };
}

test('failed update discards only its candidate cache and keeps the active and neighboring games', async () => {
  const worker = createServiceWorker({ failAfter: 1 });
  await assert.rejects(worker.dispatch('install'), /simulated failed resource download/);

  assert.equal(worker.skipWaitingCount, 0, 'a partial cache must not activate');
  assert.deepEqual(worker.stores.has(OLD_RELEASE_CACHE), true);
  assert.deepEqual(worker.stores.has(MOONLINE_CACHE), true);
  assert.deepEqual(worker.stores.has('sol-lightkeeper-v6'), true);
  assert.deepEqual(worker.stores.has(`${BUBBLE_POP_CACHE_PREFIX}v11`), false);
});

test('incomplete cache validation blocks activation and preserves the previous release', async () => {
  const worker = createServiceWorker({ omitLastAsset: true });
  await assert.rejects(worker.dispatch('install'), /cache is incomplete/);

  assert.equal(worker.skipWaitingCount, 0);
  assert.equal(worker.stores.has(OLD_RELEASE_CACHE), true);
  assert.equal(worker.stores.has(`${BUBBLE_POP_CACHE_PREFIX}v11`), false);
});

test('fully staged release launches the cached page and gameplay script offline without deleting other games', async () => {
  const worker = createServiceWorker();
  await worker.dispatch('install');
  assert.equal(worker.skipWaitingCount, 1);

  const newCacheName = `${BUBBLE_POP_CACHE_PREFIX}v11`;
  const release = worker.stores.get(newCacheName);
  assert.ok(release);
  assert.equal(release.size, 7, 'the release cache includes the app shell, gameplay, styles, manifest, and icons');

  await worker.dispatch('activate');
  assert.equal(worker.claimCount, 1);
  assert.equal(worker.stores.has(OLD_RELEASE_CACHE), false);
  assert.equal(worker.stores.has(MOONLINE_CACHE), true);
  assert.equal(worker.stores.has('sol-lightkeeper-v6'), true);

  worker.setOffline(true);
  const offlinePage = await worker.dispatch('fetch', {
    request: { method: 'GET', mode: 'navigate', url: `${ORIGIN}${BASE_PATH}?homescreen=1` }
  });
  assert.equal(offlinePage.body, `cached:${ORIGIN}${BASE_PATH}index.html`);

  const offlineGameScript = await worker.dispatch('fetch', {
    request: { method: 'GET', mode: 'cors', url: `${ORIGIN}${BASE_PATH}game.js?release-check=1` }
  });
  assert.equal(offlineGameScript.body, `cached:${ORIGIN}${BASE_PATH}game.js`);
  assert.equal(worker.networkCalls, 1, 'only the offline navigation attempted the network');
});

