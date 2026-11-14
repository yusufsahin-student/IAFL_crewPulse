// The only module that talks to the backend. Shapes are defined in docs/CONTRACT.md section 5.

export class ApiError extends Error {
  constructor(message, status, field) {
    super(message);
    this.status = status;
    this.field = field || null;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      ...options,
    });
  } catch {
    throw new ApiError('Cannot reach the health server. Check that it is running.', 0);
  }
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!res.ok) {
    const message = (body && body.error) || `The server answered ${res.status}.`;
    throw new ApiError(message, res.status, body && body.field);
  }
  return body;
}

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  health: () => request('/api/health'),
  config: (astronautId) => request(`/api/config${query({astronaut_id: astronautId})}`),
  environment: (astronautId, mission, days = 60) =>
    request(`/api/environment${query({ astronaut_id: astronautId, mission, days })}`),
  gravity: (astronautId, mission, days = 60) =>
    request(`/api/gravity${query({ astronaut_id: astronautId, mission, days })}`),
  astronauts: () => request('/api/astronauts'),
  status: (astronautId, mission) =>
    request(`/api/astronauts/${astronautId}/status${query({ mission })}`),
  history: (astronautId, days = 60) =>
    request(`/api/astronauts/${astronautId}/history${query({ days })}`),
  bone: (astronautId, daysAhead = 180) =>
    request(`/api/astronauts/${astronautId}/bone${query({ days_ahead: daysAhead })}`),
  radiation: (astronautId, mission) =>
    request(`/api/radiation${query({ astronaut_id: astronautId, mission })}`),
  solarEvents: (days = 30) => request(`/api/solar-events${query({ days })}`),
  submitCheckin: (payload) =>
    request('/api/checkins', { method: 'POST', body: JSON.stringify(payload) }),
};
