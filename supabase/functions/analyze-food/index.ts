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
- el nombre de cada item debe ser corto (1 a 5 palabras, ej. 'Arroz', 'Pechuga de pollo', 'Pan integral con proteína'); la cantidad va solo en quantity.
Responde en español. Los totales deben ser la suma de los items.
MARCA: si en la foto (etiqueta, envase) o en el comentario aparece la marca de un producto, ponla en brand y también en name.
NOMBRES: en name incluye SIEMPRE los rasgos que distinguen el producto si el usuario o la etiqueta los indican (marca, 'con proteína', 'light', 'sin azúcar', 'integral', etc.). Ej: 'Pan integral con proteína', 'Yogur protein Soprole', no solo 'Pan' o 'Yogur'.`;

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
          name: { type: "STRING", description: "Nombre CORTO del alimento, 1 a 3 palabras, sin cantidades ni detalles. Ej: 'Marraqueta', 'Palta', 'Huevo duro', 'Aceite de oliva'" },
          quantity: { type: "STRING", description: "ej. '1 taza (200 g)'" },
          grams: num, kcal: num, protein_g: num, carbs_g: num, fat_g: num,
          from_history: { type: "BOOLEAN", description: "true si los valores salieron de un alimento que el usuario ya registró antes" },
          history_name: { type: "STRING", description: "si from_history: el nombre EXACTO del alimento de la lista de ya registrados" },
          brand: { type: "STRING", description: "MARCA del producto si se ve en la etiqueta/envase o el usuario la dice (ej. 'Ideal', 'Soprole'); vacío si no hay marca" },
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

// Coach personal (chat): experto en nutrición y ejercicio con los datos del usuario
const COACH_PROMPT = `Eres el coach personal de nutrición y ejercicio de la app "Amigos Fit" (un grupo de amigos en Chile que registra comidas, entrenamientos y peso).
Combinas el conocimiento de un nutricionista deportivo y un entrenador, basado en la mejor evidencia científica actual (ISSN, ACSM, OMS, metaanálisis recientes).
Reglas:
- Responde SIEMPRE en español de Chile, cercano y motivador pero directo, tuteando. Respuestas breves y prácticas (máximo ~150 palabras salvo que pida detalle), con viñetas cortas cuando ayuden.
- Usa los DATOS DEL USUARIO de abajo: su objetivo, metas diarias, lo que lleva hoy, su historial, peso y actividad. Cita números concretos (kcal, gramos) cuando sirva. No inventes datos que no estén.
- Para "qué como": propone opciones concretas y comunes en Chile (marraqueta, palta, quesillo, pollo, legumbres, yogur protein, etc.) con porciones y sus kcal/proteína aproximadas, ajustadas a lo que le queda del día.
- Para ejercicio: rutinas concretas (series, repeticiones, minutos, intensidad) acordes a su nivel y objetivo.
- Hoy aún no termina: lo de hoy está incompleto. Los promedios valen sobre días ya cerrados.
- La meta diaria de la app ya descuenta el déficit/superávit del objetivo; "Te quedan" = meta − consumido.
- No diagnostiques enfermedades ni recetes medicamentos; ante síntomas, lesiones o dudas médicas recomienda consultar a un profesional. No promuevas dietas extremas (menos de 1.200–1.500 kcal) ni ayunos peligrosos.
- Si pregunta algo fuera de nutrición, ejercicio, salud o la app, redirígelo amablemente.
- Formato: texto simple. Puedes usar **negrita** y viñetas con "- ". Sin tablas ni títulos con #.`;

// Modelos (medidos con una etiqueta real, 24-nov-2026):
// - gemini-3.5-flash (razonamiento bajo): leyó bien la etiqueta (141 kcal, 15 g proteína), 7-27 s, casi sin saturación.
// - gemini-3.5-flash-lite: 2-4 s pero se equivocó (160 kcal, 5 g) y falla con 503 más de la mitad de las veces.
// Comidas: primero el preciso; el lite solo de respaldo (es el que se usaba antes, nunca uno más débil).
// Coach: primero el rápido (las respuestas de chat no requieren leer etiquetas).
const ACCURATE = "gemini-3.5-flash", FAST = "gemini-3.5-flash-lite";
async function attemptsFor(kind: "food" | "chat"): Promise<string[]> {
  if (Deno.env.get("GEMINI_MODEL")) return [GEMINI_MODEL, "__pausa__2000", GEMINI_MODEL];
  const available = await flashModels();
  const ok = (m: string) => !available.length || available.includes(m);
  const acc = ok(ACCURATE) ? ACCURATE : available.find((m) => !m.includes("lite")) ?? FAST;
  const fast = ok(FAST) ? FAST : available.find((m) => m.includes("lite")) ?? acc;
  return kind === "food"
    ? [acc, fast, "__pausa__2500", fast]
    : [fast, acc, "__pausa__1500", fast, acc];
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUSY = "La IA de Google está saturada en este momento (pasa a ratos y dura poco). Espera unos segundos y vuelve a tocar Analizar, o ingresa los valores a mano.";

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
    return []; // se usan los modelos preferidos
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

  let body: { image?: string; images?: string[]; mimeType?: string; comment?: string; meal?: string; mode?: string; today?: string; viewing?: string; known?: unknown[]; messages?: unknown[]; context?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  if (body.mode === "chat") return chat(body);

  const { image, mimeType = "image/jpeg", comment = "", meal = "", mode = "food", today = "", viewing = "" } = body;
  const images = (Array.isArray(body.images) ? body.images : image ? [image] : []).filter((x) => typeof x === "string" && x).slice(0, 6);
  const isActivity = mode === "activity";
  if (isActivity ? !images.length : !images.length && !comment.trim()) return json({ error: isActivity ? "Envía un pantallazo" : "Envía una foto o un comentario" }, 400);
  if (images.reduce((a, x) => a + x.length, 0) > 10_000_000) return json({ error: "Imágenes demasiado grandes" }, 413);

  const parts: unknown[] = [];
  let knownRows: Record<string, unknown>[] = [];
  if (isActivity) {
    parts.push({ text: ACTIVITY_PROMPT });
    if (/^\d{4}-\d{2}-\d{2}$/.test(today)) parts.push({ text: `Fecha de hoy: ${today}.` });
    if (/^\d{4}-\d{2}-\d{2}$/.test(viewing)) parts.push({ text: `El usuario está registrando el día ${viewing} (úsalo solo si no hay fecha visible).` });
  } else {
    parts.push({ text: PROMPT });
    if (meal) parts.push({ text: `Comida del día: ${meal}.` });
    if (images.length > 1) parts.push({ text: `Se adjuntan ${images.length} fotos de la MISMA comida (distintos ángulos o distintas partes). Combínalas para estimar mejor las porciones y NO cuentes dos veces un alimento que aparece en más de una foto.` });
    if (comment.trim()) parts.push({ text: `Comentario del usuario: """${comment.slice(0, 1000)}"""` });
    // Alimentos que este usuario ya registró (p. ej. leídos de una etiqueta): se reutilizan sus valores
    // Versiones especiales (con proteína, light, sin azúcar…) solo si el usuario menciona esa característica ahora;
    // si no, la IA tiende a confundir 'pancito integral' con 'pan integral con proteína'
    const said = normName(comment);
    knownRows = (Array.isArray(body.known) ? body.known : []).slice(0, 150).map((k) => (k ?? {}) as Record<string, unknown>)
      .filter((k) => knownEligible(k, said, images.length > 0));
    // Si varios del mismo tipo y rasgo calzan (ej. 2 panes con proteína), queda solo el más reciente
    // (la lista viene del más reciente al más antiguo); si el usuario nombra una marca, gana ese producto.
    {
      const saidW = said.split(" ").filter(Boolean);
      const brandSaid = (k: Record<string, unknown>) => toks(k.brand).length > 0 && toks(k.brand).every((t) => saysWord(saidW, t));
      const sig = (k: Record<string, unknown>) => {
        const n = normName(k.name), brandT = toks(k.brand);
        const base = toks(k.name).filter((t) => !brandT.includes(t))[0] ?? n;
        return base.slice(0, 4) + "|" + SPECIAL.map(([re]) => (re.test(n) ? 1 : 0)).join("");
      };
      const seenSig = new Set<string>();
      knownRows = [...knownRows.filter(brandSaid), ...knownRows.filter((k) => !brandSaid(k))].filter((k) => {
        const g = sig(k);
        if (!g.includes("1")) return true; // alimentos comunes: sin deduplicar
        if (seenSig.has(g)) return false;
        seenSig.add(g); return true;
      });
    }
    // "No es el mismo": reanalizar SOLO ese alimento, sin usar el registro que el usuario descartó
    const focus = (body.focus ?? null) as { name?: string; quantity?: string; not?: string } | null;
    if (focus?.name) {
      const notN = normName(focus.not || focus.name);
      knownRows = knownRows.filter((k) => normName(k.name) !== notN);
      parts.push({ text: `IMPORTANTE: analiza SOLO este alimento de la comida: '${String(focus.name).slice(0, 80)}'${focus.quantity ? ` (cantidad: ${String(focus.quantity).slice(0, 60)})` : ""}. El usuario aclaró que NO es '${String(focus.not || focus.name).slice(0, 80)}' de su registro anterior: estímalo de nuevo según la foto y lo que escribió, sin usar ese registro. Devuelve en items SOLO ese alimento (ningún otro), con un name que lo distinga.` });
    }
    const known = knownRows.map((k) => {
      const o = (k ?? {}) as Record<string, unknown>;
      const n = (v: unknown) => Math.round((Number(v) || 0) * 10) / 10;
      return `- ${String(o.name ?? "").slice(0, 60)}${o.brand ? ` (marca ${String(o.brand).slice(0, 40)})` : ""} | ${String(o.quantity ?? "").slice(0, 60)}${o.grams ? ` | ${n(o.grams)} g` : ""} | ${n(o.kcal)} kcal | P ${n(o.protein_g)} | C ${n(o.carbs_g)} | G ${n(o.fat_g)}`;
    }).filter((l) => l.length > 4);
    if (known.length) parts.push({ text: `ALIMENTOS QUE ESTE USUARIO YA REGISTRÓ ANTES (valores confirmados por él, varios leídos de etiquetas nutricionales):
${known.join("\n")}
(La lista va del registro MÁS RECIENTE al más antiguo: si varios calzan con lo que dice el usuario, ej. 'pan proteico', usa el más reciente.)
Si en esta comida aparece o se menciona el MISMO alimento (mismo producto Y misma marca si tiene, ej. 'galletas Salmas'), usa ESOS valores escalados proporcionalmente a la cantidad de ahora (por unidades o por gramos) en vez de estimar, y marca from_history = true y pon en history_name el nombre exacto de la lista. En quantity y grams pon SIEMPRE la cantidad de AHORA (ej. 'medio huevo' → quantity '0.5 unidad', grams = la mitad de los gramos de 1 unidad). Ej: si antes 3 unidades = 70 kcal y ahora comió 2, son 47 kcal. Usa el mismo nombre. Si es solo un alimento parecido pero distinto (otra marca o preparación), estímalo normal. Si el registrado tiene marca y en la foto no se ve esa marca ni el usuario la nombra, NO es el mismo.
CUIDADO con los productos especiales: si el registrado es una versión especial (con proteína, light, sin azúcar, de una marca, keto, etc.) y el usuario ahora NO dice esa característica (ej. antes 'pan con proteína', ahora solo 'pan integral' o 'pancito'), NO es el mismo: estímalo normal como el producto común. Ante la duda, NO reutilices. Si el usuario dice que es otro o distinto, nunca reutilices.` });
  }
  for (const img of images) parts.push({ inline_data: { mime_type: mimeType, data: img } });

  // Modelos medidos con una foto real (nov-2026): 3.5-flash-lite y 3.1-flash-lite responden en ~3-4 s con buena
  // calidad; gemini-3.8-flash tardó >60 s. Primero los rápidos conocidos y, si Google los retira, los "lite"/"flash"
  // disponibles que liste la API.
  // Se consultan el modelo preciso y el rápido EN PARALELO (Google satura a ratos uno u otro, nov-2026):
  // se usa el preciso si responde; si el rápido responde primero, se espera al preciso hasta 12 s más.
  const [acc, fast] = await (async () => { const m = await attemptsFor("food"); return [m[0], m.find((x, i) => i > 0 && !x.startsWith("__")) ?? m[0]]; })();
  const baseConfig = { temperature: 0.2, responseMimeType: "application/json", responseSchema: isActivity ? ACTIVITY_SCHEMA : SCHEMA };
  const deadline = Date.now() + 55_000; // responder antes de que el servidor corte la conexión
  type Try = { ok: true; text: string; model: string } | { ok: false; status: number; message: string };
  const ctrl = new AbortController();
  const ask = async (model: string, timeout: number): Promise<Try> => {
    const thinking = /^gemini-[3-9]/.test(model) && !model.includes("lite");
    const configs = thinking ? [{ ...baseConfig, thinkingConfig: { thinkingLevel: "low" } }, baseConfig] : [baseConfig];
    let err: Try = { ok: false, status: 504, message: "la IA tardó demasiado" };
    for (const generationConfig of configs) {
      const left = deadline - Date.now();
      if (left < 3_000) return err;
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(Math.min(timeout, left))]),
        });
        const t = await r.text();
        if (r.ok) return { ok: true, text: t, model };
        let message = t.slice(0, 300);
        try { message = JSON.parse(t)?.error?.message ?? message; } catch { /* texto plano */ }
        console.error("Gemini error", model, r.status, message);
        err = { ok: false, status: r.status, message };
        if (r.status === 400 && /thinking/i.test(message)) continue;
        return err;
      } catch (e) {
        console.error("Gemini timeout/red", model, e);
        return { ok: false, status: 504, message: `sin respuesta de ${model} (${(e as Error).name})` };
      }
    }
    return err;
  };
  // El rápido reintenta si Google lo satura (hasta 4 veces, con pausas cortas)
  const fastChain = async (): Promise<Try> => {
    let r: Try = { ok: false, status: 504, message: "" };
    for (const pause of [0, 1500, 2500, 4000]) {
      if (pause) { if (deadline - Date.now() < pause + 8_000) break; await sleep(pause); }
      r = await ask(fast, 15_000);
      if (r.ok || ![429, 500, 503, 504].includes(r.status)) return r;
    }
    return r;
  };
  const accP = ask(acc, 45_000);
  const fastP = acc === fast ? accP : fastChain();
  const first = await Promise.race([accP.then((r) => ({ k: "acc", r })), fastP.then((r) => ({ k: "fast", r }))]);
  let won: Try;
  if (first.k === "acc") won = first.r.ok ? first.r : await fastP;
  else if (first.r.ok) {
    const late = await Promise.race([accP, sleep(12_000).then(() => null)]);
    won = late && late.ok ? late : first.r;
  } else { const a2 = await accP; won = a2.ok ? a2 : first.r; }
  ctrl.abort(); // corta la consulta que quedó pendiente
  if (won.ok) console.log("modelo usado", won.model);

  if (!won.ok) {
    const lastErr = won;
    const msg = lastErr.status === 503 || lastErr.status === 500 || lastErr.status === 504
      ? BUSY
      : lastErr.status === 429
      ? "Se alcanzó el límite gratuito de análisis por minuto/día. Intenta en un rato o ingresa los valores a mano."
      : lastErr.status === 400 && /API key/i.test(lastErr.message)
      ? "La clave de Gemini no es válida. Revisa el secreto GEMINI_API_KEY."
      : lastErr.status === 403
      ? "Gemini rechazó la clave (403): puede que la API no esté habilitada en ese proyecto de Google."
      : `No se pudo analizar (Gemini ${lastErr.status}): ${lastErr.message}`;
    return json({ error: msg }, 502);
  }

  const data = JSON.parse(won.text);
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
    const items = Array.isArray(result.items) ? result.items : [];
    // Alimentos del historial: el escalado se hace aquí con aritmética (la IA a veces copia los valores sin escalar,
    // ej. 'medio huevo' con las kcal de uno entero)
    for (const it of items) if (it?.from_history) scaleFromHistory(it, knownRows);
    // Recalcula totales desde los items para que siempre cuadren
    const sum = (k: string) => Math.round(items.reduce((a: number, it: Record<string, number>) => a + (Number(it[k]) || 0), 0) * 10) / 10;
    if (items.length) result.total = { kcal: Math.round(sum("kcal")), protein_g: sum("protein_g"), carbs_g: sum("carbs_g"), fat_g: sum("fat_g") };
    return json(result);
  } catch {
    console.error("Respuesta no-JSON de Gemini", text);
    return json({ error: "La IA devolvió una respuesta inválida, intenta de nuevo." }, 502);
  }
}

// [rasgo en el nombre del alimento registrado, cómo lo diría el usuario]
const SPECIAL: [RegExp, RegExp][] = [
  [/\bprote/, /\bprote/],
  [/\blight\b|\blite\b/, /\blight\b|\blite\b|\bligh/],
  [/sin azucar|\bzero\b|\bdiet\b/, /sin azucar|\bzero\b|\bdiet\b/],
  [/\bketo\b/, /\bketo\b/],
  [/sin gluten/, /sin gluten/],
  [/sin lactosa/, /sin lactosa/],
];
// ¿Se puede reutilizar este alimento del historial? Antes bastaba la palabra 'pan' para que la IA asumiera el
// 'Pan integral con proteína' registrado. Ahora:
// - con marca registrada: el usuario debe nombrar la marca y el tipo de alimento (ej. '2 rebanadas de pan Ideal'),
//   o mandar foto (la IA solo lo usa si ve esa marca en el envase);
// - con rasgo especial (con proteína, light…): basta el tipo + el rasgo ('pan proteico');
// - si no: el usuario debe mencionar TODAS las palabras del nombre (ej. 'huevo duro', no solo 'huevo').
const STOP = new Set(["de", "del", "con", "sin", "la", "el", "los", "las", "y", "en", "al", "a", "un", "una", "tipo"]);
const toks = (s: unknown) => normName(s).split(" ").filter((w) => w.length >= 2 && !STOP.has(w));
function saysWord(said: string[], tok: string): boolean {
  const stem = tok.length > 4 ? tok.slice(0, tok.length - 2) : tok; // plurales y diminutivos: pan→pancito, galletas→galleta
  return said.some((w) => w.startsWith(stem) || (w.length >= 3 && tok.startsWith(w)));
}
function knownEligible(k: Record<string, unknown>, saidText: string, hasImages: boolean): boolean {
  const said = saidText.split(" ").filter(Boolean);
  const brandT = toks(k.brand);
  const nameT = toks(k.name).filter((t) => !brandT.includes(t));
  const special = SPECIAL.every(([re, said_re]) => !re.test(normName(k.name)) || said_re.test(saidText));
  if (brandT.length) {
    if (brandT.every((t) => saysWord(said, t))) return !nameT.length || saysWord(said, nameT[0]) || hasImages;
    if (hasImages) return true; // con foto la IA verifica la marca en el envase (instrucción: mismo producto Y misma marca)
  }
  if (!nameT.length || !special) return false;
  // Con un rasgo especial (con proteína, light…) basta el tipo de alimento + ese rasgo, tenga o no marca:
  // 'pan proteico' → el último pan con proteína registrado. Sin rasgo especial: marca o todas las palabras.
  const hasSpecial = SPECIAL.some(([re]) => re.test(normName(k.name)));
  if (hasSpecial) return saysWord(said, nameT[0]);
  return !brandT.length && nameT.every((t) => saysWord(said, t));
}
const normName = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Cantidad y unidad al inicio del texto: "2 unidades", "0.5 unidad", "1,5 huevos", "1/2 taza", "medio huevo"
function leadingQty(q: unknown): { n: number; unit: string } | null {
  const raw = String(q ?? "").trim().replace(/(\d),(\d)/g, "$1.$2");
  const s = normName(raw);
  let n: number | null = null, rest = "";
  const frac = raw.match(/^(\d+)\s*\/\s*(\d+)\s*(.*)$/);
  const num = raw.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  const word = s.match(/^(medio|media|mitad de|mitad|un|una|uno)\s+(.*)$/);
  if (frac) { n = Number(frac[1]) / Number(frac[2]); rest = frac[3]; }
  else if (num) { n = Number(num[1]); rest = num[2]; }
  else if (word) { n = /^(medio|media|mitad)/.test(word[1]) ? 0.5 : 1; rest = word[2]; }
  if (n == null || !(n > 0)) return null;
  // primera palabra de la unidad, en singular (unidades→unidad, huevos→huevo, galletas→galleta)
  const unit = normName(rest).replace(/^(de|del)\s+/, "").split(" ")[0]?.replace(/(es|s)$/, "") ?? "";
  return { n, unit: unit === "unidad" || unit === "u" || unit === "un" ? "unidad" : unit };
}
function scaleFromHistory(it: Record<string, unknown>, known: Record<string, unknown>[]) {
  const target = normName(it.history_name || it.name);
  if (!target) return;
  const k = known.find((x) => normName(x.name) === target) ?? known.find((x) => normName(x.name) === normName(it.name));
  if (!k || !(Number(k.kcal) > 0)) return;
  let f: number | null = null;
  const gNow = Number(it.grams), gK = Number(k.grams);
  const qNow = leadingQty(it.quantity), qK = leadingQty(k.quantity);
  // Misma unidad (unidades, galletas, tazas…) → por cantidad; si no, por gramos
  if (qNow && qK && qNow.unit === qK.unit) f = qNow.n / qK.n;
  else if (gNow > 0 && gK > 0) f = gNow / gK;
  if (!f || !isFinite(f) || f <= 0 || f > 20) return;
  const r1 = (v: unknown) => Math.round((Number(v) || 0) * f! * 10) / 10;
  it.kcal = Math.round((Number(k.kcal) || 0) * f);
  it.protein_g = r1(k.protein_g); it.carbs_g = r1(k.carbs_g); it.fat_g = r1(k.fat_g);
  if (gK > 0) it.grams = Math.round(gK * f);
}

// Llama a Gemini probando modelos rápidos en orden; devuelve el texto de la respuesta
async function gemini(payload: Record<string, unknown>, temperature: number): Promise<{ text?: string; status?: number; message?: string }> {
  const models = await attemptsFor("chat");
  const deadline = Date.now() + 50_000;
  let last = { status: 0, message: "" };
  for (const model of models) {
    if (model.startsWith("__pausa__")) { const ms = Number(model.slice(9)); if (deadline - Date.now() > ms + 12_000) { await sleep(ms); continue; } break; }
    const left = deadline - Date.now();
    if (left < 5_000) break;
    let resp: Response;
    try {
      resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify({ ...payload, generationConfig: { temperature, maxOutputTokens: 2500, ...(model.includes("lite") ? {} : { thinkingConfig: { thinkingLevel: "low" } }) } }),
        signal: AbortSignal.timeout(Math.min(model.includes("lite") ? 12_000 : 25_000, left)),
      });
    } catch (e) { last = { status: 504, message: (e as Error).name }; continue; }
    if (resp.ok) {
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("").trim() ?? "";
      if (text) return { text };
      last = { status: 502, message: "respuesta vacía" };
      continue;
    }
    const detail = await resp.text();
    let message = detail.slice(0, 300);
    try { message = JSON.parse(detail)?.error?.message ?? message; } catch { /* texto */ }
    last = { status: resp.status, message };
    console.error("Gemini chat error", model, resp.status, message);
    if (![404, 429, 500, 503].includes(resp.status)) break;
  }
  return last;
}

async function chat(body: { messages?: unknown[]; context?: string }): Promise<Response> {
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .map((m) => (m ?? {}) as Record<string, unknown>)
    .filter((m) => typeof m.text === "string" && m.text.trim())
    .slice(-20)
    .map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: String(m.text).slice(0, 2000) }] }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "Escribe una pregunta" }, 400);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const context = String(body.context ?? "").slice(0, 40_000);
  const r = await gemini({
    systemInstruction: { parts: [{ text: `${COACH_PROMPT}\n\n===== DATOS DEL USUARIO =====\n${context}` }] },
    contents: msgs,
  }, 0.6);
  if (r.text) return json({ reply: r.text });
  const msg = r.status === 429 ? "Se alcanzó el límite gratuito de la IA por ahora. Intenta en un rato."
    : [500, 503, 504].includes(r.status ?? 0) ? "La IA de Google está saturada en este momento. Espera unos segundos y vuelve a preguntar."
    : `El coach no pudo responder (${r.status}): ${r.message}`;
  return json({ error: msg }, 502);
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
