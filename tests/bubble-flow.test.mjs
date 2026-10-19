import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../game.js', import.meta.url), 'utf8');

// Exercise the actual game loop with a deterministic clock and input events.
// Canvas drawing is stubbed; browser visual checks cover the rendering separately.
function game(width = 390, height = 844, seed = 7) {
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
  const element = () => ({ ...events(), checked: false, hidden: false, classList: { add() {} },
    getContext: () => context, setPointerCapture() {} });
  const elements = Object.fromEntries(['game', 'welcome', 'parent-panel', 'start', 'resume', 'simple-effects',
    'quiet-sounds', 'safe-probe'].map(id => [id, element()]));
  const document = { ...events(), hidden: false, querySelector: selector => elements[selector.slice(1)], createElement: element };
  const window = { ...events(), innerWidth: width, innerHeight: height, devicePixelRatio: 1,
    visualViewport: { ...events(), width, height }, localStorage: { getItem() {}, setItem() {} } };
  const math = Object.create(Math);
  math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  let clock = 100, raf, timerId = 0;
  const timers = new Map();
  vm.runInNewContext(source, { window, document, navigator: {}, location: { search: '?test', protocol: 'http:' },
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
  return { step, advance, snapshot, tap, elements, document, window,
    resize(w, h) { window.visualViewport.width = w; window.visualViewport.height = h; window.emit('resize'); } };
}

test('idle play keeps bringing varied bubbles from edges without overcrowding', () => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
    const g = game(width, height);
    const seen = new Set();
    const sizes = [], directions = new Set();
    let clusterSeen = false, previous = g.snapshot(), emptyFor = 0, longestEmpty = 0;
    for (let frame = 0; frame < 60 * 90; frame++) {
      const state = g.step();
      assert.ok(state.bubbles.length <= state.target);
      const visible = state.bubbles.filter(b => b.x + b.r > 0 && b.x - b.r < width);
      emptyFor = visible.length ? 0 : emptyFor + 1 / 60;
      longestEmpty = Math.max(longestEmpty, emptyFor);
      for (const b of state.bubbles) {
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
        assert.ok(b.y >= b.r && b.y <= height - b.r);
        if (!seen.has(b.id)) {
          assert.ok(b.x < 0 || b.x > width, 'new bubbles must enter through an edge');
          seen.add(b.id); sizes.push(b.r); directions.add(b.direction);
        }
        clusterSeen ||= b.cluster !== null;
      }
      // Disappearances during idle play must happen at the destination edge.
      for (const old of previous.bubbles) {
        if (!state.bubbles.some(b => b.id === old.id)) {
          assert.ok(old.direction === 1 ? old.x - old.r > width : old.x + old.r < 0);
        }
      }
      previous = state;
    }
    assert.ok(seen.size > 20, 'the blowing rhythm must continue during idle play');
    assert.equal(directions.size, 2);
    assert.ok(Math.max(...sizes) / Math.min(...sizes) > 2);
    assert.ok(clusterSeen);
    assert.ok(longestEmpty < 1.5, `empty for ${longestEmpty.toFixed(2)} seconds at ${width}x${height}`);
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
