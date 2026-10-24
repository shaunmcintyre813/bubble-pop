# Bubble Pop

A small, offline-capable bubble popping game for toddlers. No ads, tracking, accounts, timers, or scores.

**Play:** https://shaunmcintyre813.github.io/bubble-pop/

Bubbles arrive in gentle puffs from alternating sides, with small, medium, and occasional large bubbles. Some puffs include a loose cluster that slowly separates. Each bubble eases into a slow float, spreads away from crowded groups, and stays available until popped. When the play area has room for more, another puff arrives. Caregiver settings pause both movement and the blowing rhythm.

## Run locally

The game has no build step, package install, or external runtime dependencies. Node.js 20 or newer is enough to run the local server and the path checks.

```sh
node dev-server.mjs
```

Open http://localhost:8000/bubble-pop/. The server also serves the game at `/`, and maps `/bubble-pop/` to the project root so relative assets, the manifest, and service-worker scope can be checked as they will be on GitHub Pages.

For a phone on the same Wi-Fi, start the server with `node dev-server.mjs --host 0.0.0.0` and open the phone URL printed by the server. This tests touch play; service workers and installable PWA behavior need a secure context, so use `localhost` or the HTTPS GitHub Pages site for offline and install checks. Keep the server bound to `127.0.0.1` for ordinary desktop work.

For focused play on a phone, caregivers can use the built-in app-pinning feature: **Guided Access** on iPhone/iPad (Settings → Accessibility → Guided Access) or **App pinning** on Android (Settings → Security/Privacy → App pinning; wording varies by device). These are device controls and are separate from Bubble Pop's caregiver settings, which open by holding either top corner of the play area for one second.

Run the project-path checks with:

```sh
node --test
```

For a new offline install, keep the page online until the welcome button changes back to **Tap to Play**. It stays disabled while the service worker caches the complete release. If offline setup fails, the welcome text asks you to reconnect and reload; online play remains available.

## Source and hosting

`index.html`, `styles.css`, and `game.js` make the game. `sw.js`, `manifest.webmanifest`, and `icons/` support offline installation. GitHub Pages publishes the `main` branch from the repository root. The earlier Sites version is also available at https://bubble-pop-shaun.shaun-mcintyre813.chatgpt.site/.

