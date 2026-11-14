// Frontend dev server with a mock API (docs/CONTRACT.md section 8).
// Run from astro-health/:  node tools/dev-server.mjs   ->  http://127.0.0.1:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const MOCK = join(ROOT, 'mock');
const PORT = Number(process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function mockFile(method, path, params) {
  if (path === '/api/health') return { inline: { ok: true, model: 'mock' } };
  if (path === '/api/config') return { file: 'config.json' };
  if (path === '/api/environment') return { inline: { mission_id: 'iss', reading: { taken_at: new Date().toISOString(), co2_ppm: 820, temperature_c: 22.6, humidity_pct: 44, source: 'sim' }, note: 'Cabin context only. It does not change the health score.' } };
  if (path === '/api/astronauts') return { file: 'astronauts.json' };
  if (path === '/api/radiation') {
    const f = `radiation-${params.get('mission')}.json`;
    return { file: params.get('mission') && existsSync(join(MOCK, f)) ? f : 'radiation.json' };
  }
  if (path === '/api/solar-events') return { file: 'solar-events.json' };
  if (path === '/api/checkins' && method === 'POST') return { file: 'checkin-post.json', status: 201 };
  const m = path.match(/^\/api\/astronauts\/\d+\/(status|history|bone)$/);
  if (m) {
    if (m[1] === 'status' && params.get('mission')) {
      const f = `status-${params.get('mission')}.json`;
      if (existsSync(join(MOCK, f))) return { file: f };
    }
    return { file: `${m[1]}.json` };
  }
  return null;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

createServer(async (req, res) => {
  let url, path;
  try {
    url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    path = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, JSON.stringify({ error: 'Malformed request URL.' }));
  }

  if (path.startsWith('/api/')) {
    const hit = mockFile(req.method, path, url.searchParams);
    if (!hit) return send(res, 404, JSON.stringify({ error: `No mock for ${req.method} ${path}.` }));
    if (hit.inline) return send(res, 200, JSON.stringify(hit.inline));
    try {
      const body = await readFile(join(MOCK, hit.file));
      if (/^status(?:-|\.)/.test(hit.file)) {
        const status = JSON.parse(body.toString('utf8'));
        if (status.checkin) status.checkin.taken_at = new Date(Date.now() - 2 * 3600000).toISOString();
        status.freshness = { state: 'current', age_hours: 2 };
        return send(res, hit.status || 200, JSON.stringify(status));
      }
      return send(res, hit.status || 200, body);
    } catch {
      return send(res, 404, JSON.stringify({ error: `Mock file frontend/mock/${hit.file} is missing.` }));
    }
  }

  let rel = path === '/' ? '/index.html' : path;
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await readFile(file);
    send(res, 200, body, TYPES[extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Dev server with mock API: http://127.0.0.1:${PORT}`);
});
