// Owner-only "View as" (Combo Locks). A read-only stand-in for the Supabase
// client: every SELECT is recorded and sent to /api/combo-view-as, which
// re-checks that the caller is the owner and pins the query to the viewed user.
// Writes never leave the browser (they resolve with a read-only error), and
// while viewing, every /api/combo-* call carries the x-view-as header so the
// server refuses writes too.

export const VIEW_AS_HEADER = "x-view-as";
export const READ_ONLY_ERROR = { message: "Read-only: viewing as another user.", code: "view_as_read_only" };
const WRITE_METHODS = ["insert", "update", "upsert", "delete"];
const FILTERS = ["eq", "neq", "is", "in", "not", "or", "gt", "gte", "lt", "lte"];

export function viewAsBanner(label) {
  return `Viewing as ${label || "another user"}, read-only. Nothing you click here changes their locks or settings.`;
}

/** True when a request URL should carry the view-as header. */
export function isComboApiUrl(url) {
  const u = String(url || "");
  return /^(https?:\/\/[^/]+)?\/api\/(combo-|stripe-checkout)/.test(u);
}

function readOnlyResult() {
  return Promise.resolve({ data: null, error: { ...READ_ONLY_ERROR }, count: null, status: 403 });
}

/** Build a read-only client. send(view_as, queries) -> Promise<results[]> (batched per tick). */
export function createViewAsClient({ realClient, targetId, send }) {
  let pending = [];
  let timer = null;
  const flush = () => {
    const batch = pending; pending = []; timer = null;
    send(targetId, batch.map((b) => b.spec)).then(
      (results) => batch.forEach((b, i) => b.resolve(results && results[i] ? results[i] : { data: null, error: { message: "No result" } })),
      (err) => batch.forEach((b) => b.resolve({ data: null, error: { message: String((err && err.message) || err) } })),
    );
  };
  const enqueue = (spec) => new Promise((resolve) => {
    pending.push({ spec, resolve });
    if (!timer) timer = setTimeout(flush, 0);
  });

  const builder = (table) => {
    const spec = { table, select: "*", selectOpts: null, filters: [], order: [], limit: null, range: null, single: null };
    let write = false;
    const b = {
      select(cols = "*", opts) { spec.select = cols; if (opts) spec.selectOpts = { count: opts.count, head: opts.head }; return b; },
      order(column, o) { spec.order.push({ column, ascending: !(o && o.ascending === false) }); return b; },
      limit(n) { spec.limit = n; return b; },
      // Paged reads (fetchAllRows: every archived lock + every fill) need .range();
      // without it History and Filled came back empty while viewing as someone.
      range(from, to) { spec.range = { from, to }; return b; },
      maybeSingle() { spec.single = "maybe"; return b; },
      single() { spec.single = "one"; return b; },
      then(onOk, onErr) { return (write ? readOnlyResult() : enqueue(spec)).then(onOk, onErr); },
      catch(onErr) { return b.then(undefined, onErr); },
    };
    for (const op of FILTERS) b[op] = (...args) => { spec.filters.push({ op, args }); return b; };
    for (const m of WRITE_METHODS) b[m] = () => { write = true; return b; };
    return b;
  };

  return {
    viewAsUserId: targetId,
    readOnly: true,
    from: (table) => builder(table),
    rpc: (name) => (name === "combo_my_fee_status" ? enqueue({ kind: "rpc", name }) : readOnlyResult()),
    auth: realClient && realClient.auth,
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    removeChannel: () => {},
  };
}

/** Default sender: POST /api/combo-view-as with the owner's own session token. */
export function viewAsSender(realClient, fetchImpl = (...a) => fetch(...a)) {
  return async (targetId, queries) => {
    const { data } = await realClient.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error("Sign in required");
    const r = await fetchImpl("/api/combo-view-as", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ view_as: targetId, queries }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || !body.ok) throw new Error((body && body.error) || `View as failed (${r.status})`);
    return body.results;
  };
}

/** While viewing: tag /api/combo-* calls with x-view-as and refuse non-GETs locally. Returns restore(). */
export function installViewAsFetch(targetId, win = typeof window !== "undefined" ? window : null) {
  if (!win || !win.fetch) return () => {};
  const orig = win.fetch;
  const wrapped = (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!isComboApiUrl(url)) return orig.call(win, input, init);
    const method = String((init && init.method) || "GET").toUpperCase();
    const headers = { ...((init && init.headers) || {}), [VIEW_AS_HEADER]: targetId };
    if (method !== "GET" && !/\/api\/combo-view-as/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, code: "view_as_read_only", error: READ_ONLY_ERROR.message }), { status: 403, headers: { "content-type": "application/json" } }));
    }
    return orig.call(win, input, { ...init, headers });
  };
  win.fetch = wrapped;
  return () => { if (win.fetch === wrapped) win.fetch = orig; };
}
