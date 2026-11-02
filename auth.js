(() => {
  const config = window.CRYPTO_ASTRA_CONFIG;
  const storageKey = "crypto-astra-session-v1";
  const base = config.SUPABASE_URL.replace(/\/$/, "");
  const key = config.SUPABASE_PUBLISHABLE_KEY;
  let session = null;
  try { session = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { session = null; }

  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
  }
  function headers(token) {
    return { "apikey": key, "Authorization": "Bearer " + (token || key), "Content-Type": "application/json" };
  }
  async function authRequest(path, body, token) {
    const response = await fetch(base + "/auth/v1/" + path, {
      method: "POST", headers: headers(token), body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || "Ошибка авторизации");
    return data;
  }
  async function refreshSession() {
    if (!session?.refresh_token) return null;
    try {
      const data = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      saveSession({ ...data, expires_at: Math.floor(Date.now()/1000) + (data.expires_in || 3600) });
      return session;
    } catch {
      saveSession(null);
      return null;
    }
  }
  async function getSession() {
    if (!session?.access_token) return null;
    if (session.expires_at && session.expires_at < Math.floor(Date.now()/1000) + 60) return await refreshSession();
    return session;
  }
  async function request(path, options = {}) {
    const current = await getSession();
    const response = await fetch(base + path, {
      ...options,
      headers: { ...headers(current?.access_token), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.msg || data.hint || "Ошибка запроса к базе");
    return data;
  }
  async function signUp(email, password, displayName) {
    const data = await authRequest("signup", { email, password, data: { display_name: displayName } });
    if (data.access_token) saveSession({ ...data, expires_at: Math.floor(Date.now()/1000) + (data.expires_in || 3600) });
    return data;
  }
  async function signIn(email, password) {
    const data = await authRequest("token?grant_type=password", { email, password });
    saveSession({ ...data, expires_at: Math.floor(Date.now()/1000) + (data.expires_in || 3600) });
    return data;
  }
  async function signOut() {
    const current = await getSession();
    if (current?.access_token) {
      try { await authRequest("logout", {}, current.access_token); } catch {}
    }
    saveSession(null);
  }
  async function rows(table, query) {
    return request("/rest/v1/" + table + (query ? "?" + query : ""), { method: "GET" });
  }
  async function rpc(name, args) {
    return request("/rest/v1/rpc/" + name, { method: "POST", body: JSON.stringify(args) });
  }
  window.CryptoAstra = Object.freeze({
    auth: Object.freeze({ signUp, signIn, signOut, getSession }),
    db: Object.freeze({ rows, rpc })
  });
})();