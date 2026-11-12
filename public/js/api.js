/**
 * The only way pages talk to the server: JSON over the REST API (SI-01).
 * Every call carries the "Viewing as" user id in the X-User-Id header
 * (development stand-in for login — see server/middleware/current-user.js).
 */
const BASE = '/api/v1';
const USER_KEY = 'am.userId';

export function getViewingAs() {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null; // storage blocked (private mode): nobody selected
  }
}

export function setViewingAs(userId) {
  try {
    if (userId) localStorage.setItem(USER_KEY, String(userId));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(status, body) {
    const error = body?.error || {};
    super(error.message || 'Something went wrong. Please try again.');
    this.status = status;
    this.code = error.code || 'UNKNOWN';
    this.fields = error.fields || {};
  }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  const userId = getViewingAs();
  if (userId) headers['X-User-Id'] = userId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'You appear to be offline. Check your connection and try again.' } });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body),
};
