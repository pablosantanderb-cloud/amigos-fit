// Supabase Edge Function: health-sync
// Recibe desde un Atajo de iPhone las kcal del día leídas de Apple Salud y las guarda como "cierre del día".
// Autenticación: código personal (sync_tokens) — sin sesión, para que el Atajo pueda correr solo.
// Cuerpo JSON: { token, active_kcal, resting_kcal, total_kcal?, day?: "hoy" | "ayer" | "YYYY-MM-DD" }

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const rest = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

// Fecha en Chile (la del teléfono del usuario)
function chileDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Los Atajos a veces envían números como texto con coma o unidades ("1.234,5 kcal")
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  const norm = s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  return parseFloat(norm);
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Usa POST" }, 405);
  if (!SERVICE) return json({ error: "Servidor sin configurar" }, 500);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const token = String(b.token ?? "").trim();
  if (token.length < 20) return json({ error: "Falta tu código personal" }, 401);
  const tr = await rest(`sync_tokens?select=user_id&token=eq.${encodeURIComponent(token)}`);
  const rows = await tr.json();
  const userId = Array.isArray(rows) && rows[0]?.user_id;
  if (!userId) return json({ error: "Código no válido. Genera uno nuevo en Amigos Fit → Perfil." }, 401);

  const day = String(b.day ?? "hoy").toLowerCase();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : day === "ayer" ? chileDate(-1) : chileDate(0);
  if (date > chileDate(0)) return json({ error: "Fecha futura" }, 400);

  const active = Math.round(num(b.active_kcal)) || 0;
  const resting = Math.round(num(b.resting_kcal)) || 0;
  const total = Math.round(num(b.total_kcal)) || active + resting;
  if (!(total >= 500 && total <= 10000)) return json({ error: `Total fuera de rango (${total} kcal). Revisa que el Atajo envíe energía activa y en reposo.` }, 400);

  const up = await rest("daily_energy?on_conflict=user_id,log_date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, log_date: date, total_kcal: total, active_kcal: active || null, resting_kcal: resting || null, source: "salud" }),
  });
  if (!up.ok) { console.error("upsert", up.status, await up.text()); return json({ error: "No se pudo guardar" }, 500); }
  await rest(`sync_tokens?user_id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ last_used_at: new Date().toISOString() }) });

  return json({ ok: true, mensaje: `✅ Amigos Fit: ${date} guardado — total ${total} kcal (activa ${active}, reposo ${resting})` });
}

Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (e) { console.error(e); return json({ error: `Error interno: ${(e as Error).message}` }, 500); }
});
