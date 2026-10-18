(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const welcome = document.querySelector('#welcome');
  const startButton = document.querySelector('#start');
  const simpleEffectsInput = document.querySelector('#simple-effects');
  const quietSoundsInput = document.querySelector('#quiet-sounds');
  const safeProbe = document.querySelector('#safe-probe');
  const palette = [188, 205, 267, 310, 35, 155, 285];
  const bubbles = [];
  const effects = [];
  let width = 0, height = 0, safe = { top: 0, right: 0, bottom: 0, left: 0 };
  let started = false, nextId = 0, lastFrame = 0, audio = null, popCount = 0;
  let simpleEffects = false;
  let spawnTimers = new Set();
  const activePointers = new Map();
  let soundOutput = null;
  let lastSound = -Infinity;
  const backdrop = document.createElement('canvas');

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const bounds = r => ({
    left: safe.left + r + 7, right: width - safe.right - r - 7,
    top: safe.top + r + 7, bottom: height - safe.bottom - r - 7
  });
  const targetCount = () => clamp(Math.floor(width * height / 44500), 5, 10);
  const radiusRange = () => {
    const shortest = Math.min(width, height);
    return [clamp(shortest * .102, 36, 53), clamp(shortest * .143, 48, 73)];
  };
  const placeWithinBounds = b => {
    const edge = bounds(b.r);
    b.x = clamp(b.x, Math.min(edge.left, width / 2), Math.max(edge.right, width / 2));
    b.y = clamp(b.y, Math.min(edge.top, height / 2), Math.max(edge.bottom, height / 2));
  };

  function resize() {
    width = window.visualViewport?.width ?? window.innerWidth;
    height = window.visualViewport?.height ?? window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBackdrop();
    const cs = getComputedStyle(safeProbe);
    safe = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
    for (const b of bubbles) placeWithinBounds(b);
    while (bubbles.length > targetCount()) bubbles.pop();
    if (started) fillBubbles();
  }

  function addBubble(center = false) {
    const [minR, maxR] = radiusRange();
    const r = rand(minR, maxR);
    const edge = bounds(r);
    let x, y, best = null;
    for (let i = 0; i < 36; i++) {
      const central = center && i < 24 && width > r * 4 && height > r * 5;
      const comfortable = i < 28 && height > r * 4;
      const left = central ? Math.max(edge.left, width * .22) : comfortable ? Math.max(edge.left, width * .12) : edge.left;
      const right = central ? Math.min(edge.right, width * .78) : comfortable ? Math.min(edge.right, width * .88) : edge.right;
      const top = central ? Math.max(edge.top, height * .28) : comfortable ? Math.max(edge.top, height * .16) : edge.top;
      const bottom = central ? Math.min(edge.bottom, height * .72) : comfortable ? Math.min(edge.bottom, height * .84) : edge.bottom;
      const px = rand(Math.min(left, right), Math.max(left, right));
      const py = rand(Math.min(top, bottom), Math.max(top, bottom));
      const spacing = bubbles.length ? Math.min(...bubbles.map(b => Math.hypot(px - b.x, py - b.y) - b.r - r)) : 100;
      if (!best || spacing > best.spacing) best = { x: px, y: py, spacing };
      if (spacing > (center ? 18 : 10)) break;
    }
    ({ x, y } = best);
    bubbles.push({ id: ++nextId, x, y, r, hue: palette[Math.floor(rand(0, palette.length))] + rand(-10, 10),
      vx: rand(-8, 8), vy: rand(-12, -3), phase: rand(0, Math.PI * 2), age: 0 });
  }
  function fillBubbles() { while (bubbles.length < targetCount()) addBubble(bubbles.length < 2); }
  function queueReplacement(center = false) {
    const timer = setTimeout(() => { spawnTimers.delete(timer); if (started && bubbles.length < targetCount()) addBubble(center); }, 260);
    spawnTimers.add(timer);
  }

  function sound(hue) {
    if (!audio || quietSoundsInput.checked) return;
    try {
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const now = audio.currentTime;
      // A swipe can pop several bubbles together; keep the sound soft and distinct.
      if (now - lastSound < .045) return;
      lastSound = now;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const pitch = 690 + (hue % 55) + rand(-18, 18);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(pitch, now);
      oscillator.frequency.exponentialRampToValueAtTime(pitch * .48, now + .035);
      oscillator.frequency.exponentialRampToValueAtTime(pitch * .29, now + .15);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.09, now + .004);
      gain.gain.exponentialRampToValueAtTime(.025, now + .04);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .16);
      oscillator.connect(gain).connect(soundOutput || audio.destination);
      oscillator.start(now);
      oscillator.stop(now + .17);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch (_) { /* Gameplay works without audio if the device blocks it. */ }
  }

  function popAt(x, y) {
    let nearest = -1, best = Infinity;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      const distance = Math.hypot(x - b.x, y - b.y);
      if (distance <= b.r + clamp(b.r * .42, 20, 32) && distance < best) {
        nearest = i; best = distance;
      }
    }
    if (nearest < 0) return false;
    const [b] = bubbles.splice(nearest, 1);
    effects.push({ type: 'pop', x: b.x, y: b.y, r: b.r, hue: b.hue, age: 0,
      particles: simpleEffects ? [] : Array.from({ length: 5 }, (_, i) => ({ angle: i * Math.PI * 2 / 5 + rand(-.2, .2), distance: rand(.85, 1.05), size: rand(1.8, 3.2) })) });
    if (effects.length > 24) effects.shift();
    sound(b.hue);
    popCount++;
    if (bubbles.length < Math.min(4, targetCount())) addBubble();
    queueReplacement(popCount % 6 < 2);
    return true;
  }

  function tapAt(x, y) {
    if (popAt(x, y)) return;
    effects.push({ type: 'miss', x, y, age: 0 });
    if (effects.length > 24) effects.shift();
  }

  function paintBackdrop() {
    // Stationary light is rendered only on resize, keeping phone frames inexpensive.
    backdrop.width = Math.ceil(width); backdrop.height = Math.ceil(height);
    const brush = backdrop.getContext('2d');
    const g = brush.createLinearGradient(0, 0, width * .4, height);
    g.addColorStop(0, '#304b68');
    g.addColorStop(.5, '#233b58');
    g.addColorStop(1, '#15283f');
    brush.fillStyle = g; brush.fillRect(0, 0, width, height);
    for (const [x, y, color] of [[.18, .16, '113, 184, 199'], [.86, .65, '129, 126, 185']]) {
      const glow = brush.createRadialGradient(width * x, height * y, 0, width * x, height * y, Math.max(width, height) * .65);
      glow.addColorStop(0, `rgba(${color}, .16)`); glow.addColorStop(1, `rgba(${color}, 0)`);
      brush.fillStyle = glow; brush.fillRect(0, 0, width, height);
    }
  }

  function drawBackground() {
    ctx.drawImage(backdrop, 0, 0, width, height);
  }

  function drawBubble(b) {
    const { x, y, r, hue } = b;
    ctx.save();
    const fill = ctx.createRadialGradient(x - r * .14, y - r * .18, r * .12, x, y, r);
    fill.addColorStop(0, `hsla(${hue}, 90%, 90%, .025)`);
    fill.addColorStop(.65, `hsla(${hue}, 85%, 80%, .06)`);
    fill.addColorStop(.88, `hsla(${hue + 25}, 90%, 80%, .17)`);
    fill.addColorStop(1, `hsla(${hue - 20}, 95%, 83%, .45)`);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.shadowBlur = 0;
    const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    rim.addColorStop(0, '#e9ffffe8');
    rim.addColorStop(.28, `hsla(${hue}, 95%, 84%, .85)`);
    rim.addColorStop(.5, '#d6c5ff70');
    rim.addColorStop(.72, '#ffcae3bd');
    rim.addColorStop(1, '#aefff1d9');
    ctx.lineWidth = Math.max(1.4, r * .027);
    ctx.strokeStyle = rim; ctx.stroke();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r * .88, 3.65, 5.05);
    ctx.lineWidth = r * .065; ctx.strokeStyle = '#ffffff25'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * .86, 3.95, 4.75);
    ctx.lineWidth = r * .037; ctx.strokeStyle = '#ffffffcf'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - r * .54, y - r * .56, r * .095, r * .044, -.7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffffe0'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * .9, .55, 1.65);
    ctx.lineWidth = r * .045; ctx.strokeStyle = `hsla(${hue + 65}, 95%, 85%, .42)`; ctx.stroke();
    ctx.restore();
  }

  function drawEffect(e) {
    if (e.type === 'miss') {
      const t = e.age / .25;
      ctx.save();
      ctx.strokeStyle = `rgba(218, 234, 249, ${Math.max(0, .32 * (1 - t))})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, 5 + t * 13, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const t = e.age / .38;
    const alpha = Math.max(0, 1 - t);
    ctx.save();
    ctx.strokeStyle = `hsla(${e.hue}, 95%, 88%, ${alpha * alpha * (simpleEffects ? .35 : .6)})`;
    ctx.lineWidth = 1.4 * (1 - t) + .5;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 - .26 * Math.min(t / .22, 1) + .28 * t), 0, Math.PI * 2); ctx.stroke();
    for (const p of e.particles) {
      const d = e.r * (.75 + t * .67) * p.distance;
      ctx.beginPath(); ctx.arc(e.x + Math.cos(p.angle) * d, e.y + Math.sin(p.angle) * d, p.size * (1 - t * .55), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${e.hue + 22}, 100%, 88%, ${alpha * .75})`; ctx.fill();
    }
    ctx.restore();
  }

  function separateBubbles() {
    // A couple of small corrections keep overlapping targets legible without abrupt motion.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i], b = bubbles[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const gap = a.r + b.r + 8;
        if (distance >= gap) continue;
        if (distance < .01) { dx = 1; dy = 0; distance = 1; }
        const correction = (gap - distance) * .5;
        const shiftX = dx / distance * correction, shiftY = dy / distance * correction;
        a.x -= shiftX; a.y -= shiftY;
        b.x += shiftX; b.y += shiftY;
        placeWithinBounds(a); placeWithinBounds(b);
      }
    }
  }

  function frame(timestamp) {
    const dt = Math.min((timestamp - (lastFrame || timestamp)) / 1000, .05);
    lastFrame = timestamp;
    drawBackground();
    if (started) {
      for (const b of bubbles) {
        b.age += dt;
        // Slowly steer each bubble through its own drifting current.
        const targetVx = Math.sin(b.age * .47 + b.phase) * 11 + Math.sin(b.age * .23 + b.phase * 2) * 4
          + (b.x < width * .12 ? 10 : b.x > width * .88 ? -10 : 0);
        const targetVy = -5 + Math.sin(b.age * .38 + b.phase * 1.7) * 6
          + (b.y < height * .16 ? 11 : b.y > height * .84 ? -11 : 0);
        const steer = Math.min(1, dt * .8);
        b.vx += (targetVx - b.vx) * steer;
        b.vy += (targetVy - b.vy) * steer;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const edge = bounds(b.r);
        if (b.x < edge.left) { b.x = edge.left; b.vx = Math.max(5, Math.abs(b.vx)); }
        if (b.x > edge.right) { b.x = edge.right; b.vx = Math.min(-5, -Math.abs(b.vx)); }
        if (b.y < edge.top) { b.y = edge.top; b.vy = Math.max(5, Math.abs(b.vy)); }
        if (b.y > edge.bottom) { b.y = edge.bottom; b.vy = Math.min(-5, -Math.abs(b.vy)); }
      }
      separateBubbles();
      for (const b of bubbles) drawBubble(b);
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]; e.age += dt;
        if (e.age >= (e.type === 'miss' ? .25 : .38)) effects.splice(i, 1);
        else drawEffect(e);
      }
    }
    requestAnimationFrame(frame);
  }

  function begin() {
    if (started) return;
    simpleEffects = simpleEffectsInput.checked;
    started = true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !quietSoundsInput.checked) {
      try { audio = new AudioContextClass(); audio.resume().catch(() => {}); } catch (_) { audio = null; }
      if (audio?.createDynamicsCompressor) {
        soundOutput = audio.createDynamicsCompressor();
        soundOutput.threshold.value = -22;
        soundOutput.knee.value = 12;
        soundOutput.ratio.value = 8;
        soundOutput.attack.value = .004;
        soundOutput.release.value = .18;
        soundOutput.connect(audio.destination);
      }
    }
    fillBubbles();
    welcome.classList.add('hidden');
    setTimeout(() => { welcome.hidden = true; }, 230);
  }

  startButton.addEventListener('pointerdown', begin, { passive: true });
  startButton.addEventListener('click', begin);
  for (const [input, key] of [[simpleEffectsInput, 'bubble-pop-simple-effects'], [quietSoundsInput, 'bubble-pop-quiet-sounds']]) {
    try { input.checked = window.localStorage.getItem(key) === '1'; } catch (_) {}
    input.addEventListener('change', () => {
      try { window.localStorage.setItem(key, input.checked ? '1' : '0'); } catch (_) {}
    });
  }
  canvas.addEventListener('pointerdown', event => {
    if (!started) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    tapAt(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointermove', event => {
    const previous = activePointers.get(event.pointerId);
    if (!started || !previous) return;
    event.preventDefault();
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / 14);
    for (let i = 1; i <= steps; i++) popAt(previous.x + dx * i / steps, previous.y + dy * i / steps);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => activePointers.delete(event.pointerId));
  }
  document.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('touchmove', event => event.preventDefault(), { passive: false });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  window.visualViewport?.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { lastFrame = 0; });
  resize();
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).then(registration => {
      const checkForUpdate = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
    }).catch(() => {}));
  }
  if (new URLSearchParams(location.search).has('test')) {
    window.__bubblePopTest = { snapshot: () => ({ started, width, height, safe, target: targetCount(),
      bubbles: bubbles.map(({ id, x, y, r, vx, vy }) => ({ id, x, y, r, vx, vy })), effects: effects.length,
      audioState: audio?.state || 'none', pending: spawnTimers.size,
      simpleEffects, popCount, effectTypes: effects.map(e => e.type) }), popAt, tapAt, addBubble };
  }
})();
