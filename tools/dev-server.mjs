// Frontend dev server with a mock API (docs/CONTRACT.md section 8).
// Run from the repository root:  node tools/dev-server.mjs   ->  http://127.0.0.1:5173
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
  if (path === '/api/health') return { inline: { ok: true, model: 'mock', db: 'frontend/mock' } };
  if (path === '/api/config') return { file: 'config.json' };
  if (path === '/api/environment') {
    const days = Math.max(1, Math.min(3650, Number(params.get('days')) || 60));
    const readings = Array.from({ length: days }, (_, index) => {
      const offset = days - index - 1;
      const observed = new Date(Date.now() - offset * 86400000);
      const cycle = Math.sin(index * Math.PI * 2 / 14);
      return {
        taken_at: observed.toISOString(),
        co2_ppm: Math.round(820 + 45 * cycle),
        temperature_c: Number((22.6 + 0.5 * cycle).toFixed(1)),
        humidity_pct: Number((44 - 2.5 * cycle).toFixed(1)),
        source: 'sim',
      };
    });
    const reading = readings.at(-1);
    const freshness = { status: 'current', observed_at: reading.taken_at, age_h: 0, max_age_h: 24 };
    const metric = (id, label, unit) => ({ id, label, unit, samples: readings.map((row) => ({ observed_at: row.taken_at, value: row[id], source: row.source })) });
    return { inline: {
      mission_id: params.get('mission') || 'iss', reading, readings, window: { days }, freshness,
      layer: { schema_version: 1, id: 'environment', label: 'Cabin environment', freshness,
        metrics: [metric('co2_ppm', 'Carbon dioxide', 'ppm'), metric('temperature_c', 'Temperature', '°C'), metric('humidity_pct', 'Relative humidity', '%')] },
      note: 'Cabin context only. It does not change the health score.',
    } };
  }
  if (path === '/api/gravity') {
    const days = Math.max(1, Math.min(3650, Number(params.get('days')) || 60));
    const gravityG = params.get('mission') === 'moon' ? 0.166 : params.get('mission') === 'mars' ? 0.38 : 0;
    const readings = Array.from({ length: days }, (_, index) => ({
      observed_at: new Date(Date.now() - (days - index - 1) * 86400000).toISOString(),
      gravity_g: gravityG, source: 'mission_profile_sim',
    }));
    const samples = readings.map((row) => ({ observed_at: row.observed_at, value: row.gravity_g, source: row.source }));
    const deficit = readings.map((row) => ({ observed_at: row.observed_at, value: (1 - row.gravity_g) * 100, source: 'derived' }));
    const freshness = { status: 'current', observed_at: readings.at(-1).observed_at };
    return { inline: {
      mission_id: params.get('mission') || 'iss', reading: readings.at(-1), readings, window: { days },
      assessment: { current_g: gravityG, earth_load_pct: gravityG * 100, load_deficit_pct: (1 - gravityG) * 100,
        window_equivalent_microgravity_days: days * (1 - gravityG), transition_count: 0,
        interpretation: gravityG < 0.4 && gravityG > 0 ? 'Partial gravity below 0.4 g; long-term protection is uncertain' : 'Microgravity',
        evidence: gravityG > 0 && gravityG < 1 ? 'limited_human_evidence' : 'mission_profile',
        analysis_areas: gravityG < 0.67 ? ['bone_loading', 'muscle_loading', 'cardiovascular_conditioning'] : [] },
      layer: { schema_version: 1, id: 'gravity', label: 'Gravital tracking', freshness, metrics: [
        { id: 'gravity_g', label: 'Local gravity', unit: 'g', samples },
        { id: 'load_deficit_pct', label: 'Modeled load deficit', unit: '%', samples: deficit },
      ] },
      note: 'Decision-support model, not a clinical probability.',
    } };
  }
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
