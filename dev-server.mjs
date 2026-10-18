import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PAGES_PREFIX = '/bubble-pop';
const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

export function resolveRequestPath(pathname, rootDirectory = ROOT) {
  const root = resolve(rootDirectory);
  let requestPath = pathname;
  if (requestPath === PAGES_PREFIX || requestPath === `${PAGES_PREFIX}/`) requestPath = '/';
  else if (requestPath.startsWith(`${PAGES_PREFIX}/`)) requestPath = requestPath.slice(PAGES_PREFIX.length);
  if (requestPath === '/') requestPath = '/index.html';

  const filePath = resolve(root, `.${requestPath}`);
  if (filePath === root || !filePath.startsWith(`${root}${sep}`)) return null;
  if (relative(root, filePath).split(sep).includes('.git')) return null;
  return filePath;
}

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}

function startServer() {
  const host = readOption('--host', '127.0.0.1');
  const port = Number(readOption('--port', '8000'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Port must be an integer from 0 to 65535.');
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }

    let requestUrl;
    try {
      requestUrl = new URL(request.url, 'http://localhost');
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    if (requestUrl.pathname === PAGES_PREFIX) {
      response.writeHead(308, { Location: `${PAGES_PREFIX}/${requestUrl.search}` }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(requestUrl.pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    const filePath = resolveRequestPath(pathname);
    if (!filePath) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const content = await readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': content.length,
        'Content-Type': CONTENT_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Bubble Pop: http://localhost:${actualPort}${PAGES_PREFIX}/`);
    if (host === '0.0.0.0') {
      for (const entries of Object.values(networkInterfaces())) {
        for (const entry of entries || []) {
          if (!entry.internal && (entry.family === 'IPv4' || entry.family === 4)) {
            console.log(`Phone on the same Wi-Fi: http://${entry.address}:${actualPort}${PAGES_PREFIX}/`);
          }
        }
      }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
