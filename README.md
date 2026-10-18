# Bubble Pop

A small, offline-capable bubble popping game for toddlers. No ads, tracking, accounts, timers, or scores.

Play the GitHub Pages version from this repository's Pages link after deployment.

## Run locally

Serve this folder over HTTP (for example, `python3 -m http.server 8000`) and open it in a browser. The game itself has no build step or external dependencies. The service worker and installable PWA require HTTPS or localhost. Open once online to cache the game for offline use.

## Source

`index.html`, `styles.css`, and `game.js` make the game. `sw.js`, `manifest.webmanifest`, and `icons/` support offline installation. The `main` branch can be published with GitHub Pages from the repository root. The public Sites version remains at https://bubble-pop-shaun.shaun-mcintyre813.chatgpt.site/ until the GitHub Pages version is verified.
