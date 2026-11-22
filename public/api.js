// Shared authenticated JSON fetch helper.
export function makeApi(getToken) {
  return async function api(method, url, body) {
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await getToken() },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { throw new Error('Network error. Check your connection and try again.'); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Unexpected server response (' + r.status + ')'); }
    if (!r.ok || !j.ok) throw new Error(j?.error?.message || 'Failed (' + r.status + ')');
    return j;
  };
}
