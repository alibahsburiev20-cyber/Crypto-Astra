(() => {
  const config = window.CRYPTO_ASTRA_CONFIG;
  const storageKey = "crypto-astra-session-v1";
  const base = config.SUPABASE_URL.replace(/\/$/, "");
  const key = config.SUPABASE_PUBLISHABLE_KEY;
  let session = null;
  try { session = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { session = null; }

  // Server messages are English; show Russian to the player.
  const messages = [
    [/Not enough ASTRA Coins/i, "Недостаточно ASTRA Coins."],
    [/Not enough fuel/i, "Недостаточно топлива. Оно восстанавливается со временем."],
    [/Rocket already owned/i, "Этот корабль уже есть в ангаре."],
    [/already on an expedition|expeditions_one_active_per_rocket/i, "Этот корабль уже в полёте."],
    [/not finished yet/i, "Экспедиция ещё не завершена."],
    [/Expedition not found/i, "Экспедиция не найдена."],
    [/Expedition is not active/i, "Экспедиция уже неактивна."],
    [/Rocket not owned/i, "Этого корабля нет в ангаре."],
    [/Rocket not found/i, "Корабль не найден."],
    [/Invalid idempotency key/i, "Не удалось выполнить действие. Повтори попытку."],
    [/Authentication required|JWT expired|invalid JWT/i, "Сессия недействительна. Войди снова."],
    [/Invalid login credentials/i, "Неверный email или пароль."],
    [/Email not confirmed/i, "Email не подтверждён. Проверь почту."],
    [/already registered|already been registered/i, "Пользователь с таким email уже зарегистрирован."],
    [/rate limit|too many requests/i, "Слишком много попыток. Подожди немного."],
    [/Password should be at least/i, "Пароль слишком короткий."],
    [/Failed to fetch|NetworkError|Load failed/i, "Нет соединения с сервером. Проверь интернет."]
  ];
  function translate(text) {
    for (const [pattern, russian] of messages) if (pattern.test(text)) return russian;
    return text;
  }
  function fail(raw, status, fallback) {
    return Object.assign(new Error(translate(raw || fallback)), { status });
  }
  async function send(url, init) {
    try { return await fetch(url, init); }
    catch { throw fail("Failed to fetch", 0); }
  }

  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
  }
  function headers(token) {
    return { "apikey": key, "Authorization": "Bearer " + (token || key), "Content-Type": "application/json" };
  }
  async function authRequest(path, body, token) {
    const response = await send(base + "/auth/v1/" + path, {
      method: "POST", headers: headers(token), body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw fail(data.msg || data.message || data.error_description, response.status, "Ошибка авторизации");
    return data;
  }
  async function refreshSession() {
    if (!session?.refresh_token) return null;
    try {
      const data = await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
      saveSession({ ...data, expires_at: Math.floor(Date.now()/1000) + (data.expires_in || 3600) });
      return session;
    } catch (error) {
      // Drop the session only when the server rejected the token, not on a network failure.
      if ([400, 401, 403].includes(error.status)) saveSession(null);
      return null;
    }
  }
  async function getSession() {
    if (!session?.access_token) return null;
    if (session.expires_at && session.expires_at < Math.floor(Date.now()/1000) + 60) return await refreshSession();
    return session;
  }
  async function request(path, options = {}, canRetry = true) {
    const current = await getSession();
    const response = await send(base + path, {
      ...options,
      headers: { ...headers(current?.access_token), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && current && canRetry) {
      const fresh = await refreshSession();
      if (fresh) return request(path, options, false);
    }
    if (!response.ok) throw fail(data.message || data.msg || data.hint, response.status, "Ошибка запроса к базе");
    return data;
  }
  async function signUp(email, password, displayName) {
    const data = await authRequest("signup?redirect_to=" + encodeURIComponent("https://crypto-astra.pages.dev"), { email, password, data: { display_name: displayName } });
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
