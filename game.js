(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const welcome = document.querySelector('#welcome');
  const parentPanel = document.querySelector('#parent-panel');
  const startButton = document.querySelector('#start');
  const resumeButton = document.querySelector('#resume');
  const simpleEffectsInput = document.querySelector('#simple-effects');
  const quietSoundsInput = document.querySelector('#quiet-sounds');
  const safeProbe = document.querySelector('#safe-probe');
  const palette = [188, 205, 267, 310, 35, 155, 285];
  const bubbles = [];
  const effects = [];
  let width = 0, height = 0, safe = { top: 0, right: 0, bottom: 0, left: 0 };
  let started = false, nextId = 0, lastFrame = 0, audio = null, popCount = 0;
  let simpleEffects = false;
  let puff = null, nextPuffIn = 0, nextPuffId = 0, lastDirection = -1;
  const activePointers = new Map();
  let soundOutput = null;
  let settingsOpen = false;
  const parentPresses = new Map();
  const pentatonic = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];
  const backdrop = document.createElement('canvas');

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const bounds = r => ({
    left: safe.left + r + 7, right: width - safe.right - r - 7,
    top: safe.top + r + 7, bottom: height - safe.bottom - r - 7
  });
  const targetCount = () => clamp(Math.floor(width * height / 44500), 5, 10);
  const bubbleRadius = () => {
    const scale = clamp(Math.min(width, height) / 390, .8, 1.3);
    const choice = Math.random();
    // Small soap bubbles are common; a few larger ones give each breath variety.
    return scale * (choice < .35 ? rand(22, 31) : choice < .86 ? rand(35, 47) : rand(53, 65));
  };
  const keepInReach = b => {
    const edge = bounds(b.r);
    b.y = clamp(b.y, Math.min(edge.top, height / 2), Math.max(edge.bottom, height / 2));
  };

  function resize() {
    const previousWidth = width, previousHeight = height;
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
    for (const b of bubbles) {
      // Preserve entry/exit progress when a phone rotates, including offscreen bubbles.
      if (previousWidth) b.x *= width / previousWidth;
      if (previousHeight) b.y *= height / previousHeight;
      keepInReach(b);
    }
    while (bubbles.length > targetCount()) bubbles.pop();
    if (puff && previousHeight) puff.y *= height / previousHeight;
  }

  function startPuff() {
    const room = targetCount() - bubbles.length;
    if (room < 1) return;
    const count = Math.min(room, Math.floor(rand(3, 6)));
    const radii = Array.from({ length: count }, bubbleRadius);
    const clusterSize = count >= 2 && Math.random() < .42 ? Math.min(count, Math.random() < .3 ? 3 : 2) : 1;
    const groups = [radii.splice(0, clusterSize), ...radii.map(r => [r])];
    lastDirection *= -1;
    puff = { id: ++nextPuffId, direction: lastDirection, y: rand(height * .35, height * .73),
      phase: rand(0, Math.PI * 2), lift: rand(-12, 5), groups, nextIn: 0 };
  }

  function releaseGroup(radii) {
    const maxR = Math.max(...radii);
    const pairGap = radii.length > 1 ? (radii[0] + radii[1]) * .89 : 0;
    for (let i = 0; i < radii.length && bubbles.length < targetCount(); i++) {
      const r = radii[i];
      const offsetX = i === 2 ? (radii[0] + r) * .78 : 0;
      const offsetY = i === 0 ? -pairGap / 2 : i === 1 ? pairGap / 2 : 0;
      const x = puff.direction === 1 ? -maxR - 5 - offsetX : width + maxR + 5 + offsetX;
      const b = { id: ++nextId, x, y: puff.y + offsetY + (radii.length === 1 ? rand(-16, 16) : 0), r,
        hue: palette[Math.floor(rand(0, palette.length))] + rand(-10, 10),
        direction: puff.direction, breeze: clamp(width * .25, 95, 230), lift: puff.lift,
        vx: puff.direction * (clamp(width / 18, 20, 70) + clamp(width * .25, 95, 230)), vy: puff.lift,
        phase: puff.phase + (radii.length > 1 ? i * .15 : rand(-.7, .7)), age: 0,
        cluster: radii.length > 1 ? puff.id : null };
      keepInReach(b);
      bubbles.push(b);
    }
  }

  function updatePuffs(dt) {
    if (puff) {
      puff.nextIn -= dt;
      if (puff.nextIn <= 0) {
        releaseGroup(puff.groups.shift());
        if (puff.groups.length && bubbles.length < targetCount()) puff.nextIn = rand(.24, .4);
        else { puff = null; nextPuffIn = rand(3.2, 5.2); }
      }
      return;
    }
    nextPuffIn -= dt;
    if (bubbles.length < 2) nextPuffIn = Math.min(nextPuffIn, .22);
    if (nextPuffIn <= 0 && bubbles.length < targetCount()) {
      startPuff();
      // The first bubble starts moving immediately, even after a quick screen clear.
      updatePuffs(0);
    }
  }

  function sound() {
    if (!audio || quietSoundsInput.checked) return;
    try {
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const now = audio.currentTime;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      // Every pop uses a note from the same major pentatonic scale.
      const pitch = pentatonic[popCount % pentatonic.length];
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(pitch, now);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.055, now + .004);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .13);
      oscillator.connect(gain).connect(soundOutput || audio.destination);
      oscillator.start(now);
      oscillator.stop(now + .14);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    } catch (_) { /* Gameplay works without audio if the device blocks it. */ }
  }

  function popAt(x, y) {
    if (!started || settingsOpen) return false;
    let nearest = -1, best = Infinity;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      if (b.x + b.r <= 0 || b.x - b.r >= width) continue;
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
    popCount++;
    sound();
    if (bubbles.length < 2) nextPuffIn = Math.min(nextPuffIn, .22);
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

  function separateBubbles(dt) {
    // New clusters briefly share a rim, then loosen as the breath disperses.
    // Time-based corrections avoid snapping a new arrival across the screen.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < bubbles.length; i++) for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i], b = bubbles[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const together = a.cluster !== null && a.cluster === b.cluster;
        const loosen = together ? clamp((Math.min(a.age, b.age) - 1.1) / 2.3, 0, 1) : 1;
        const gap = (a.r + b.r) * (.88 + .12 * loosen) + 8 * loosen;
        if (distance >= gap) continue;
        if (distance < .01) { dx = 1; dy = 0; distance = 1; }
        const correction = Math.min((gap - distance) * (1 - Math.exp(-dt * 3)), dt * 24);
        const shiftX = dx / distance * correction, shiftY = dy / distance * correction;
        a.x -= shiftX; a.y -= shiftY;
        b.x += shiftX; b.y += shiftY;
        keepInReach(a); keepInReach(b);
      }
    }
  }

  function frame(timestamp) {
    const dt = Math.min((timestamp - (lastFrame || timestamp)) / 1000, .05);
    lastFrame = timestamp;
    drawBackground();
    if (started && !settingsOpen && !document.hidden) {
      updatePuffs(dt);
      for (const b of bubbles) {
        b.age += dt;
        // A shared initial breath eases into a slow current across the play area.
        const breath = Math.exp(-b.age / 2.1);
        const targetVx = b.direction * (clamp(width / 18, 20, 70) + b.breeze * breath)
          + Math.sin(b.age * .47 + b.phase) * 5;
        const targetVy = b.lift * breath - 5 + Math.sin(b.age * .38 + b.phase * 1.7) * 6
          + (b.y < height * .16 ? 11 : b.y > height * .84 ? -11 : 0);
        const steer = 1 - Math.exp(-dt * 2.5);
        b.vx += (targetVx - b.vx) * steer;
        b.vy += (targetVy - b.vy) * steer;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const edge = bounds(b.r);
        if (b.y < edge.top) { b.y = edge.top; b.vy = Math.max(5, Math.abs(b.vy)); }
        if (b.y > edge.bottom) { b.y = edge.bottom; b.vy = Math.min(-5, -Math.abs(b.vy)); }
      }
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        if (b.direction === 1 ? b.x - b.r > width + 8 : b.x + b.r < -8) bubbles.splice(i, 1);
      }
      separateBubbles(dt);
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
    ensureAudio();
    startPuff();
    welcome.classList.add('hidden');
    setTimeout(() => { welcome.hidden = true; }, 230);
  }

  function ensureAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || quietSoundsInput.checked || audio) return;
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

  function openParentSettings() {
    if (!started || settingsOpen) return;
    settingsOpen = true;
    activePointers.clear();
    for (const press of parentPresses.values()) clearTimeout(press.timer);
    parentPresses.clear();
    parentPanel.hidden = false;
  }
  function closeParentSettings() {
    settingsOpen = false;
    parentPanel.hidden = true;
    lastFrame = 0;
  }
  resumeButton.addEventListener('click', closeParentSettings);

  startButton.addEventListener('pointerdown', begin, { passive: true });
  startButton.addEventListener('click', begin);
  for (const [input, key] of [[simpleEffectsInput, 'bubble-pop-simple-effects'], [quietSoundsInput, 'bubble-pop-quiet-sounds']]) {
    try { input.checked = window.localStorage.getItem(key) === '1'; } catch (_) {}
    input.addEventListener('change', () => {
      try { window.localStorage.setItem(key, input.checked ? '1' : '0'); } catch (_) {}
      if (input === simpleEffectsInput) simpleEffects = input.checked;
      if (input === quietSoundsInput && !input.checked && started) ensureAudio();
    });
  }
  canvas.addEventListener('pointerdown', event => {
    if (!started || settingsOpen) return;
    event.preventDefault();
    if (event.clientX < 56 && event.clientY < 56 || event.clientX > width - 56 && event.clientY < 56) {
      const timer = setTimeout(() => { parentPresses.delete(event.pointerId); openParentSettings(); }, 1000);
      parentPresses.set(event.pointerId, { x: event.clientX, y: event.clientY, timer });
      try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      return;
    }
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
    tapAt(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointermove', event => {
    const parentPress = parentPresses.get(event.pointerId);
    if (parentPress) {
      if (Math.hypot(event.clientX - parentPress.x, event.clientY - parentPress.y) > 18) {
        clearTimeout(parentPress.timer);
        parentPresses.delete(event.pointerId);
        if (!settingsOpen) {
          tapAt(parentPress.x, parentPress.y);
          const dx = event.clientX - parentPress.x, dy = event.clientY - parentPress.y;
          const steps = Math.ceil(Math.hypot(dx, dy) / 14);
          for (let i = 1; i <= steps; i++) popAt(parentPress.x + dx * i / steps, parentPress.y + dy * i / steps);
          activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }
      } else return;
    }
    const previous = activePointers.get(event.pointerId);
    if (!started || settingsOpen || !previous) return;
    event.preventDefault();
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    const steps = Math.ceil(Math.hypot(dx, dy) / 14);
    for (let i = 1; i <= steps; i++) popAt(previous.x + dx * i / steps, previous.y + dy * i / steps);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
      const parentPress = parentPresses.get(event.pointerId);
      if (parentPress) { clearTimeout(parentPress.timer); parentPresses.delete(event.pointerId); }
      activePointers.delete(event.pointerId);
    });
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
      bubbles: bubbles.map(({ id, x, y, r, vx, vy, age, direction, cluster }) => ({ id, x, y, r, vx, vy, age, direction, cluster })), effects: effects.length,
      audioState: audio?.state || 'none', settingsOpen, pending: puff?.groups.reduce((n, group) => n + group.length, 0) || 0,
      puffId: nextPuffId, nextPuffIn, simpleEffects, popCount, effectTypes: effects.map(e => e.type) }), popAt, tapAt };
  }
})();
