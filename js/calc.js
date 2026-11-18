// Cálculos nutricionales puros (sin dependencias, testeables con Node).

export const ACTIVITY_LEVELS = {
  sedentario: { factor: 1.2,   label: 'Sedentario (poco o nada de ejercicio)' },
  ligero:     { factor: 1.375, label: 'Ligero (ejercicio 1–3 días/semana)' },
  moderado:   { factor: 1.55,  label: 'Moderado (ejercicio 3–5 días/semana)' },
  activo:     { factor: 1.725, label: 'Activo (ejercicio 6–7 días/semana)' },
  muy_activo: { factor: 1.9,   label: 'Muy activo (trabajo físico o doble sesión)' },
};

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

/** Gasto energético total diario */
export function tdee(p) {
  const f = ACTIVITY_LEVELS[p.activity_level]?.factor ?? 1.2;
  return Math.round(bmr(p) * f);
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
