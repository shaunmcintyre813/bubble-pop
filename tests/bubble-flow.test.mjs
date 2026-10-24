import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../game.js', import.meta.url), 'utf8');

// Exercise the actual game loop with a deterministic clock and input events.
// Canvas drawing is stubbed; browser visual checks cover the rendering separately.
function game(width = 390, height = 844, seed = 7, options = {}) {
  const events = () => ({
    listeners: new Map(),
    addEventListener(name, handler) {
      const handlers = this.listeners.get(name) || [];
      handlers.push(handler);
      this.listeners.set(name, handlers);
    },
    emit(name, data = {}) {
      for (const handler of this.listeners.get(name) || []) handler({ preventDefault() {}, ...data });
    }
  });
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => gradient : () => {} });
  const element = () => ({ ...events(), checked: false, hidden: false, disabled: false, textContent: '', classList: { add() {} },
    getContext: () => context, setPointerCapture() {} });
  const elements = Object.fromEntries(['game', 'welcome', 'parent-panel', 'start', 'resume', 'simple-effects',
    'quiet-sounds', 'safe-probe', 'welcome-prompt'].map(id => [id, element()]));
  const document = { ...events(), hidden: false, querySelector: selector => elements[selector.slice(1)], createElement: element };
  const storage = options.storage || new Map();
  const window = { ...events(), innerWidth: width, innerHeight: height, devicePixelRatio: 1,
    visualViewport: { ...events(), width, height }, localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); }
    } };
  const navigator = { onLine: options.online ?? true };
  if (options.serviceWorker) navigator.serviceWorker = options.serviceWorker;
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  let clock = 100, raf, timerId = 0;
  const timers = new Map();
  vm.runInNewContext(source, { window, document, navigator, location: { search: '?test', protocol: 'http:' },
    Math: math, URLSearchParams, getComputedStyle: () => ({}), requestAnimationFrame: callback => { raf = callback; },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: clock + delay }); return timerId; },
    clearTimeout: id => timers.delete(id) });
  const snapshot = () => JSON.parse(JSON.stringify(window.__bubblePopTest.snapshot()));
  const step = (seconds = 1 / 60) => {
    clock += seconds * 1000;
    for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
    raf(clock);
    return snapshot();
  };
  const advance = seconds => { for (let i = 0; i < Math.ceil(seconds * 60); i++) step(); return snapshot(); };
  const tap = (x, y, pointerId = 1) => {
    elements.game.emit('pointerdown', { clientX: x, clientY: y, pointerId });
    elements.game.emit('pointerup', { clientX: x, clientY: y, pointerId });
  };
  elements.start.emit('click');
  step();
  return { step, advance, snapshot, tap, elements, document, window, storage,
    resize(w, h) { window.visualViewport.width = w; window.visualViewport.height = h; window.emit('resize'); } };
}

test('first launch waits for the complete offline cache before enabling play', async () => {
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const worker = {
    state: 'installing',
    listeners: new Map(),
    addEventListener(name, callback) {
      const callbacks = this.listeners.get(name) || [];
      callbacks.push(callback);
      this.listeners.set(name, callbacks);
    },
    emit(name) { for (const callback of this.listeners.get(name) || []) callback(); }
  };
  const serviceWorker = { controller: null, ready, register: async () => ({ installing: worker }) };
  const g = game(390, 844, 7, { serviceWorker });

  assert.equal(g.snapshot().started, false);
  assert.equal(g.elements.start.disabled, true);
  assert.equal(g.elements.start.textContent, 'Preparing…');
  assert.equal(g.elements['welcome-prompt'].textContent, 'Preparing offline play…');

  await Promise.resolve();
  worker.state = 'activated';
  worker.emit('statechange');
  resolveReady({ active: worker });
  assert.equal(g.elements.start.disabled, false);
  assert.equal(g.elements.start.textContent, 'Tap to Play');
  assert.equal(g.elements['welcome-prompt'].textContent, 'Touch the bubbles!');

  g.elements.start.emit('click');
  const started = g.step();
  assert.equal(started.started, true);
  assert.ok(started.bubbles.length > 0);
});

test('an incomplete first cache unlocks online play with a clear retry message', async () => {
  const worker = {
    state: 'installing',
    listeners: new Map(),
    addEventListener(name, callback) {
      const callbacks = this.listeners.get(name) || [];
      callbacks.push(callback);
      this.listeners.set(name, callbacks);
    },
    emit(name) { for (const callback of this.listeners.get(name) || []) callback(); }
  };
  const serviceWorker = {
    controller: null,
    ready: new Promise(() => {}),
    register: async () => ({ installing: worker })
  };
  const g = game(390, 844, 7, { serviceWorker });
  await Promise.resolve();
  worker.state = 'redundant';
  worker.emit('statechange');

  assert.equal(g.elements.start.disabled, false);
  assert.match(g.elements['welcome-prompt'].textContent, /Keep online and reload/);
  g.elements.start.emit('click');
  assert.equal(g.step().started, true);
});

test('idle play fills once with gentle edge puffs and keeps every bubble available', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
    const g = game(width, height);
    const seen = new Set();
    const sizes = [], directions = new Set();
    let previous = g.snapshot(), emptyFor = 0, longestEmpty = 0;
    const speedLimit = Math.min(Math.max(width * .065, 25), 45) + 5.5;
    for (let frame = 0; frame < 60 * 90; frame++) {
      const state = g.step();
      assert.ok(state.bubbles.length <= state.target);
      const visible = state.bubbles.filter(b => b.x + b.r > 0 && b.x - b.r < width);
      emptyFor = visible.length ? 0 : emptyFor + 1 / 60;
      longestEmpty = Math.max(longestEmpty, emptyFor);
      const currentIds = new Set(state.bubbles.map(b => b.id));
      for (const old of previous.bubbles) assert.ok(currentIds.has(old.id), `bubble ${old.id} left without being popped`);
      for (const b of state.bubbles) {
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
        assert.ok(b.y >= b.r && b.y <= height - b.r);
        assert.ok(Math.abs(b.vx) <= speedLimit, `horizontal speed ${Math.abs(b.vx).toFixed(1)} exceeded ${speedLimit} at ${width}x${height}`);
        if (!seen.has(b.id)) {
          assert.ok(b.x < width * .25 || b.x > width * .75, 'new bubbles must enter near an edge');
          seen.add(b.id); sizes.push(b.r); directions.add(b.direction);
        }
      }
      previous = state;
    }
    assert.ok(seen.size >= g.snapshot().target, 'the first puffs should fill the play area');
    assert.ok(seen.size <= g.snapshot().target + 4, 'idle play should settle instead of continuously replacing bubbles');
    assert.ok(directions.size >= 1);
    assert.ok(Math.max(...sizes) / Math.min(...sizes) > 1.1);
    assert.ok(longestEmpty < 1.5, `empty for ${longestEmpty.toFixed(2)} seconds at ${width}x${height}`);
    assert.equal(g.snapshot().bubbles.length, g.snapshot().target, 'idle play should settle at its target count');
    if (width === 1440) {
      const settled = g.snapshot().bubbles;
      for (let i = 0; i < settled.length; i++) for (let j = i + 1; j < settled.length; j++) {
        const a = settled[i], b = settled[j];
        const sameCluster = a.cluster !== null && a.cluster === b.cluster;
        if (sameCluster && Math.min(a.age, b.age) < 3.5) continue;
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= (a.r + b.r) * .65,
          `settled bubbles ${a.id} and ${b.id} clumped together`);
      }
    }
  }
});

test('popping one clustered bubble leaves its neighbors and refills only from the edge', () => {
  const g = game();
  let state;
  for (let frame = 0; frame < 60 * 30; frame++) {
    state = g.step();
    if (state.bubbles.some(b => b.cluster && b.x > b.r + 10 && b.x < state.width - b.r - 10)) break;
  }
  const bubble = state.bubbles.find(b => b.cluster && b.x > b.r + 10 && b.x < state.width - b.r - 10);
  assert.ok(bubble);
  const before = state.bubbles.map(b => b.id);
  g.tap(bubble.x, bubble.y);
  state = g.snapshot();
  assert.equal(state.popCount, 1);
  assert.deepEqual(state.bubbles.map(b => b.id), before.filter(id => id !== bubble.id));
});

test('rapid tapping never overfills the screen or creates a long empty wait', () => {
  const g = game();
  let wait = 0, longestWait = 0;
  for (let frame = 0; frame < 60 * 30; frame++) {
    const state = g.step();
    assert.ok(state.bubbles.length <= state.target);
    const visible = state.bubbles.filter(b => b.x + b.r > 12 && b.x - b.r < state.width - 12);
    wait = visible.length ? 0 : wait + 1 / 60;
    longestWait = Math.max(longestWait, wait);
    for (const b of visible) g.tap(Math.max(1, Math.min(state.width - 1, b.x)), b.y);
  }
  assert.ok(g.snapshot().popCount > 40);
  assert.ok(longestWait < 1.5, `longest empty wait was ${longestWait.toFixed(2)} seconds`);
});

test('settings and a hidden page pause movement and the puff schedule', () => {
  const g = game();
  g.advance(.3);
  g.elements.game.emit('pointerdown', { pointerId: 2, clientX: 10, clientY: 10 });
  g.advance(1.1);
  const paused = g.snapshot();
  assert.equal(paused.settingsOpen, true);
  g.advance(12);
  g.tap(150, 300);
  assert.deepEqual(g.snapshot(), paused);
  g.elements.resume.emit('click');
  g.advance(.5);
  assert.notDeepEqual(g.snapshot().bubbles, paused.bubbles);
  g.document.hidden = true;
  g.document.emit('visibilitychange');
  const hidden = g.snapshot();
  g.advance(12);
  assert.deepEqual(g.snapshot(), hidden);
  g.document.hidden = false;
  g.document.emit('visibilitychange');
  g.advance(.5);
  assert.notDeepEqual(g.snapshot().bubbles, hidden.bubbles);
});

test('right-corner caregiver settings and preferences persist through an offline reload', () => {
  const storage = new Map();
  const g = game(390, 844, 7, { storage });
  g.elements.game.emit('pointerdown', { pointerId: 9, clientX: 380, clientY: 10 });
  g.advance(1.1);
  assert.equal(g.snapshot().settingsOpen, true);

  g.elements['simple-effects'].checked = true;
  g.elements['simple-effects'].emit('change');
  g.elements['quiet-sounds'].checked = true;
  g.elements['quiet-sounds'].emit('change');
  assert.equal(storage.get('bubble-pop-simple-effects'), '1');
  assert.equal(storage.get('bubble-pop-quiet-sounds'), '1');

  const activeOfflineWorker = {
    controller: {},
    ready: Promise.resolve({ active: {} }),
    register: async () => ({ installing: null })
  };
  const reopened = game(390, 844, 7, { storage, online: false, serviceWorker: activeOfflineWorker });
  assert.equal(reopened.elements['simple-effects'].checked, true);
  assert.equal(reopened.elements['quiet-sounds'].checked, true);
  assert.equal(reopened.snapshot().simpleEffects, true);
});

test('rotation retains existing bubbles and continues bounded play', () => {
  const g = game();
  g.advance(.4);
  const before = g.snapshot().bubbles.map(b => b.id);
  g.resize(844, 390);
  assert.deepEqual(g.snapshot().bubbles.map(b => b.id), before);
  for (let frame = 0; frame < 60 * 20; frame++) {
    const state = g.step();
    assert.ok(state.bubbles.length <= state.target);
    for (const b of state.bubbles) assert.ok(b.y >= b.r && b.y <= state.height - b.r);
  }
});

