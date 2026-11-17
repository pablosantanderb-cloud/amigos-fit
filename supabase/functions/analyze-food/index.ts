// Supabase Edge Function: analyze-food
// Recibe una foto (base64) + comentario opcional y devuelve la estimación nutricional
// usando Google Gemini (capa gratuita). La API key vive solo en el servidor (secreto GEMINI_API_KEY).
// Supabase verifica el JWT del usuario antes de ejecutar esta función (solo usuarios logueados).

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
- si no hay foto, estima solo a partir del comentario.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!GEMINI_API_KEY) return json({ error: "Falta configurar el secreto GEMINI_API_KEY en Supabase" }, 500);

  let body: { image?: string; mimeType?: string; comment?: string; meal?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const { image, mimeType = "image/jpeg", comment = "", meal = "" } = body;
  if (!image && !comment.trim()) return json({ error: "Envía una foto o un comentario" }, 400);
  if (image && image.length > 4_000_000) return json({ error: "Imagen demasiado grande" }, 413);

  const parts: unknown[] = [{ text: PROMPT }];
  if (meal) parts.push({ text: `Comida del día: ${meal}.` });
  if (comment.trim()) parts.push({ text: `Comentario del usuario: """${comment.slice(0, 1000)}"""` });
  if (image) parts.push({ inline_data: { mime_type: mimeType, data: image } });

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: SCHEMA },
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
