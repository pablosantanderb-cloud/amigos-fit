// Supabase Edge Function: analyze-food
// Recibe una foto (base64) + comentario opcional y devuelve la estimación nutricional
// usando Google Gemini (capa gratuita). La API key vive solo en el servidor (secreto GEMINI_API_KEY).
// La función verifica en el código que el usuario tenga sesión iniciada ("Verify JWT" desactivado en el panel).

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

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
Extrae cada sesión de ejercicio visible: tipo de actividad en español (ej. "Caminata", "Carrera", "Fuerza", "Bicicleta"),
duración en minutos, calorías ACTIVAS (de movimiento/ejercicio; si solo aparecen calorías totales, úsalas en kcal_total),
pasos y distancia en km si aparecen, y la fecha de esa sesión en formato YYYY-MM-DD.
Reglas para la fecha: usa la fecha visible en la imagen; textos como "Hoy", "Ayer", "lun", "12 nov" interprétalos
respecto de la fecha de hoy indicada. Nunca devuelvas una fecha futura. Si no hay fecha visible, deja date vacío.
Si el pantallazo es un resumen diario sin sesiones (ej. anillos de actividad), devuelve UNA actividad "Actividad diaria"
con los minutos de ejercicio y las calorías activas del día.
Si muestra varios días, devuelve una entrada por día/sesión. Si no hay datos de actividad, devuelve activities vacío y explícalo en notes.
No inventes valores: si un dato no aparece, usa 0. Responde en español.`;

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
    notes: { type: "STRING" },
  },
  required: ["activities"],
};

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

Deno.serve(async (req) => {
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

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: isActivity ? ACTIVITY_SCHEMA : SCHEMA },
      }),
    },
  );

  if (!resp.ok) {
    const detail = await resp.text();
    console.error("Gemini error", resp.status, detail);
    const msg = resp.status === 429
      ? "Se alcanzó el límite gratuito de análisis por minuto/día. Intenta en un rato o ingresa los valores a mano."
      : "No se pudo analizar la foto en este momento.";
    return json({ error: msg }, 502);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  try {
    const result = JSON.parse(text);
    if (isActivity) {
      // Descarta fechas futuras o mal formadas
      for (const a of result.activities ?? []) {
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
});
