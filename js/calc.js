// Cálculos nutricionales puros (sin dependencias, testeables con Node).

export const ACTIVITY_LEVELS = {
  sedentario: { factor: 1.2,   label: 'Sedentario (poco o nada de ejercicio)' },
  ligero:     { factor: 1.375, label: 'Ligero (ejercicio 1–3 días/semana)' },
  moderado:   { factor: 1.55,  label: 'Moderado (ejercicio 3–5 días/semana)' },
  activo:     { factor: 1.725, label: 'Activo (ejercicio 6–7 días/semana)' },
  muy_activo: { factor: 1.9,   label: 'Muy activo (trabajo físico o doble sesión)' },
};

export const GOALS = {
  lose:     'Bajar de peso / grasa',
  maintain: 'Mantener peso',
  gain:     'Aumentar masa muscular',
};

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
 * Meta diaria de calorías y macros.
 * - Bajar: déficit = ritmo (kg/sem) × 7700 / 7, acotado a 300–1000 kcal y nunca bajo el TMB
 *   ni bajo 1200 (mujer) / 1500 (hombre) kcal.
 * - Subir: superávit = ritmo × 7700 / 7, acotado a 150–500 kcal.
 * - Proteína: 2,0 g/kg (bajar), 1,8 g/kg (subir), 1,6 g/kg (mantener).
 * - Grasa: 25% de las kcal (mín. 0,6 g/kg). Carbohidratos: el resto.
 */
export function targets(p) {
  const B = bmr(p);
  const T = tdee(p);
  const rate = Math.max(0, Number(p.rate_kg_week) || 0);
  let adjust = 0;
  let warning = null;

  if (p.goal === 'lose') {
    adjust = -Math.min(1000, Math.max(300, (rate * KCAL_PER_KG) / 7));
  } else if (p.goal === 'gain') {
    adjust = Math.min(500, Math.max(150, (rate * KCAL_PER_KG) / 7));
  }

  let kcal = Math.round(T + adjust);
  const floor = Math.max(B, p.sex === 'M' ? 1500 : 1200);
  if (p.goal === 'lose' && kcal < floor) {
    kcal = Math.round(floor);
    warning = `Ajustamos la meta a ${kcal} kcal para no bajar de tu metabolismo basal / mínimo saludable. El ritmo real será más lento.`;
  }

  const proteinPerKg = p.goal === 'lose' ? 2.0 : p.goal === 'gain' ? 1.8 : 1.6;
  const protein_g = Math.round(proteinPerKg * p.weight_kg);
  const fat_g = Math.round(Math.max(0.6 * p.weight_kg, (kcal * 0.25) / 9));
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
