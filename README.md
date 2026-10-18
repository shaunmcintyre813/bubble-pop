# Bubble Pop

A small, offline-capable bubble popping game for toddlers. No ads, tracking, accounts, timers, or scores.

**Play:** https://shaunmcintyre813.github.io/bubble-pop/

## Run locally

The game has no build step, package install, or external runtime dependencies. Node.js 20 or newer is enough to run the local server and the path checks.

```sh
node dev-server.mjs
```

Open http://localhost:8000/bubble-pop/. The server also serves the game at `/`, and maps `/bubble-pop/` to the project root so relative assets, the manifest, and service-worker scope can be checked as they will be on GitHub Pages.

For a phone on the same Wi-Fi, start the server with `node dev-server.mjs --host 0.0.0.0` and open the phone URL printed by the server. This tests touch play; service workers and installable PWA behavior need a secure context, so use `localhost` or the HTTPS GitHub Pages site for offline and install checks. Keep the server bound to `127.0.0.1` for ordinary desktop work.

Run the project-path checks with:

```sh
node --test
```

For offline use, open the page online once and allow the service worker to finish caching before disconnecting.

## Source and hosting

`index.html`, `styles.css`, and `game.js` make the game. `sw.js`, `manifest.webmanifest`, and `icons/` support offline installation. GitHub Pages publishes the `main` branch from the repository root. The earlier Sites version is also available at https://bubble-pop-shaun.shaun-mcintyre813.chatgpt.site/.
