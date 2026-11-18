// Supabase Edge Function: analyze-food
// Recibe una foto (base64) + comentario opcional y devuelve la estimación nutricional
// usando Google Gemini (capa gratuita). La API key vive solo en el servidor (secreto GEMINI_API_KEY).
// La función verifica en el código que el usuario tenga sesión iniciada ("Verify JWT" desactivado en el panel).

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PROMPT = `Eres un nutricionista experto en cocina chilena y latinoamericana.
Analiza la comida y estima, para la porción que se va a consumir:
- cada alimento identificable, su cantidad aproximada (en gramos o ml) y sus calorías, proteínas, carbohidratos y grasas.
- usa valores de referencia de tablas nutricionales (USDA / tabla de composición de alimentos de Chile).
- si el usuario escribió un comentario, TIENE PRIORIDAD sobre lo que ves (cantidades, ingredientes ocultos, marcas, preparación, si comió solo una parte, etc.).
- si no hay foto, estima solo a partir del texto (ej. "Huevo duro"); si no se indica cantidad, asume una porción estándar (1 unidad, 1 plato o 1 taza) e indícalo en notes.
- estima porciones con referencias visuales (plato ~26 cm, cubiertos, manos, envases).
- incluye aceites, aderezos, salsas y bebidas visibles o mencionadas.
- si la imagen no contiene comida, devuelve items vacío y explícalo en notes.
Responde en español. Los totales deben ser la suma de los items.`;

const num = { type: "NUMBER" };
const SCHEMA = {
  type: "OBJECT",
  properties: {
    description: { type: "STRING", description: "Nombre corto del plato, ej. 'Porotos con riendas'" },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          quantity: { type: "STRING", description: "ej. '1 taza (200 g)'" },
          grams: num, kcal: num, protein_g: num, carbs_g: num, fat_g: num,
        },
        required: ["name", "quantity", "grams", "kcal", "protein_g", "carbs_g", "fat_g"],
      },
    },
    total: {
      type: "OBJECT",
      properties: { kcal: num, protein_g: num, carbs_g: num, fat_g: num },
      required: ["kcal", "protein_g", "carbs_g", "fat_g"],
    },
    confidence: { type: "STRING", enum: ["alta", "media", "baja"] },
    notes: { type: "STRING", description: "Supuestos o advertencias breves" },
  },
  required: ["description", "items", "total", "confidence"],
};

// ---- Modo "activity": pantallazo de la app del reloj / smart band
const ACTIVITY_PROMPT = `Eres un asistente que lee pantallazos de apps de relojes y bandas deportivas
(Apple Fitness/Salud, Garmin Connect, Huawei Health, Zepp/Amazfit, Mi Fitness, Samsung Health, Fitbit, Polar, Strava, etc.).
Devuelve DOS cosas por separado:

1) "activities": SOLO entrenamientos o sesiones de ejercicio registradas (ej. "Caminata", "Carrera", "Fuerza",
   "Bicicleta", "Fútbol"), en español, con duración en minutos, calorías ACTIVAS de esa sesión (si solo aparecen
   totales de la sesión, úsalas en kcal_total), pasos y distancia en km si aparecen.
   NO incluyas aquí el resumen del día (anillos, "Moverse", calorías activas del día, pasos del día):
   eso va en day_totals, porque el movimiento cotidiano ya está considerado en el gasto base de la persona.

2) "day_totals": gasto energético del DÍA completo si aparece: total_kcal (energía total = en reposo + activa),
   active_kcal (energía activa del día, ej. anillo "Moverse" de Apple) y resting_kcal (energía en reposo / basal).
   Si solo ves activa y en reposo, total_kcal es su suma. Si solo ves la activa del día, deja total_kcal y resting_kcal en 0.

Fechas en formato YYYY-MM-DD: usa la fecha visible; "Hoy", "Ayer", "lun", "12 nov" interprétalos respecto de la fecha
de hoy indicada. Nunca devuelvas una fecha futura. Si no hay fecha visible, deja date vacío.
Si muestra varios días, devuelve una entrada por día/sesión. No inventes valores: si un dato no aparece, usa 0.
Si no hay datos de actividad, devuelve listas vacías y explícalo en notes. Responde en español.`;

const ACTIVITY_SCHEMA = {
  type: "OBJECT",
  properties: {
    activities: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" }, activity: { type: "STRING" }, minutes: num,
          kcal_active: num, kcal_total: num, steps: num, distance_km: num,
        },
        required: ["date", "activity", "minutes", "kcal_active", "kcal_total", "steps", "distance_km"],
      },
    },
    day_totals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { date: { type: "STRING" }, total_kcal: num, active_kcal: num, resting_kcal: num },
        required: ["date", "total_kcal", "active_kcal", "resting_kcal"],
      },
    },
    notes: { type: "STRING" },
  },
  required: ["activities", "day_totals"],
};

// Lista de modelos "flash" disponibles para esta clave, ordenados del más nuevo al más antiguo (cache 6 h).
let modelCache: { at: number; list: string[] } | null = null;
async function flashModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < 6 * 3600_000) return modelCache.list;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": GEMINI_API_KEY } });
    if (!r.ok) throw new Error(String(r.status));
    const { models = [] } = await r.json();
    const ver = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const list = (models as { name: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n) || /^gemini-\d+(\.\d+)?-flash-lite$/.test(n))
      // Primero los "lite" (mucho más rápidos), del más nuevo al más antiguo; luego los flash normales
      .sort((a, b) => Number(b.includes("lite")) - Number(a.includes("lite")) || ver(b) - ver(a));
    modelCache = { at: Date.now(), list };
    console.log("Modelos flash disponibles:", list.join(", "));
    return list;
  } catch (e) {
    console.error("No se pudo listar modelos", e);
    return ["gemini-3.8-flash"];
  }
}

// Verifica que quien llama sea un usuario con sesión iniciada (no basta la clave pública).
async function getUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ?? null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!(await getUserId(req))) return json({ error: "Debes iniciar sesión" }, 401);
  if (!GEMINI_API_KEY) return json({ error: "Falta configurar el secreto GEMINI_API_KEY en Supabase" }, 500);

  let body: { image?: string; mimeType?: string; comment?: string; meal?: string; mode?: string; today?: string; viewing?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const { image, mimeType = "image/jpeg", comment = "", meal = "", mode = "food", today = "", viewing = "" } = body;
  const isActivity = mode === "activity";
  if (isActivity ? !image : !image && !comment.trim()) return json({ error: isActivity ? "Envía un pantallazo" : "Envía una foto o un comentario" }, 400);
  if (image && image.length > 4_000_000) return json({ error: "Imagen demasiado grande" }, 413);

  const parts: unknown[] = [];
  if (isActivity) {
    parts.push({ text: ACTIVITY_PROMPT });
    if (/^\d{4}-\d{2}-\d{2}$/.test(today)) parts.push({ text: `Fecha de hoy: ${today}.` });
    if (/^\d{4}-\d{2}-\d{2}$/.test(viewing)) parts.push({ text: `El usuario está registrando el día ${viewing} (úsalo solo si no hay fecha visible).` });
  } else {
    parts.push({ text: PROMPT });
    if (meal) parts.push({ text: `Comida del día: ${meal}.` });
    if (comment.trim()) parts.push({ text: `Comentario del usuario: """${comment.slice(0, 1000)}"""` });
  }
  if (image) parts.push({ inline_data: { mime_type: mimeType, data: image } });

  // Prueba el modelo configurado y luego los "flash" que Google tenga disponibles (del más nuevo al más antiguo),
  // así la app sigue funcionando cuando Google retira modelos.
  const models = [...new Set([...(Deno.env.get("GEMINI_MODEL") ? [GEMINI_MODEL] : []), ...(await flashModels()), "gemini-flash-latest"])].slice(0, 5);
  const baseConfig = { temperature: 0.2, responseMimeType: "application/json", responseSchema: isActivity ? ACTIVITY_SCHEMA : SCHEMA };
  const deadline = Date.now() + 55_000; // responder antes de que el servidor corte la conexión
  let resp: Response | null = null;
  let lastErr = { status: 0, message: "" };
  outer: for (const model of models) {
    // Los modelos 3.x "piensan" antes de responder; pedimos razonamiento bajo para que sea rápido.
    const configs = /^gemini-[3-9]/.test(model) ? [{ ...baseConfig, thinkingConfig: { thinkingLevel: "minimal" } }, baseConfig] : [baseConfig];
    for (const generationConfig of configs) {
      const left = deadline - Date.now();
      if (left < 5_000) { lastErr = { status: 504, message: "la IA tardó demasiado" }; break outer; }
      try {
        resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
          signal: AbortSignal.timeout(Math.min(22_000, left)),
        });
      } catch (e) {
        lastErr = { status: 504, message: `sin respuesta de ${model} (${(e as Error).name})` };
        console.error("Gemini timeout/red", model, e);
        resp = null;
        continue outer;
      }
      if (resp.ok) break outer;
      const detail = await resp.text();
      let message = detail.slice(0, 300);
      try { message = JSON.parse(detail)?.error?.message ?? message; } catch { /* texto plano */ }
      lastErr = { status: resp.status, message };
      console.error("Gemini error", model, resp.status, message);
      resp = null;
      // Si el problema fue el parámetro de razonamiento, reintenta el mismo modelo sin él
      if (lastErr.status === 400 && /thinking/i.test(message)) continue;
      // Otro modelo solo si este no existe, no está disponible o está saturado
      if (![404, 429, 500, 503].includes(lastErr.status)) break outer;
      continue outer;
    }
  }

  if (!resp || !resp.ok) {
    const msg = lastErr.status === 429
      ? "Se alcanzó el límite gratuito de análisis por minuto/día. Intenta en un rato o ingresa los valores a mano."
      : lastErr.status === 400 && /API key/i.test(lastErr.message)
      ? "La clave de Gemini no es válida. Revisa el secreto GEMINI_API_KEY."
      : lastErr.status === 403
      ? "Gemini rechazó la clave (403): puede que la API no esté habilitada en ese proyecto de Google."
      : `No se pudo analizar (Gemini ${lastErr.status}): ${lastErr.message}`;
    return json({ error: msg }, 502);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  try {
    const result = JSON.parse(text);
    if (isActivity) {
      // Descarta fechas futuras o mal formadas
      for (const a of [...(result.activities ?? []), ...(result.day_totals ?? [])]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date ?? "") || (today && a.date > today)) a.date = "";
      }
      return json(result);
    }
    // Recalcula totales desde los items para que siempre cuadren
    const items = Array.isArray(result.items) ? result.items : [];
    const sum = (k: string) => Math.round(items.reduce((a: number, it: Record<string, number>) => a + (Number(it[k]) || 0), 0) * 10) / 10;
    if (items.length) result.total = { kcal: Math.round(sum("kcal")), protein_g: sum("protein_g"), carbs_g: sum("carbs_g"), fat_g: sum("fat_g") };
    return json(result);
  } catch {
    console.error("Respuesta no-JSON de Gemini", text);
    return json({ error: "La IA devolvió una respuesta inválida, intenta de nuevo." }, 502);
  }
}

// Cualquier error inesperado vuelve como JSON con CORS (si no, Safari solo dice "Failed to send a request").
Deno.serve(async (req) => {
  const t0 = Date.now();
  try {
    return await handle(req);
  } catch (e) {
    console.error("Error inesperado", e);
    return json({ error: `Error interno al analizar (${Math.round((Date.now() - t0) / 1000)} s): ${(e as Error).message}` }, 500);
  }
});
