# Bubble Pop

A small, offline-capable bubble popping game for toddlers. No ads, tracking, accounts, timers, or scores.

**Play:** https://shaunmcintyre813.github.io/bubble-pop/

## Run locally

Serve this folder over HTTP (for example, `python3 -m http.server 8000`) and open it in a browser. The game itself has no build step or external dependencies. The service worker and installable PWA require HTTPS or localhost. Open once online to cache the game for offline use.

## Source and hosting

`index.html`, `styles.css`, and `game.js` make the game. `sw.js`, `manifest.webmanifest`, and `icons/` support offline installation. GitHub Pages publishes the `main` branch from the repository root. The earlier Sites version is also available at https://bubble-pop-shaun.shaun-mcintyre813.chatgpt.site/.
