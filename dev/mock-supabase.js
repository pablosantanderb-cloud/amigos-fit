// Mock en memoria de supabase-js para probar la UI sin backend (solo desarrollo).
const uid = 'u1';
const today = new Date(); const iso = (d) => d.toISOString().slice(0,10);
const day = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return iso(d); };
const db = {
  profiles: [{ id: uid, display_name: 'Pablo', sex: 'M', age: 40, birth_date: '1986-03-10', track_creatine: true, tutorial_done: true, activity_basis: 'v3', train_mod_sessions: 3, train_mod_minutes: 60, train_int_sessions: 2, train_int_minutes: 90, exercise_credit_pct: 75, calibration_kcal: 0, height_cm: 178, weight_kg: 88, start_weight_kg: 90, target_weight_kg: 82,
    activity_level: 'ligero', goal: 'lose', rate_kg_week: 0.5, weekly_activity_goal_min: 150, bmr: 1798, tdee: 2787, kcal_target: 2237, protein_g: 176, carbs_g: 240, fat_g: 62 }],
  food_logs: [], weight_logs: [], activity_logs: [], daily_energy: [], supplement_logs: [], sync_tokens: [{ user_id: 'u1', token: 'af_demo' }], groups: [{ id: 'g1', name: 'Los del fútbol', invite_code: 'ABC123', created_by: uid }], group_members: [],
};
let id = 1;
for (let i = 0; i < 20; i++) {
  if (i % 4 === 3) continue;
  db.food_logs.push({ id: id++, user_id: uid, log_date: day(-i), meal: 'almuerzo', description: 'Arroz con pollo', kcal: 1200 + (i*37)%500, protein_g: 80 + i, carbs_g: 120, fat_g: 35, created_at: '' });
  db.food_logs.push({ id: id++, user_id: uid, log_date: day(-i), meal: 'desayuno', description: 'Avena con plátano', comment: 'con leche descremada', kcal: 450, protein_g: 20, carbs_g: 70, fat_g: 9, created_at: '' });
  if (i % 3 === 0) db.weight_logs.push({ id: id++, user_id: uid, log_date: day(-i), weight_kg: 88 + i*0.1 });
  if (i % 2 === 0) db.activity_logs.push({ id: id++, user_id: uid, log_date: day(-i), activity: 'Caminar', minutes: 40, kcal_burned: 250 });
  if (i === 0) db.daily_energy.push({ id: id++, user_id: uid, log_date: day(0), live_active_kcal: 1100, live_resting_kcal: 1320, live_at: new Date(Date.now()-25*60000).toISOString() });
  if (i >= 1 && i <= 9) db.daily_energy.push({ id: id++, user_id: uid, log_date: day(-i), total_kcal: 2700, active_kcal: 800, resting_kcal: 1900 });
}
db.weight_logs.sort((a,b)=>a.log_date.localeCompare(b.log_date));
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.one = false; }
  select() { return this; }
  eq(k, v) { this.f.push((r) => String(r[k]) === String(v)); return this; }
  gte(k, v) { this.f.push((r) => r[k] >= v); return this; }
  lte(k, v) { this.f.push((r) => r[k] <= v); return this; }
  lt(k, v) { this.f.push((r) => r[k] < v); return this; }
  order(k, o = {}) { this.ord = [k, o.ascending !== false]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.one = true; return this; }
  insert(r) { this.op = 'insert'; this.row = r; return this; }
  update(r) { this.op = 'update'; this.row = r; return this; }
  upsert(r) { this.op = 'upsert'; this.row = r; return this; }
  delete() { this.op = 'delete'; return this; }
  then(res, rej) {
    const T = db[this.t]; const m = (r) => this.f.every((f) => f(r));
    if (this.op === 'insert') { [].concat(this.row).forEach((r) => T.push({ id: id++, user_id: uid, created_at: new Date().toISOString(), ...r })); return Promise.resolve({ data: null, error: null }).then(res, rej); }
    if (this.op === 'update') { T.filter(m).forEach((r) => Object.assign(r, this.row)); return Promise.resolve({ error: null }).then(res, rej); }
    if (this.op === 'upsert') { [].concat(this.row).forEach((row) => { const e = T.find((r) => r.log_date === row.log_date); e ? Object.assign(e, row) : T.push({ id: id++, ...row }); }); return Promise.resolve({ error: null }).then(res, rej); }
    if (this.op === 'delete') { db[this.t] = T.filter((r) => !m(r)); return Promise.resolve({ error: null }).then(res, rej); }
    let out = T.filter(m);
    if (this.ord) { const [k, asc] = this.ord; out = [...out].sort((a, b) => (asc ? 1 : -1) * String(a[k]).localeCompare(String(b[k]))); }
    if (this.lim) out = out.slice(0, this.lim);
    return Promise.resolve({ data: this.one ? out[0] ?? null : out, error: null }).then(res, rej);
  }
}
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: uid, email: 'demo@example.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}), updateUser: async () => ({}),
    },
    from: (t) => new Q(t),
    rpc: async (fn, a) => {
      if (fn === 'group_leaderboard') return { data: [
        { user_id: uid, display_name: 'Pablo', goal: 'lose', days_in_range: 7, days_logged: 6, kcal_ok_days: 3, protein_ok_days: 2, avg_kcal: 1800, kcal_target: 2237, protein_target: 176, activity_min: 160, activity_goal_min: 150, start_weight: 90, ref_weight: 88.5, current_weight: 88, score: 71 },
        { user_id: 'u2', display_name: 'Camila', goal: 'gain', days_in_range: 7, days_logged: 7, kcal_ok_days: 5, protein_ok_days: 6, avg_kcal: 2300, kcal_target: 2350, protein_target: 110, activity_min: 240, activity_goal_min: 180, start_weight: 58, ref_weight: 58.4, current_weight: 59.1, score: 88 },
        { user_id: 'u3', display_name: 'Rodrigo', goal: 'maintain', days_in_range: 7, days_logged: 3, kcal_ok_days: 1, protein_ok_days: 1, avg_kcal: 2600, kcal_target: 2700, protein_target: 130, activity_min: 60, activity_goal_min: 150, start_weight: 80, ref_weight: 80, current_weight: 80.4, score: 34 },
      ], error: null };
      if (fn === 'group_weight_series') return { data: [0,7,14,21].flatMap((n,i)=>[
        { user_id: uid, display_name: 'Pablo', log_date: day(-21+n), pct_change: -0.6*i },
        { user_id: 'u2', display_name: 'Camila', log_date: day(-21+n), pct_change: 0.5*i }]), error: null };
      if (fn === 'group_daily_macros') { const out=[]; const ppl=[[uid,'Pablo',2133,151,250,59],['u2','Luchin',1846,138,209,51],['u3','El kacho',2044,120,290,45]]; for (let i=6;i>=0;i--) ppl.forEach(([u,n,k,p,c,f],j)=>{ if ((i+j)%4===3) return; const r=0.7+((i*7+j*13)%9)/12; out.push({user_id:u,display_name:n,log_date:day(-i),kcal:Math.round(k*r),protein:Math.round(p*(r-0.05)),carbs:Math.round(c*(r+0.1)),fat:Math.round(f*(r+0.15)),kcal_target:k,protein_target:p,carbs_target:c,fat_target:f}); }); return { data: out, error: null }; }
      if (fn === 'group_macros') return { data: [
        { user_id: uid, display_name: 'Pablo', days_logged: 6, avg_kcal: 2050, avg_protein: 120, avg_carbs: 260, avg_fat: 72, kcal_target: 2133, protein_target: 151, carbs_target: 250, fat_target: 59 },
        { user_id: 'u2', display_name: 'Luchin', days_logged: 7, avg_kcal: 1800, avg_protein: 140, avg_carbs: 190, avg_fat: 50, kcal_target: 1846, protein_target: 138, carbs_target: 209, fat_target: 51 },
        { user_id: 'u3', display_name: 'El kacho', days_logged: 3, avg_kcal: 2500, avg_protein: 85, avg_carbs: 330, avg_fat: 75, kcal_target: 2044, protein_target: 120, carbs_target: 290, fat_target: 45 },
      ], error: null };
      if (fn === 'create_group' || fn === 'join_group') return { data: db.groups[0], error: null };
    },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), upload: async () => ({ error: null }), remove: async () => ({}) }) },
    functions: { invoke: async (_n, { body }) => (body.mode === 'activity' ? { data: { notes: 'Leí 2 sesiones.', day_totals: [{ date: day(0), total_kcal: 2810, active_kcal: 760, resting_kcal: 2050 }], activities: [
      { date: day(-1), activity: 'Caminata', minutes: 42, kcal_active: 210, kcal_total: 260, steps: 5400, distance_km: 3.8 },
      { date: day(-3), activity: 'Fuerza', minutes: 50, kcal_active: 320, kcal_total: 0, steps: 0, distance_km: 0 }] }, error: null } : { data: { description: 'Porotos con riendas', confidence: 'media', notes: 'Asumí 1 plato hondo (~350 g).',
      items: [{ name: 'Porotos con riendas', quantity: '1 plato (350 g)', grams: 350, kcal: 420, protein_g: 21, carbs_g: 68, fat_g: 7 },
              { name: 'Ensalada chilena', quantity: '1/2 taza', grams: 100, kcal: 60, protein_g: 1, carbs_g: 5, fat_g: 4.5 }] }, error: null }) },
  };
}
