import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageStore, LOG_ROOT } from './store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const PORT = Number(process.env.PORT || 3000);

const store = new UsageStore();
store.start(1000);

const clients = new Set();
store.on('records', (fresh) => {
  const payload = `data: ${JSON.stringify(fresh)}\n\n`;
  for (const res of clients) res.write(payload);
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/history') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ logRoot: LOG_ROOT, records: store.records }));
    return;
  }

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    clients.add(res);
    // proxies and browsers drop a silent stream; a comment every 20s keeps it up
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`usage-viz -> http://localhost:${PORT}`);
  console.log(`watching   ${LOG_ROOT}`);
});
