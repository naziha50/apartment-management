/**
 * The only way pages talk to the server: JSON over the REST API (SI-01).
 * The browser sends the login session cookie with every call by itself
 * (FR-01); no page ever sees or handles the cookie.
 */
const BASE = '/api/v1';

class ApiError extends Error {
  constructor(status, body) {
    const error = body?.error || {};
    super(error.message || 'Something went wrong. Please try again.');
    this.status = status;
    this.code = error.code || 'UNKNOWN';
    this.fields = error.fields || {};
  }
}

/** The address of the login page, which comes back to the current page afterwards. */
export function loginUrl() {
  return '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
}

/**
 * NFR-03: when the session has ended (logged out in another tab, or idle too long),
 * any call answers 401. Then go to the login page, except on the login page itself.
 */
function goToLoginIfLoggedOut(res) {
  if (res.status === 401 && location.pathname !== '/login.html') location.href = loginUrl();
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  const isForm = body instanceof FormData; // the browser sets the multipart Content-Type itself
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body === undefined || isForm ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'You appear to be offline. Check your connection and try again.' } });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    goToLoginIfLoggedOut(res);
    throw new ApiError(res.status, data);
  }
  return data;
}

/** Downloads a file (a request photo, a CSV export) as a File named as the server names it. */
async function blob(url) {
  const res = await fetch(url);
  if (!res.ok) {
    goToLoginIfLoggedOut(res);
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'download';
  return new File([await res.blob()], name, { type: res.headers.get('Content-Type') || '' });
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body),
  blob,
  delete: (path) => request('DELETE', path),
};
