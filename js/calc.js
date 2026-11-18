// Cálculos nutricionales puros (sin dependencias, testeables con Node).

// Modelo de energía:
// - META diaria (fija) = gasto PROMEDIO − déficit. El promedio = vida diaria + entrenamientos habituales repartidos en la semana.
// - BALANCE de cada día = lo que comiste − gasto REAL de ese día:
//     gasto real = vida diaria (sin entrenos) + ejercicio registrado ese día (o el total del reloj si lo ingresas).
//   Así un día sin entrenar muestra menos déficit y un día con entreno más, sin mover la meta ni contar nada dos veces.

// Nivel de actividad de la VIDA DIARIA, SIN contar entrenamientos.
export const ACTIVITY_LEVELS = {
  sedentario: { factor: 1.2,  label: 'Sedentaria: oficina o casa, camino poco (menos de 5.000 pasos)' },
  ligero:     { factor: 1.35, label: 'Ligera: de pie o caminando parte del día (5.000–8.000 pasos)' },
  moderado:   { factor: 1.5,  label: 'Activa: camino harto o trabajo en movimiento (8.000–12.000 pasos)' },
  activo:     { factor: 1.65, label: 'Muy activa: trabajo físico pesado (más de 12.000 pasos)' },
};

export const DEFAULT_CREDIT = 75; // % de las kcal de ejercicio del reloj que se consideran (los relojes sobreestiman)

// Intensidad típica de los entrenamientos (MET aproximado)
export const TRAINING_INTENSITY = {
  ligera:   { met: 4, label: 'Ligera (caminata rápida, yoga, pilates)' },
  moderada: { met: 6, label: 'Moderada (pesas, trote suave, bicicleta, baile)' },
  intensa:  { met: 9, label: 'Intensa (correr, HIIT, crossfit, fútbol, spinning)' },
};

// Dos tipos de entrenamiento habitual
export const TRAINING_TYPES = {
  mod: { met: 6, label: 'Moderados', ej: 'fuerza / pesas, trote suave, bicicleta, baile, yoga' },
  int: { met: 9, label: 'Intensos', ej: 'fútbol, natación, correr, pádel, HIIT, crossfit, spinning' },
};

/** kcal por minuto a un MET dado, por sobre el reposo (el reposo ya está en el TMB) */
export function kcalPerMinAt(p, met) {
  return ((met - 1) * 3.5 * (Number(p.weight_kg) || 70)) / 200;
}

/** Compatibilidad: kcal/min según la intensidad indicada */
export function trainingKcalPerMin(p, intensity = 'moderada') {
  return kcalPerMinAt(p, TRAINING_INTENSITY[intensity]?.met ?? TRAINING_TYPES.mod.met);
}

/** Entrenos habituales del perfil en dos filas (con compatibilidad con el formato anterior de una fila) */
export function trainingPlan(p) {
  if (p.train_mod_sessions != null || p.train_int_sessions != null) {
    return {
      mod: { n: Number(p.train_mod_sessions) || 0, min: Number(p.train_mod_minutes) || 0 },
      int: { n: Number(p.train_int_sessions) || 0, min: Number(p.train_int_minutes) || 0 },
    };
  }
  const old = { n: Number(p.training_sessions_week) || 0, min: Number(p.training_minutes) || 0 };
  return p.training_intensity === 'intensa' ? { mod: { n: 0, min: 60 }, int: old } : { mod: old, int: { n: 0, min: 90 } };
}

/** Gasto promedio diario de los entrenamientos habituales (sesiones × minutos repartidos en 7 días) */
export function avgTrainingKcal(p) {
  const t = trainingPlan(p);
  const week = t.mod.n * t.mod.min * kcalPerMinAt(p, TRAINING_TYPES.mod.met) + t.int.n * t.int.min * kcalPerMinAt(p, TRAINING_TYPES.int.met);
  return Math.round(week / 7);
}

/** MET aproximado según el nombre de la actividad registrada */
export function metForActivity(name = '') {
  const n = name.toLowerCase();
  if (/f[uú]tbol|nata|corr|running|trote r[aá]pido|crossfit|hiit|spinning|p[aá]del|tenis|box|squash|basket|b[aá]squet|rugby|trek|escal/.test(n)) return TRAINING_TYPES.int.met;
  if (/camin|yoga|pilates|estir|movilidad/.test(n)) return 4;
  return TRAINING_TYPES.mod.met;
}

export const GOALS = {
  lose:      'Bajar de peso',
  lose_tone: 'Bajar de peso y tonificar',
  recomp:    'Tonificar (bajar grasa sin bajar mucho de peso)',
  maintain:  'Mantener peso',
  fitness:   'Mejorar condición física / rendimiento',
  gain:      'Aumentar masa muscular',
};

/** Hacia dónde debería moverse el peso según el objetivo */
export function weightDirection(goal) {
  if (goal === 'lose' || goal === 'lose_tone') return 'down';
  if (goal === 'gain') return 'up';
  return 'stable';
}

/** Objetivos que usan un ritmo en kg/semana */
export const usesRate = (goal) => ['lose', 'lose_tone', 'gain'].includes(goal);

/** Edad exacta a partir de la fecha de nacimiento (YYYY-MM-DD) */
export function ageFromBirth(iso, today = new Date()) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  let a = today.getFullYear() - y;
  const mm = today.getMonth() + 1;
  if (mm < m || (mm === m && today.getDate() < d)) a--;
  return a;
}

/** Convierte "72,5" o "72.5" a número (NaN si no es válido) */
export function parseNum(v) {
  const n = parseFloat(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const KCAL_PER_KG = 7700; // energía aproximada de 1 kg de tejido corporal

/** Metabolismo basal — Mifflin-St Jeor */
export function bmr({ sex, weight_kg, height_cm, age }) {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return Math.round(sex === 'M' ? base + 5 : base - 161);
}

/** Gasto de la vida diaria SIN entrenamientos (+ ajuste personal de calibración) */
export function baseNoTraining(p) {
  const f = ACTIVITY_LEVELS[p.activity_level]?.factor ?? 1.2;
  return Math.round(bmr(p) * f + (Number(p.calibration_kcal) || 0));
}

/** Gasto promedio según la FÓRMULA (vida diaria + entrenos habituales), sin aprendizaje */
export function formulaTdee(p) {
  return baseNoTraining(p) + avgTrainingKcal(p);
}

export const LEARN_MIN_DAYS = 7;   // días con gasto del reloj para empezar a aprender
export const LEARN_FULL_DAYS = 14; // desde aquí la meta usa 100% lo aprendido

/** Peso (0–1) que tiene el gasto aprendido del reloj en la meta */
export function learnedWeight(p) {
  const n = Number(p.learned_days) || 0;
  if (!(Number(p.learned_tdee) > 0) || n < LEARN_MIN_DAYS) return 0;
  return Math.min(1, n / LEARN_FULL_DAYS);
}

/**
 * Gasto PROMEDIO diario, base de la meta fija.
 * Parte con la fórmula y, a medida que registras el gasto total del reloj, se mezcla con tu promedio real:
 * 7 días → 50% reloj, 14 días o más → 100% reloj (últimos 28 días).
 */
export function tdee(p) {
  const w = learnedWeight(p);
  return Math.round(formulaTdee(p) * (1 - w) + (Number(p.learned_tdee) || 0) * w);
}

/** Aprende el gasto promedio real desde los cierres del reloj (ya ajustados por el % de confianza) */
export function learnFromWatch(p, watchDays) {
  const vals = watchDays.filter((w) => Number(w.total_kcal) > 0).map((w) => dayExpenditure(p, 0, w).kcal);
  if (!vals.length) return { days: 0, avg: null };
  return { days: vals.length, avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) };
}

const creditPct = (p) => (p.exercise_credit_pct ?? DEFAULT_CREDIT) / 100;

/** kcal que se consideran de un entrenamiento registrado: % de lo que dice el reloj, o estimado por minutos */
export function activityKcal(p, a) {
  if (Number(a.kcal_burned) > 0) return Math.round(Number(a.kcal_burned) * creditPct(p));
  return Math.round((Number(a.minutes) || 0) * kcalPerMinAt(p, metForActivity(a.activity)));
}

/** Déficit diario objetivo (positivo = déficit; negativo = superávit para ganar masa) */
export function targetDeficit(p) {
  return tdee(p) - (p.kcal_target || 0);
}

/** Gasto de un día SIN entrenar (si la app ya aprendió de tu reloj, usa ese promedio sin los entrenos habituales) */
export function dayBase(p) {
  return tdee(p) - avgTrainingKcal(p);
}

/**
 * Plan del día: la meta de ingesta se ajusta al gasto REAL del día para mantener tu déficit objetivo.
 *   meta de hoy = gasto de hoy − déficit objetivo
 * Día con entreno → la meta sube; día sin entreno → baja (nunca bajo tu metabolismo basal / mínimo saludable).
 * Proteína y grasas se mantienen; la diferencia se ajusta en carbohidratos.
 */
export function dayPlan(p, exerciseKcal, watch) {
  // La META solo depende de lo que se puede controlar durante el día: gasto base + entrenos registrados.
  // El cierre del reloj (que llega al día siguiente) NO la mueve: solo cambia el déficit REAL (spent).
  const planned = dayExpenditure(p, exerciseKcal, null);
  const spent = dayExpenditure(p, exerciseKcal, watch);
  const deficit = targetDeficit(p);
  const floor = Math.max(bmr(p), p.sex === 'M' ? 1500 : 1200);
  let kcal = Math.round(planned.kcal - deficit);
  if (deficit > 0) kcal = Math.max(Math.round(floor), kcal);
  const carbs_g = Math.max(0, Math.round((kcal - p.protein_g * 4 - p.fat_g * 9) / 4));
  return { kcal_target: kcal, protein_g: p.protein_g, carbs_g, fat_g: p.fat_g, planned, spent, deficit, delta: kcal - (p.kcal_target || 0) };
}

/** Meta de ingesta del día (ver dayPlan; no depende del cierre del reloj) */
export function dayTarget(p, exerciseKcal = 0) {
  return dayPlan(p, exerciseKcal, null).kcal_target;
}

/**
 * Gasto REAL del día para el balance.
 * - Con cierre del reloj: reposo + activas × % (si solo hay total: TMB + (total − TMB) × %).
 * - Sin reloj: vida diaria sin entrenos + entrenamientos registrados ese día (exerciseKcal ya ajustado).
 */
export function dayExpenditure(p, exerciseKcal, watch) {
  if (watch && Number(watch.total_kcal) > 0) {
    const c = creditPct(p);
    const total = Number(watch.total_kcal);
    const rest = Number(watch.resting_kcal) || 0;
    const act = Number(watch.active_kcal) || 0;
    const kcal = rest && act ? rest + act * c : bmr(p) + Math.max(0, total - bmr(p)) * c;
    return { kcal: Math.round(Math.min(total, kcal)), source: 'reloj' };
  }
  return { kcal: dayBase(p) + Math.round(Number(exerciseKcal) || 0), source: 'estimado' };
}

/**
 * Calibración con la balanza: compara el gasto que la app estimó con el gasto real que se deduce
 * de lo que comiste y de cómo cambió tu peso.
 * days: [{ intake, expenditure }] solo días con comidas registradas; weights: [{ date: 'YYYY-MM-DD', kg }]
 */
export function calibrate(days, weights, periodDays) {
  if (days.length < Math.max(14, periodDays * 0.75)) return { ok: false, reason: `Necesitas registrar comidas en al menos ${Math.max(14, Math.ceil(periodDays * 0.75))} de los últimos ${periodDays} días (llevas ${days.length}).` };
  if (weights.length < 3) return { ok: false, reason: `Necesitas al menos 3 pesajes en el período (llevas ${weights.length}).` };
  const t0 = new Date(weights[0].date).getTime();
  const xs = weights.map((w) => (new Date(w.date).getTime() - t0) / 86400000);
  if (xs[xs.length - 1] < 14) return { ok: false, reason: 'Los pesajes deben abarcar al menos 2 semanas.' };
  const ys = weights.map((w) => Number(w.kg));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); // kg/día
  const intake = days.reduce((a, d) => a + d.intake, 0) / days.length;
  const est = days.reduce((a, d) => a + d.expenditure, 0) / days.length;
  const real = intake - slope * KCAL_PER_KG;
  const predictedKgWeek = ((intake - est) * 7) / KCAL_PER_KG;
  return { ok: true, intake: Math.round(intake), est: Math.round(est), real: Math.round(real), diff: Math.round(real - est),
    realKgWeek: Math.round(slope * 7 * 100) / 100, predictedKgWeek: Math.round(predictedKgWeek * 100) / 100 };
}

/**
 * Meta diaria de calorías y macros según objetivo.
 * - Bajar de peso: déficit = ritmo (kg/sem) × 7700 / 7, acotado a 300–1000 kcal. Proteína 2,0 g/kg.
 * - Bajar y tonificar: igual, con déficit máx. 750 kcal (protege el músculo) y proteína 2,2 g/kg.
 * - Tonificar (recomposición): déficit leve de 10% (máx. 300 kcal), proteína 2,2 g/kg.
 * - Mantener: GET, proteína 1,6 g/kg. Condición física: GET, proteína 1,6 g/kg, más carbohidratos.
 * - Masa muscular: superávit = ritmo × 7700 / 7, acotado a 150–500 kcal, proteína 1,8 g/kg.
 * Nunca bajo el TMB ni bajo 1200 (mujer) / 1500 (hombre) kcal. Grasa 25% (20% en condición física; mín. 0,6 g/kg).
 */
export function targets(p) {
  const B = bmr(p);
  const T = tdee(p);
  const rate = Math.max(0, Number(p.rate_kg_week) || 0);
  const perWeek = (rate * KCAL_PER_KG) / 7;
  let adjust = 0;
  let warning = null;

  switch (p.goal) {
    case 'lose':      adjust = -Math.min(1000, Math.max(300, perWeek)); break;
    case 'lose_tone': adjust = -Math.min(750, Math.max(300, perWeek)); break;
    case 'recomp':    adjust = -Math.min(300, T * 0.1); break;
    case 'gain':      adjust = Math.min(500, Math.max(150, perWeek)); break;
    default:          adjust = 0;
  }

  let kcal = Math.round(T + adjust);
  const floor = Math.max(B, p.sex === 'M' ? 1500 : 1200);
  if (adjust < 0 && kcal < floor) {
    kcal = Math.round(floor);
    warning = `Ajustamos la meta a ${kcal} kcal para no bajar de tu metabolismo basal / mínimo saludable. El ritmo real será más lento.`;
  }

  const proteinPerKg = { lose: 2.0, lose_tone: 2.2, recomp: 2.2, gain: 1.8 }[p.goal] ?? 1.6;
  const fatShare = p.goal === 'fitness' ? 0.2 : 0.25;
  const protein_g = Math.round(proteinPerKg * p.weight_kg);
  const fat_g = Math.round(Math.max(0.6 * p.weight_kg, (kcal * fatShare) / 9));
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));

  const realDeficit = kcal - T;
  const weeklyChangeKg = Math.round(((realDeficit * 7) / KCAL_PER_KG) * 100) / 100;

  return { bmr: B, tdee: T, kcal_target: kcal, protein_g, carbs_g, fat_g, adjust: Math.round(realDeficit), weeklyChangeKg, warning };
}

/** Fecha local YYYY-MM-DD (evita desfases UTC) */
export function isoDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return isoDate(dt);
}

/** Lunes de la semana de una fecha ISO */
export function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // 0 = lunes
  return addDays(iso, -dow);
}

export function sumLogs(logs) {
  return logs.reduce(
    (a, l) => ({
      kcal: a.kcal + Number(l.kcal || 0),
      protein_g: a.protein_g + Number(l.protein_g || 0),
      carbs_g: a.carbs_g + Number(l.carbs_g || 0),
      fat_g: a.fat_g + Number(l.fat_g || 0),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

// ---------------------------------------------------------------- Coach de macros
// Alimentos de referencia (valores por 1 unidad o por 1 g), con porciones realistas
const pl = (n, one, many) => (n === 1 ? one : many);
const FOODS = {
  pollo:   { macro: 'p', kcal: 1.65, p: 0.31, c: 0, f: 0.04, step: 50, min: 100, max: 250, label: (q) => `${q} g de pechuga de pollo` },
  atun:    { macro: 'p', kcal: 110, p: 25, c: 0, f: 1, max: 2, label: (q) => `${q} ${pl(q, 'lata', 'latas')} de atún al agua` },
  claras:  { macro: 'p', kcal: 17, p: 3.6, c: 0, f: 0, max: 8, label: (q) => `${q} claras de huevo` },
  yogur:   { macro: 'p', kcal: 120, p: 20, c: 8, f: 1, max: 2, label: (q) => `${q} ${pl(q, 'yogur', 'yogures')} protein` },
  quesillo:{ macro: 'p', kcal: 1.05, p: 0.13, c: 0.03, f: 0.04, step: 50, min: 50, max: 200, label: (q) => `${q} g de quesillo` },
  huevo:   { macro: 'p', kcal: 78, p: 6.3, c: 0.6, f: 5.3, max: 3, label: (q) => `${q} ${pl(q, 'huevo duro', 'huevos duros')}` },
  arroz:   { macro: 'c', kcal: 205, p: 4, c: 45, f: 0.4, max: 1.5, half: true, label: (q) => `${String(q).replace('.', ',')} ${pl(q, 'taza', 'tazas')} de arroz o fideos cocidos` },
  avena:   { macro: 'c', kcal: 3.75, p: 0.13, c: 0.67, f: 0.07, step: 10, min: 30, max: 80, label: (q) => `${q} g de avena` },
  platano: { macro: 'c', kcal: 105, p: 1, c: 27, f: 0.3, max: 2, label: (q) => `${q} ${pl(q, 'plátano', 'plátanos')}` },
  palta:   { macro: 'f', kcal: 1.6, p: 0.02, c: 0.08, f: 0.15, step: 10, min: 30, max: 80, label: (q) => `${q} g de palta` },
  nueces:  { macro: 'f', kcal: 6.25, p: 0.2, c: 0.15, f: 0.55, step: 5, min: 15, max: 30, label: (q) => `${q} g de nueces o almendras` },
};

/** Porción del alimento para cubrir "need" gramos de su macro principal (respetando mínimo y máximo realista) */
function portion(key, need) {
  const f = FOODS[key];
  let q = need / f[f.macro];
  if (f.step) q = Math.min(f.max, Math.max(f.min, Math.round(q / f.step) * f.step));
  else if (f.half) q = Math.min(f.max, Math.max(0.5, Math.round(q * 2) / 2));
  else q = Math.min(f.max, Math.max(1, Math.round(q)));
  return { key, q, txt: f.label(q), kcal: Math.round(q * f.kcal), p: Math.round(q * f.p), c: Math.round(q * f.c), f: Math.round(q * f.f) };
}

/** Combina 1–2 alimentos proteicos para cubrir "need" g de proteína */
function proteinCombo(main, extra, need) {
  const a = portion(main, need);
  const rest = need - a.p;
  if (rest < 8) return [a];
  return [a, portion(extra, rest)];
}

/** Comidas que quedan en el día según la hora (para repartir lo que falta) */
export function mealsLeft(hour) {
  if (hour < 10) return ['desayuno', 'almuerzo', 'once', 'cena'];
  if (hour < 14) return ['almuerzo', 'once', 'cena'];
  if (hour < 18) return ['once', 'cena'];
  if (hour < 22) return ['cena'];
  return [];
}

/** Minutos de ejercicio para quemar "kcal" (caminata MET 3,5 · trote MET 8), según peso */
export function exerciseFor(kcal, weightKg) {
  const per = (met) => ((met - 1) * 3.5 * (Number(weightKg) || 70)) / 200;
  const r5 = (m) => Math.max(10, Math.round(m / 5) * 5);
  return { walk: r5(kcal / per(3.5)), jog: r5(kcal / per(8)) };
}

/**
 * Sugerencias breves para lo que queda del día (nutrición + ejercicio).
 * t: plan del día { kcal_target, protein_g, carbs_g, fat_g } · eaten: totales · hour: 0–23
 * opts: { doneMeals: ['desayuno',…], weightKg, trained: bool }
 * Devuelve { tone: 'ok'|'warn'|'info', items: [texto] } (máx. 4 frases cortas)
 */
export function macroCoach(t, eaten, hour, opts = {}) {
  const { doneMeals = [], weightKg = 70, trained = false } = Array.isArray(opts) ? { doneMeals: opts } : opts;
  const left = { kcal: t.kcal_target - eaten.kcal, p: t.protein_g - eaten.protein_g, c: t.carbs_g - eaten.carbs_g, f: t.fat_g - eaten.fat_g };
  const ORDER = ['desayuno', 'almuerzo', 'once', 'cena'];
  const lastDone = Math.max(-1, ...doneMeals.map((m) => ORDER.indexOf(m)));
  const meals = mealsLeft(hour).filter((m) => ORDER.indexOf(m) > lastDone);
  const n = Math.max(1, meals.length);
  const r = (x) => Math.round(x).toLocaleString('es-CL');
  const items = [];

  if (eaten.kcal === 0) {
    items.push(`🍽️ Reparte ~${r(t.kcal_target / n)} kcal y ~${r(t.protein_g / n)} g de proteína por comida${meals.length > 1 ? ` (${meals.join(', ')})` : ''}.`);
    items.push('🥗 Plato: ½ verduras, ¼ proteína magra, ¼ carbohidratos.');
    if (!trained && hour < 20) items.push('🏃 Si entrenas hoy, regístralo: tu meta sube.');
    return { tone: 'info', items };
  }

  // Se pasó de calorías → ejercicio + cerrar el día liviano
  if (left.kcal < -Math.max(80, t.kcal_target * 0.04)) {
    const over = -left.kcal;
    const ex = exerciseFor(over, weightKg);
    items.push(`⚠️ Te pasaste ${r(over)} kcal.`);
    items.push(`🏃 Compénsalo: camina ${ex.walk} min o trota ${ex.jog} min (y regístralo).`);
    items.push('🥗 Resto del día: solo verduras, caldos, infusiones y agua.');
    return { tone: 'warn', items };
  }

  const near = Math.abs(left.kcal) <= t.kcal_target * 0.08;
  if (near && left.p <= t.protein_g * 0.1) {
    items.push('✅ ¡Día cumplido! Calorías y proteína en tu meta.');
    if (left.f < -8 || left.c < -15) items.push('Para cerrar: nada más que agua o infusiones.');
    return { tone: 'ok', items };
  }

  // Calorías que quedan
  if (left.kcal > 120) items.push(`🍽️ Quedan ${r(left.kcal)} kcal${n > 1 ? ` (~${r(left.kcal / n)} por comida)` : meals[0] ? ` para la ${meals[0]}` : ''}.`);

  // Proteína (la prioridad)
  if (left.p > 10) {
    const need = Math.max(15, Math.min(55, left.p / n));
    const lean = left.kcal / Math.max(1, left.p) < 6;
    const plan = proteinCombo(lean ? 'atun' : 'pollo', lean ? 'claras' : 'yogur', need);
    const alt = portion(lean ? 'claras' : 'atun', need);
    items.push(`🥩 Faltan ${r(left.p)} g de proteína → ${plan.map((x) => x.txt).join(' + ')} o ${alt.txt}${lean ? ', sin pan ni arroz' : ''}.`);
  }

  // Excesos de grasa o carbohidratos
  if (left.f < -5) items.push(`🥑 Grasas al tope (+${r(-left.f)} g): nada frito, sin palta ni frutos secos.`);
  else if (left.c < -10) items.push(`🍞 Carbohidratos al tope (+${r(-left.c)} g): solo proteína y verduras.`);
  else if (left.c > 40 && left.kcal > 300 && items.length < 3) items.push(`🍞 Quedan ${r(left.c)} g de carbohidratos: ${portion(hour < 12 ? 'avena' : 'arroz', Math.min(left.c, 55)).txt} o fruta.`);

  // Ejercicio
  if (!trained && hour >= 6 && hour < 21 && items.length < 4) {
    const ex = exerciseFor(200, weightKg);
    items.push(`🏃 Sin entreno hoy: ${ex.walk} min de caminata suma ~200 kcal a tu margen.`);
  }
  if (!meals.length && left.kcal > 300) items.push(`🌙 Ya es tarde: no fuerces comer las ${r(left.kcal)} kcal que quedan.`);

  return { tone: 'info', items: items.slice(0, 4) };
}

/**
 * Coach de días pasados: evalúa lo realmente comido vs el plan del día y explica el efecto según el objetivo.
 * plan: dayPlan(...) · eaten: totales · balance: comido − gasto real (negativo = déficit) · trained: bool
 */
export function dayReview(p, plan, eaten, balance, trained) {
  const r = (x) => Math.round(x).toLocaleString('es-CL');
  const kg = (kcal) => String(Math.round((Math.abs(kcal) / KCAL_PER_KG) * 100) / 100).replace('.', ',');
  const g = p.goal;
  const cutting = ['lose', 'lose_tone', 'recomp'].includes(g);
  const items = [];
  if (!eaten.kcal) return { tone: 'info', items: ['Sin comidas registradas este día: no se puede evaluar. La constancia en el registro es lo que más ayuda.'] };

  // Calorías / balance
  const objDef = plan.deficit; // déficit objetivo (positivo)
  const realDef = -balance;    // déficit real (positivo)
  if (g === 'gain') {
    if (balance > 0) items.push(`✅ Superávit de ${r(balance)} kcal: suficiente para ganar masa (~${kg(balance)} kg potenciales).`);
    else items.push(`⚠️ Quedaste en déficit de ${r(-balance)} kcal: para ganar músculo necesitas comer más que tu gasto.`);
  } else if (cutting) {
    const diff = realDef - objDef;
    if (realDef <= 0) items.push(`⚠️ Sin déficit (superávit de ${r(balance)} kcal): ese día no sumó a bajar; equivale a ~${kg(balance)} kg en contra.`);
    else if (Math.abs(diff) <= 150) items.push(`✅ Déficit real de ${r(realDef)} kcal, en línea con tu objetivo (${r(objDef)}): ~${kg(realDef)} kg de avance.`);
    else if (diff > 150) items.push(`📉 Déficit de ${r(realDef)} kcal, mayor al objetivo (${r(objDef)}): bajas más rápido, pero si se repite aumenta el hambre y el riesgo de perder músculo${g !== 'lose' ? ', justo lo contrario a tonificar' : ''}.`);
    else items.push(`🟡 Déficit de ${r(realDef)} kcal, menor al objetivo (${r(objDef)}): avance más lento (~${kg(realDef)} kg ese día).`);
  } else {
    if (Math.abs(balance) <= 200) items.push(`✅ Balance de ${balance > 0 ? '+' : '−'}${r(Math.abs(balance))} kcal: bien para mantener.`);
    else items.push(`🟡 ${balance > 0 ? 'Superávit' : 'Déficit'} de ${r(Math.abs(balance))} kcal: algo lejos de mantener; compensa los próximos días.`);
  }

  // Proteína (la más importante)
  const pr = eaten.protein_g / Math.max(1, plan.protein_g);
  if (pr < 0.75) {
    const why = cutting
      ? `con déficit y poca proteína, parte del peso que bajes puede ser músculo${g !== 'lose' ? ' (va contra tonificar)' : ''} y te da más hambre`
      : g === 'gain' ? 'limita la ganancia de músculo aunque comas suficientes calorías'
      : 'tu recuperación y saciedad empeoran';
    items.push(`🥩 Proteína baja: ${r(eaten.protein_g)} de ${r(plan.protein_g)} g (${Math.round(pr * 100)}%). Efecto: ${why}.`);
  } else if (pr < 0.9) {
    items.push(`🥩 Proteína cerca (${Math.round(pr * 100)}%): suma una porción más (huevos, yogur protein, atún) para proteger tu músculo.`);
  } else {
    items.push(`✅ Proteína cumplida (${r(eaten.protein_g)} g): protege tu músculo${cutting ? ' mientras bajas' : ''}.`);
  }

  // Carbohidratos y grasas (solo si hay algo relevante)
  const cr = eaten.carbs_g / Math.max(1, plan.carbs_g);
  const fr = eaten.fat_g / Math.max(1, plan.fat_g);
  if (trained && cr < 0.6) items.push(`🍞 Pocos carbohidratos en día de entreno (${Math.round(cr * 100)}%): menos energía y peor recuperación.`);
  else if (cr > 1.25 && balance > -objDef / 2) items.push(`🍞 Carbohidratos altos (${Math.round(cr * 100)}%): fueron la principal causa de quedar sobre la meta.`);
  if (fr > 1.3) items.push(`🥑 Grasas altas (${Math.round(fr * 100)}%): son muy densas en calorías (9 kcal/g); ojo con frituras, aderezos y frutos secos.`);
  else if (fr < 0.6) items.push(`🥑 Grasas muy bajas (${Math.round(fr * 100)}%): si se repite, afecta energía y hormonas; incluye palta, aceite de oliva o frutos secos.`);

  const tone = items.some((x) => x.startsWith('⚠️')) ? 'warn' : items.every((x) => x.startsWith('✅')) ? 'ok' : 'info';
  return { tone, items: items.slice(0, 4) };
}
