import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import * as C from './calc.js?v=13';

// ---------------------------------------------------------------- utilidades
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const nav = $('#nav');
const topbar = $('#topbar');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const fmt = (n) => r0(n).toLocaleString('es-CL');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const BASE_URL = location.origin + location.pathname;
const num = C.parseNum;
const dec = (v) => (v == null || v === '' ? '' : String(v).replace('.', ','));
// Campo numérico que acepta coma o punto (type=text evita que iOS bloquee la coma)
const decInput = (name, value, extra = '') =>
  `<input name="${name}" type="text" inputmode="decimal" autocomplete="off" pattern="[0-9]+([.,][0-9]+)?" value="${esc(dec(value))}" ${extra}>`;
const GOAL_SHORT = { lose: 'bajar de peso', lose_tone: 'bajar y tonificar', recomp: 'tonificar', maintain: 'mantener', fitness: 'condición física', gain: 'ganar músculo' };

// Fecha de nacimiento con 3 selectores (día / mes / año): cómodo en iPhone y no se sale del recuadro
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function birthPicker(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  const maxY = new Date().getFullYear() - 12;
  const sel = (name, ph, opts, val) => `<select name="${name}" required><option value="">${ph}</option>${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<label>Fecha de nacimiento <span id="ageTxt" class="muted"></span></label>
    <div class="birth">
      ${sel('b_d', 'Día', Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]), d)}
      ${sel('b_m', 'Mes', MONTHS.map((n, i) => [i + 1, n]), m)}
      ${sel('b_y', 'Año', Array.from({ length: maxY - 1920 + 1 }, (_, i) => [maxY - i, maxY - i]), y)}
    </div>`;
}
function readBirth(form) {
  const d = +form.b_d.value, m = +form.b_m.value, y = +form.b_y.value;
  if (!d || !m || !y) return '';
  const last = new Date(y, m, 0).getDate();
  const z = (n) => String(n).padStart(2, '0');
  return `${y}-${z(m)}-${z(Math.min(d, last))}`;
}

// Explica de dónde sale el gasto promedio (fórmula y/o lo aprendido del reloj)
function learnTxt(p) {
  const fac = String(C.ACTIVITY_LEVELS[p.activity_level]?.factor ?? 1.2).replace('.', ',');
  const formula = `metabolismo basal ${fmt(C.bmr(p))} × ${fac} (actividad diaria) = ${fmt(C.baseNoTraining(p))} en un día sin entreno, + ${fmt(C.avgTrainingKcal(p))}/día de entrenos habituales = ${fmt(C.formulaTdee(p))}`;
  const n = Number(p.learned_days) || 0;
  const w = C.learnedWeight(p);
  if (w >= 1) return `🧠 Gasto promedio aprendido de tu reloj: ${fmt(p.learned_tdee)} kcal/día (${n} días registrados en las últimas 4 semanas). Se actualiza solo cada día.`;
  if (w > 0) return `🧠 Gasto promedio = ${Math.round(w * 100)}% lo aprendido de tu reloj (${fmt(p.learned_tdee)}, ${n} días) + ${Math.round((1 - w) * 100)}% fórmula (${formula}). Con ${C.LEARN_FULL_DAYS} días usará solo tu reloj.`;
  return `Gasto promedio: ${formula}. Ingresa el gasto total de tu reloj cada día: con ${C.LEARN_MIN_DAYS} días la meta empieza a ajustarse sola (llevas ${n}).`;
}

// Llama a la función de IA y devuelve el JSON (o lanza un error legible)
async function callAI(body) {
  const t0 = Date.now();
  const { data, error } = await sb.functions.invoke('analyze-food', { body });
  if (error) {
    let msg = error.name === 'FunctionsFetchError'
      ? `No hubo respuesta del servidor tras ${Math.round((Date.now() - t0) / 1000)} s (revisa tu conexión o intenta de nuevo).`
      : error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Selector de foto: un solo botón. Sin "capture", el teléfono ofrece Cámara, Fototeca o Archivos.
const photoPicker = (id, title, sub) => `
  <div class="photo-drop" id="${id}-drop">
    <div id="${id}-ph"><div style="font-size:2.2rem">📷</div><div><b>${title}</b></div><div class="small">${sub}</div></div>
  </div>
  <label class="btn ghost block" style="margin:8px 0 0">📷 Cargar foto<input id="${id}-gal" type="file" accept="image/*" class="vh"></label>`;
function bindPhotoPicker(id, onPick, max) {
  const handler = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const img = await resizeImage(file, max);
      $(`#${id}-ph`).innerHTML = `<img src="${img.dataUrl}" alt="foto">`;
      onPick(img);
    } catch (e) { toast(e.message, true); }
  };
  $(`#${id}-gal`).onchange = handler;
  $(`#${id}-drop`).onclick = () => $(`#${id}-gal`).click();
}

const MEALS = { desayuno: 'Desayuno', almuerzo: 'Almuerzo', once: 'Once', cena: 'Cena', snack: 'Snack' };
// Registros antiguos ("colación" / "otros") se muestran como Snack
const mealKey = (m) => (m === 'colacion' || m === 'otro' ? 'snack' : m);
const COLORS = { kcal: '#199407', prot: '#2563eb', carb: '#d97706', fat: '#db2777', target: '#6b7280' };
const PALETTE = ['#199407', '#2563eb', '#db2777', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#c026d3', '#0f766e'];

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), isError ? 5000 : 2500);
}

function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn._label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${label || ''}`; }
  else { btn.disabled = false; btn.innerHTML = btn._label ?? btn.innerHTML; }
}

function prettyDate(iso) {
  const today = C.isoDate();
  const [y, m, d] = iso.split('-').map(Number);
  const raw = new Date(y, m - 1, d).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'short' });
  const txt = raw.charAt(0).toUpperCase() + raw.slice(1);
  if (iso === today) return `${txt} (hoy)`;
  if (iso === C.addDays(today, -1)) return `${txt} (ayer)`;
  return txt;
}
const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

function defaultMeal() {
  const h = new Date().getHours();
  if (h < 11) return 'desayuno';
  if (h < 15) return 'almuerzo';
  if (h < 17) return 'snack';
  if (h < 20) return 'once';
  return 'cena';
}

// Charts: se destruyen al cambiar de vista
let charts = [];
function chart(canvas, config) {
  if (!window.Chart) return null;
  const c = new window.Chart(canvas, config);
  charts.push(c);
  return c;
}
function clearCharts() { charts.forEach((c) => c.destroy()); charts = []; }
const gridColor = () => (matchMedia('(prefers-color-scheme: dark)').matches ? '#263040' : '#eef0f3');
const tickColor = () => (matchMedia('(prefers-color-scheme: dark)').matches ? '#9ca3af' : '#6b7280');

// ---------------------------------------------------------------- estado
let sb = null;
let session = null;
let profile = null;
let recoveryMode = false;
const state = { date: C.isoDate(), range: 30, groupId: localStorage.getItem('af_group') || null, groupRange: 7 };

// ---------------------------------------------------------------- arranque
async function init() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    app.innerHTML = `<div class="auth-wrap card"><h2>Falta configuración</h2>
      <p>Completa <code>js/config.js</code> con la URL y la anon key de tu proyecto Supabase (ver README).</p></div>`;
    return;
  }

  // Errores que vienen en el link del correo (ej. link expirado)
  const hashParams = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const linkError = hashParams.get('error_description');
  if (location.hash.includes('type=recovery')) recoveryMode = true;

  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, detectSessionInUrl: true } });

  sb.auth.onAuthStateChange((event, s) => {
    session = s;
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; route(); }
    if (event === 'SIGNED_OUT') { profile = null; route(); }
  });

  const { data } = await sb.auth.getSession();
  session = data.session;
  if (linkError) { history.replaceState(null, '', BASE_URL + '#/login'); setTimeout(() => toast(linkError.replace(/\+/g, ' '), true), 300); }
  else if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', BASE_URL + '#/hoy');

  window.addEventListener('hashchange', route);
  route();
}

async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error) throw error;
  profile = data;
  if (!profile?.kcal_target) return profile;
  const upd = {};
  // Si cumplió años desde el último cálculo, recalcula
  const age = C.ageFromBirth(profile.birth_date);
  if (age && age !== profile.age) upd.age = age;
  // Aprende el gasto promedio real de los cierres del reloj (últimos 28 días), una vez al día
  if (profile.learned_at !== C.isoDate()) {
    const { data: wd } = await sb.from('daily_energy').select('total_kcal,active_kcal,resting_kcal')
      .gte('log_date', C.addDays(C.isoDate(), -28)).lt('log_date', C.isoDate());
    const L = C.learnFromWatch({ ...profile, ...upd }, wd || []);
    upd.learned_at = C.isoDate();
    if (L.days !== (profile.learned_days || 0) || (L.avg && L.avg !== profile.learned_tdee)) {
      upd.learned_days = L.days;
      if (L.avg) upd.learned_tdee = L.avg;
    }
  }
  if (Object.keys(upd).length) {
    const next = { ...profile, ...upd };
    const t = C.targets(next);
    Object.assign(upd, { bmr: t.bmr, tdee: t.tdee, kcal_target: t.kcal_target, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g });
    const before = profile.kcal_target;
    const { error: e2 } = await sb.from('profiles').update(upd).eq('id', session.user.id);
    if (!e2) {
      Object.assign(profile, upd);
      if (Math.abs(t.kcal_target - before) >= 20 && C.learnedWeight(profile) > 0) {
        setTimeout(() => toast(`🧠 Tu meta se ajustó a ${fmt(t.kcal_target)} kcal según tus últimos ${profile.learned_days} días del reloj`), 600);
      }
    }
  }
  return profile;
}

const profileComplete = () => profile && profile.kcal_target && profile.weight_kg && profile.birth_date && profile.activity_basis === 'v3';

async function route() {
  clearCharts();
  const name = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'hoy');

  topbar.classList.toggle('hidden', !session || recoveryMode);
  if (recoveryMode && session) return viewNewPassword();
  if (!session) { nav.classList.add('hidden'); return viewAuth(['registro', 'recuperar'].includes(name) ? name : 'login'); }

  try { if (!profile) await loadProfile(); }
  catch (e) { app.innerHTML = `<div class="card err">Error cargando perfil: ${esc(e.message)}</div>`; return; }

  if (profile && !profile.tutorial_done && !tutorialOpen) showTutorial(true);
  if (!profileComplete() && name !== 'perfil') { location.hash = '#/perfil'; return; }

  nav.classList.toggle('hidden', !profileComplete());
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));

  const views = { hoy: viewToday, registrar: viewRegister, progreso: viewProgress, amigos: viewFriends, perfil: viewProfile };
  const v = views[name] || viewToday;
  app.innerHTML = '<div class="loading">Cargando…</div>';
  try { await v(); window.scrollTo(0, 0); }
  catch (e) { console.error(e); app.innerHTML = `<div class="card err">Ocurrió un error: ${esc(e.message)}</div>`; }
}

// ---------------------------------------------------------------- TUTORIAL
const TUTORIAL = [
  { icon: '👋', title: 'Bienvenido/a a Amigos Fit', text: 'Registra lo que comes y entrenas, sigue tu progreso y compárate con tus amigos. Te mostramos lo principal en 1 minuto.' },
  { icon: '🎯', title: 'Tu meta diaria', text: 'Con tus datos del <b>Perfil</b> calculamos cuántas calorías y proteínas, carbohidratos y grasas te tocan cada día para tu objetivo.' },
  { icon: '📷', title: 'Registra tus comidas', text: 'En <b>Registrar</b> sube una foto del plato o escribe lo que comiste (ej: “2 huevos duros”). La IA calcula calorías y macros, y puedes corregirlos antes de guardar.' },
  { icon: '🏃', title: 'Entrenamientos', text: 'En <b>Hoy → ➕ Agregar entrenamiento</b>, a mano o con un pantallazo de tu reloj. Si entrenas, tu meta del día sube para mantener tu déficit.' },
  { icon: '💡', title: 'Tu coach', text: 'Bajo tus macros verás sugerencias breves: qué comer en lo que queda del día o qué ejercicio hacer si te pasaste. En días pasados te dice cómo te fue.' },
  { icon: '⌚', title: 'Cierre del día con tu reloj', text: 'Al día siguiente ingresa el <b>gasto total</b> de tu reloj (energía activa + en reposo). Así ves tu déficit real, y con 7 días tu meta aprende de tu gasto verdadero.' },
  { icon: '👥', title: 'Compite con amigos', text: 'En <b>Amigos</b> crea un grupo y comparte el código. El ranking premia la constancia y cumplir tus metas, no solo los kilos. Tus fotos y comidas son privadas.' },
  { icon: '🚀', title: '¡Listo!', text: 'Empieza completando tu perfil y registrando tu próxima comida. Puedes volver a ver este tutorial cuando quieras desde <b>Perfil</b>.' },
];
let tutorialOpen = false;

function showTutorial(firstTime) {
  if (tutorialOpen) return;
  tutorialOpen = true;
  let i = 0;
  const el = document.createElement('div');
  el.className = 'tut';
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
  const close = async () => {
    el.remove(); document.body.style.overflow = ''; tutorialOpen = false;
    if (firstTime && profile && !profile.tutorial_done) {
      profile.tutorial_done = true;
      await sb.from('profiles').update({ tutorial_done: true }).eq('id', session.user.id);
    }
  };
  const render = () => {
    const sl = TUTORIAL[i];
    const last = i === TUTORIAL.length - 1;
    el.innerHTML = `<div class="tut-card" role="dialog" aria-modal="true">
      ${firstTime ? '' : '<button class="tut-x" aria-label="Cerrar">✕</button>'}
      <div class="tut-icon">${sl.icon}</div>
      <h2>${sl.title}</h2>
      <p>${sl.text}</p>
      <div class="tut-dots">${TUTORIAL.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tut-nav">
        <button class="btn ghost" data-t="prev" ${i === 0 ? 'style="visibility:hidden"' : ''}>Atrás</button>
        <button class="btn" data-t="next">${last ? (firstTime ? '¡Empezar!' : 'Cerrar') : 'Siguiente'}</button>
      </div></div>`;
    el.querySelector('[data-t=prev]').onclick = () => { if (i > 0) { i--; render(); } };
    el.querySelector('[data-t=next]').onclick = () => { if (last) close(); else { i++; render(); } };
    const x = el.querySelector('.tut-x'); if (x) x.onclick = close;
  };
  // deslizar con el dedo
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (dx < -50 && i < TUTORIAL.length - 1) { i++; render(); } else if (dx > 50 && i > 0) { i--; render(); }
  });
  render();
}

// Botón "ojito" para mostrar/ocultar contraseñas
function addEyes(root = document) {
  root.querySelectorAll('input[type=password]').forEach((inp) => {
    if (inp.parentElement.classList.contains('pw')) return;
    const wrap = document.createElement('div');
    wrap.className = 'pw';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pw-eye';
    b.setAttribute('aria-label', 'Mostrar contraseña');
    b.textContent = '👁️';
    b.addEventListener('mousedown', (e) => e.preventDefault()); // no quitar el foco del campo
    b.onclick = () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.textContent = show ? '🙈' : '👁️';
      b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    };
    wrap.appendChild(b);
  });
}

// ---------------------------------------------------------------- AUTH
function viewAuth(mode) {
  const titles = { login: 'Iniciar sesión', registro: 'Crear cuenta', recuperar: 'Recuperar contraseña' };
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="brand"><img class="brand-logo" src="img/logo.png?v=4" alt="Amigos Fit">
      <p class="muted">Entrena, aliméntate y progresa junto a tus amigos.</p></div>
    <div class="card">
      ${mode !== 'recuperar' ? `<div class="tabs">
        <button data-m="login" class="${mode === 'login' ? 'active' : ''}">Ingresar</button>
        <button data-m="registro" class="${mode === 'registro' ? 'active' : ''}">Crear cuenta</button></div>` : `<h2>${titles[mode]}</h2>
        <p class="muted small">Te enviaremos un correo con un enlace para crear una nueva contraseña.</p>`}
      <form id="f">
        ${mode === 'registro' ? `<label>Nombre (lo verán tus amigos)</label><input name="name" required maxlength="40" autocomplete="name">` : ''}
        <label>Correo</label><input name="email" type="email" required autocomplete="email">
        ${mode !== 'recuperar' ? `<label>Contraseña</label>
          <input name="password" type="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">` : ''}
        <p id="msg" class="small"></p>
        <button class="btn block" type="submit">${mode === 'login' ? 'Ingresar' : mode === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}</button>
      </form>
      <p class="small" style="text-align:center;margin-top:14px">
        ${mode === 'login' ? `<a href="#/recuperar">¿Olvidaste tu contraseña?</a>` : mode === 'recuperar' ? `<a href="#/login">Volver a ingresar</a>` : ''}
      </p>
    </div>
  </div>`;

  addEyes(app);
  $$('.tabs button').forEach((b) => (b.onclick = () => { location.hash = '#/' + b.dataset.m; }));
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const btn = ev.target.querySelector('button[type=submit]');
    const msg = $('#msg');
    msg.className = 'small'; msg.textContent = '';
    busy(btn, true);
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw error;
        profile = null; location.hash = '#/hoy'; route();
      } else if (mode === 'registro') {
        const { data, error } = await sb.auth.signUp({
          email: f.email, password: f.password,
          options: { data: { display_name: f.name.trim() }, emailRedirectTo: BASE_URL },
        });
        if (error) throw error;
        if (data.session) { profile = null; location.hash = '#/perfil'; route(); }
        else { msg.textContent = '✅ Revisa tu correo y confirma tu cuenta para poder ingresar.'; }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(f.email, { redirectTo: BASE_URL });
        if (error) throw error;
        msg.textContent = '✅ Si el correo está registrado, te llegará un enlace para restablecer la contraseña.';
      }
    } catch (e) {
      msg.className = 'err';
      msg.textContent = translateAuthError(e.message);
    } finally { busy(btn, false); }
  };
}

function translateAuthError(m = '') {
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Debes confirmar tu correo antes de ingresar (revisa tu bandeja y spam).';
  if (/already registered/i.test(m)) return 'Ese correo ya tiene una cuenta. Intenta ingresar o recuperar la contraseña.';
  if (/Password should be/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit/i.test(m)) return 'Demasiados intentos o correos enviados. Espera unos minutos.';
  return m;
}

function viewNewPassword() {
  nav.classList.add('hidden');
  app.innerHTML = `<div class="auth-wrap"><div class="brand"><img class="brand-logo sm" src="img/logo.png?v=4" alt="Amigos Fit"><h1>Nueva contraseña</h1></div>
    <div class="card"><form id="f">
      <label>Nueva contraseña</label><input name="p1" type="password" minlength="6" required autocomplete="new-password">
      <label>Repetir contraseña</label><input name="p2" type="password" minlength="6" required autocomplete="new-password">
      <p id="msg" class="err"></p>
      <button class="btn block">Guardar contraseña</button></form></div></div>`;
  addEyes(app);
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const { p1, p2 } = Object.fromEntries(new FormData(ev.target));
    if (p1 !== p2) { $('#msg').textContent = 'Las contraseñas no coinciden.'; return; }
    const btn = ev.target.querySelector('button'); busy(btn, true);
    const { error } = await sb.auth.updateUser({ password: p1 });
    busy(btn, false);
    if (error) { $('#msg').textContent = translateAuthError(error.message); return; }
    recoveryMode = false;
    toast('Contraseña actualizada ✅');
    location.hash = '#/hoy'; route();
  };
}

// ---------------------------------------------------------------- PERFIL / ONBOARDING
async function viewProfile() {
  const p = profile || {};
  const first = !profileComplete();
  const opt = (obj, val) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(v.label ?? v)}</option>`).join('');
  app.innerHTML = `
  <h1>${first ? (p.kcal_target ? 'Actualiza tu perfil' : '¡Bienvenido/a! 👋') : 'Mi perfil'}</h1>
  ${first ? `<p class="muted">${p.kcal_target ? 'Mejoramos cómo se calcula tu meta. Indica tu <b>actividad diaria (sin entrenos)</b> y tus <b>entrenamientos habituales</b>, y guarda.' : 'Completa tus datos para calcular tu plan personalizado.'}</p>` : ''}
  <form id="f" class="card">
    <label>Nombre</label><input name="display_name" required maxlength="40" value="${esc(p.display_name)}">
    <label>Sexo</label><select name="sex" required><option value="">—</option>
      <option value="M" ${p.sex === 'M' ? 'selected' : ''}>Hombre</option><option value="F" ${p.sex === 'F' ? 'selected' : ''}>Mujer</option></select>
    ${birthPicker(p.birth_date)}
    <div class="grid2">
      <div><label>Peso actual (kg)</label>${decInput('weight_kg', p.weight_kg, 'required placeholder="Ej: 78,5"')}</div>
      <div><label>Estatura (cm)</label>${decInput('height_cm', p.height_cm, 'required placeholder="Ej: 172"')}</div>
    </div>
    <div class="noexercise">
      <label style="margin-top:0">🚶 Actividad de tu día a día</label>
      <div class="flag">⚠️ SIN contar entrenamientos: solo trabajo, casa, traslados y pasos normales</div>
      <select name="activity_level" required>${opt(C.ACTIVITY_LEVELS, C.ACTIVITY_LEVELS[p.activity_level] && p.activity_basis ? p.activity_level : 'sedentario')}</select>
    </div>
    <label>🏋️ Entrenamientos habituales</label>
    ${['mod', 'int'].map((k) => {
      const tt = C.TRAINING_TYPES[k];
      const cur = C.trainingPlan(p)[k];
      return `<div class="trainrow ${k}">
        <div class="tr-h"><b>${k === 'mod' ? '💪' : '🔥'} ${tt.label}</b><span class="small muted">${tt.ej}</span></div>
        <div class="grid2">
          <div><span class="small muted">Veces por semana</span>
            <select name="train_${k}_sessions">${[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${cur.n === n ? 'selected' : ''}>${n === 0 ? 'Ninguna' : `${n} ${n === 1 ? 'vez' : 'veces'}`}</option>`).join('')}</select></div>
          <div><span class="small muted">Minutos <b>por sesión</b></span>
            <select name="train_${k}_minutes">${[20, 30, 45, 60, 75, 90, 120].map((m) => `<option value="${m}" ${cur.min === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></div>
        </div>
        <div class="small tr-total" id="tot_${k}"></div></div>`;
    }).join('')}
    <p class="small muted">Tu meta considera el promedio de estos entrenos. Cada día se ajusta con lo que realmente entrenes.</p>
    <label>Objetivo</label>
    <select name="goal" required>${opt(C.GOALS, p.goal || 'lose')}</select>
    <div class="grid2" id="rateRow">
      <div><label>Ritmo (kg/semana)</label>
        <select name="rate_kg_week">${[0.25, 0.5, 0.75, 1].map((r) => `<option value="${r}" ${Number(p.rate_kg_week ?? 0.5) === r ? 'selected' : ''}>${String(r).replace('.', ',')} kg</option>`).join('')}</select></div>
      <div><label>Peso meta (opcional)</label>${decInput('target_weight_kg', p.target_weight_kg, 'placeholder="Ej: 72,5"')}</div>
    </div>
    <div class="grid2">
      <div><label>Meta semanal de ejercicio (min)</label>
        <input name="weekly_activity_goal_min" type="text" inputmode="numeric" pattern="[0-9]+" value="${p.weekly_activity_goal_min ?? 150}"></div>
      <div><label>kcal del reloj que se consideran</label>
        <select name="exercise_credit_pct">${[[50, '50%'], [75, '75% (recom.)'], [100, '100%']].map(([v, l]) => `<option value="${v}" ${(p.exercise_credit_pct ?? C.DEFAULT_CREDIT) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    ${p.calibration_kcal ? `<p class="small">⚖️ Ajuste por calibración con tu balanza: <b>${p.calibration_kcal > 0 ? '+' : ''}${fmt(p.calibration_kcal)} kcal/día</b> en tu gasto base. <a href="#" id="resetCal">Quitar ajuste</a></p>` : ''}
    <div id="calc" class="calc-box"></div>
    <button class="btn block" style="margin-top:14px">${first ? 'Calcular y comenzar' : 'Guardar cambios'}</button>
  </form>
  ${first ? '' : `
  <div class="card">
    <h2>Cuenta</h2>
    <p class="muted small">${esc(session.user.email)}</p>
    <form id="pw" class="row" style="margin-top:8px">
      <input name="p" type="password" minlength="6" placeholder="Nueva contraseña" autocomplete="new-password" required>
      <button class="btn ghost">Cambiar</button>
    </form>
    <button id="tutorialBtn" class="btn ghost block" style="margin-top:12px">🎓 Ver tutorial de la app</button>
    <button id="logout" class="btn danger block" style="margin-top:12px">Cerrar sesión</button>
  </div>
  <p class="small muted">Las calorías y macros son estimaciones generales y no reemplazan la evaluación de un/a nutricionista o médico.</p>`}`;

  addEyes(app);
  const form = $('#f');
  const read = () => {
    const f = Object.fromEntries(new FormData(form));
    f.birth_date = readBirth(form);
    return { ...f, train_mod_sessions: +f.train_mod_sessions, train_mod_minutes: +f.train_mod_minutes, train_int_sessions: +f.train_int_sessions, train_int_minutes: +f.train_int_minutes, age: C.ageFromBirth(f.birth_date), weight_kg: num(f.weight_kg), height_cm: num(f.height_cm), rate_kg_week: C.usesRate(f.goal) ? +f.rate_kg_week : 0,
      exercise_credit_pct: +f.exercise_credit_pct, calibration_kcal: p.calibration_kcal || 0,
      learned_tdee: p.learned_tdee, learned_days: p.learned_days || 0 };
  };
  const valid = (f) => f.sex && f.age >= 12 && f.age <= 100 && f.weight_kg >= 30 && f.weight_kg <= 300 && f.height_cm >= 100 && f.height_cm <= 250;
  const update = () => {
    const f = read();
    $('#rateRow').querySelector('div').style.display = C.usesRate(f.goal) ? '' : 'none';
    $('#ageTxt').textContent = f.age ? `· ${f.age} años` : '';
    ['mod', 'int'].forEach((k) => {
      const n = f[`train_${k}_sessions`], m = f[`train_${k}_minutes`];
      const tot = n * m;
      const h = tot >= 60 ? `${dec(r1(tot / 60))} h` : `${tot} min`;
      const kcal = Math.round(tot * C.kcalPerMinAt(f, C.TRAINING_TYPES[k].met));
      $(`#tot_${k}`).textContent = n ? `= ${n} × ${m} min = ${h} a la semana (~${fmt(kcal)} kcal/semana)` : 'Sin entrenos de este tipo.';
    });
    if (!valid(f)) { $('#calc').innerHTML = '<span class="muted small">Completa sexo, fecha de nacimiento, peso (30–300 kg) y estatura (100–250 cm) para ver tu plan.</span>'; return; }
    const t = C.targets(f);
    const adj = t.adjust === 0 ? 'Sin ajuste (mantención)' : t.adjust < 0 ? `Déficit de ${fmt(-t.adjust)} kcal/día (≈ ${String(Math.abs(t.weeklyChangeKg)).replace('.', ',')} kg/semana)` : `Superávit de ${fmt(t.adjust)} kcal/día`;
    $('#calc').innerHTML = `
      <div class="grid3">
        <div><div class="v">${fmt(t.bmr)}</div><div class="small muted">Metabolismo basal</div></div>
        <div><div class="v">${fmt(t.tdee)}</div><div class="small muted">Gasto promedio</div></div>
        <div><div class="v" style="color:var(--accent)">${fmt(t.kcal_target)}</div><div class="small muted">Meta diaria</div></div>
      </div>
      <p class="small" style="text-align:center">${adj}<br><span class="muted">${learnTxt(f)}</span></p>
      <details class="small muted"><summary>¿Qué significa cada número?</summary>
        <p><b>Metabolismo basal:</b> lo que tu cuerpo gasta en reposo total, solo para mantenerse vivo (respirar, corazón, temperatura). Se calcula con tu sexo, edad, peso y estatura (fórmula Mifflin-St Jeor).</p>
        <p><b>Gasto promedio:</b> metabolismo basal + tu actividad diaria + tus entrenos habituales, promediado por día.</p>
        <p><b>Meta diaria:</b> gasto promedio menos el déficit para tu objetivo. Cada día se ajusta según si entrenaste o no.</p>
      </details>
      <div class="grid3">
        <div><div class="v" style="color:var(--prot)">${t.protein_g} g</div><div class="small muted">Proteínas</div></div>
        <div><div class="v" style="color:var(--carb)">${t.carbs_g} g</div><div class="small muted">Carbohidratos</div></div>
        <div><div class="v" style="color:var(--fat)">${t.fat_g} g</div><div class="small muted">Grasas</div></div>
      </div>
      ${t.warning ? `<p class="warn">⚠️ ${esc(t.warning)}</p>` : ''}`;
  };
  form.oninput = update; update();

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = read();
    if (!valid(f)) return toast('Revisa fecha de nacimiento, peso y estatura', true);
    const t = C.targets(f);
    const btn = form.querySelector('button'); busy(btn, true, 'Guardando…');
    const row = {
      display_name: f.display_name.trim(), sex: f.sex, age: f.age, birth_date: f.birth_date, weight_kg: f.weight_kg, height_cm: f.height_cm,
      activity_level: f.activity_level, goal: f.goal, rate_kg_week: f.rate_kg_week,
      target_weight_kg: num(f.target_weight_kg) || null,
      weekly_activity_goal_min: parseInt(f.weekly_activity_goal_min, 10) || 0,
      exercise_credit_pct: f.exercise_credit_pct, activity_basis: 'v3',
      train_mod_sessions: f.train_mod_sessions, train_mod_minutes: f.train_mod_minutes, train_int_sessions: f.train_int_sessions, train_int_minutes: f.train_int_minutes,
      start_weight_kg: p.start_weight_kg ?? f.weight_kg,
      bmr: t.bmr, tdee: t.tdee, kcal_target: t.kcal_target, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('profiles').update(row).eq('id', session.user.id);
    if (!error && Number(p.weight_kg) !== f.weight_kg) {
      await sb.from('weight_logs').upsert({ user_id: session.user.id, log_date: C.isoDate(), weight_kg: f.weight_kg }, { onConflict: 'user_id,log_date' });
    }
    busy(btn, false);
    if (error) return toast(error.message, true);
    profile = { ...p, ...row };
    toast('Plan guardado ✅');
    location.hash = '#/hoy';
  };

  if ($('#resetCal')) $('#resetCal').onclick = async (ev) => {
    ev.preventDefault();
    const t = C.targets({ ...p, calibration_kcal: 0 });
    const upd = { calibration_kcal: 0, tdee: t.tdee, kcal_target: t.kcal_target, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g };
    const { error } = await sb.from('profiles').update(upd).eq('id', session.user.id);
    if (error) return toast(error.message, true);
    Object.assign(profile, upd); toast('Ajuste quitado'); route();
  };

  if (!first) {
    $('#tutorialBtn').onclick = () => showTutorial(false);
    $('#logout').onclick = async () => { await sb.auth.signOut(); location.hash = '#/login'; };
    $('#pw').onsubmit = async (ev) => {
      ev.preventDefault();
      const { error } = await sb.auth.updateUser({ password: ev.target.p.value });
      if (error) return toast(translateAuthError(error.message), true);
      ev.target.reset(); toast('Contraseña actualizada ✅');
    };
  }
}

// ---------------------------------------------------------------- HOY
function ring(value, target) {
  const R = 56, Cc = 2 * Math.PI * R;
  const frac = target > 0 ? Math.min(1, value / target) : 0;
  const over = value > target * 1.1;
  const color = over ? 'var(--danger)' : 'var(--accent)';
  return `<div class="ring"><svg width="132" height="132" viewBox="0 0 132 132">
    <circle cx="66" cy="66" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
    <circle cx="66" cy="66" r="${R}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${Cc}" stroke-dashoffset="${Cc * (1 - frac)}" style="transition:stroke-dashoffset .5s"/></svg>
    <div class="center"><div class="big">${fmt(value)}</div><div class="small muted">de ${fmt(target)} kcal</div></div></div>`;
}

function macroBar(label, value, target, color) {
  const w = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return `<div class="macro"><div class="row between"><span>${label}</span>
    <span><b>${r0(value)}</b> / ${r0(target)} g ${value > target * 1.05 ? `<span class="small" style="color:var(--danger)">· +${r0(value - target)} g de más</span>` : `<span class="muted small">· faltan ${Math.max(0, r0(target - value))} g</span>`}</span></div>
    <div class="bar"><i style="width:${w}%;background:${color}"></i></div></div>`;
}

async function viewToday() {
  const d = state.date;
  const uid = session.user.id;
  const [food, weight, acts, energy] = await Promise.all([
    sb.from('food_logs').select('*').eq('log_date', d).order('created_at'),
    sb.from('weight_logs').select('*').eq('log_date', d).maybeSingle(),
    sb.from('activity_logs').select('*').eq('log_date', d).order('created_at'),
    sb.from('daily_energy').select('*').eq('log_date', d).maybeSingle(),
  ]);
  if (food.error) throw food.error;
  const logs = food.data || [];
  const tot = C.sumLogs(logs);
  const P = profile;

  // URLs firmadas para las fotos
  const paths = logs.map((l) => l.photo_path).filter(Boolean);
  const urls = {};
  if (paths.length) {
    const { data } = await sb.storage.from('food-photos').createSignedUrls(paths, 3600);
    (data || []).forEach((x) => { if (x.signedUrl) urls[x.path] = x.signedUrl; });
  }

  const byMeal = Object.keys(MEALS).map((m) => ({ m, items: logs.filter((l) => mealKey(l.meal) === m) })).filter((g) => g.items.length);
  const actKcal = (acts.data || []).reduce((a, x) => a + C.activityKcal(P, x), 0); // ya ajustado (% del reloj)
  const watch = energy.data;
  const plan = C.dayPlan(P, actKcal, watch);   // meta de hoy = gasto de hoy − déficit objetivo
  const spent = plan.spent;
  const target = plan.kcal_target;
  const remaining = target - tot.kcal;
  const balance = tot.kcal - spent.kcal; // negativo = déficit
  const isToday = d === C.isoDate();
  const defTxt = plan.deficit >= 0 ? `déficit de ${fmt(plan.deficit)}` : `superávit de ${fmt(-plan.deficit)}`;

  app.innerHTML = `
  <div class="date-nav">
    <button class="icon-btn" id="prev">‹</button>
    <div class="label">${prettyDate(d)}</div>
    <button class="icon-btn" id="next" ${d >= C.isoDate() ? 'disabled style="opacity:.3"' : ''}>›</button>
  </div>

  <div class="card">
    <div class="ring-wrap">
      ${ring(tot.kcal, target)}
      <div class="kpis">
        <div class="kpi"><span class="muted">Meta de ${isToday ? 'hoy' : 'este día'}</span><b>${fmt(target)}</b></div>
        <div class="kpi"><span class="muted">Consumido</span><b>${fmt(tot.kcal)}</b></div>
        <div class="kpi"><span class="muted">${remaining >= 0 ? 'Te quedan' : 'Te pasaste'}</span>
          <b style="color:${remaining >= 0 ? 'var(--accent)' : 'var(--danger)'}">${fmt(Math.abs(remaining))}</b></div>
      </div>
    </div>
    <p class="small muted" style="margin:10px 0 0">🎯 Meta = gasto estimado ${fmt(plan.planned.kcal)} (base ${fmt(C.dayBase(P))}${actKcal ? ` + entreno ${fmt(actKcal)}` : ''}) − ${defTxt} objetivo.
      ${actKcal ? '' : 'Sin entreno registrado: si entrenas, tu meta sube.'}</p>
    ${macroBar('🥩 Proteínas', tot.protein_g, plan.protein_g, COLORS.prot)}
    ${macroBar('🍞 Carbohidratos', tot.carbs_g, plan.carbs_g, COLORS.carb)}
    ${macroBar('🥑 Grasas', tot.fat_g, plan.fat_g, COLORS.fat)}
    ${isToday ? (() => {
      const cz = C.macroCoach(plan, tot, new Date().getHours(), { doneMeals: logs.map((l) => mealKey(l.meal)), weightKg: P.weight_kg, trained: (acts.data || []).length > 0 });
      return `<div class="coach ${cz.tone}"><b>💡 Para lo que queda del día</b><ul>${cz.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    })() : (() => {
      const rv = C.dayReview(P, plan, tot, balance, (acts.data || []).length > 0);
      return `<div class="coach ${rv.tone}"><b>📋 Cómo te fue este día</b>${spent.source === 'reloj' ? '' : ' <span class="small muted">(estimado; ingresa el gasto del reloj para el dato real)</span>'}<ul>${rv.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    })()}
  </div>

  <div class="card">
    <div class="row between"><h2 style="margin:0">🍽️ Comidas</h2><a class="btn sm" href="#/registrar">📷 Registrar</a></div>
    ${byMeal.length ? byMeal.map((g) => `
      <div class="meal-h"><span>${MEALS[g.m]}</span><span>${fmt(C.sumLogs(g.items).kcal)} kcal</span></div>
      ${g.items.map((l) => `
        <div class="food">
          ${l.photo_path && urls[l.photo_path] ? `<img src="${esc(urls[l.photo_path])}" alt="">` : '<div class="ph">🍽️</div>'}
          <div class="info"><div class="name">${esc(l.description || 'Comida')}</div>
            <div class="mac">${fmt(l.kcal)} kcal · P ${r0(l.protein_g)} · C ${r0(l.carbs_g)} · G ${r0(l.fat_g)}</div>
            ${l.comment ? `<div class="mac">“${esc(l.comment)}”</div>` : ''}</div>
          <button class="icon-btn" data-del="${l.id}" title="Eliminar">🗑️</button>
        </div>`).join('')}`).join('')
      : `<p class="muted">Aún no registras comidas ${isToday ? 'hoy' : 'este día'}. Toma una foto de tu plato 📸</p>`}
  </div>

  <div class="card">
    <h2>🏃 Entrenamientos</h2>
    ${(acts.data || []).map((a) => `<div class="row between food"><div class="info"><div class="name">${a.source === 'reloj' ? '⌚ ' : ''}${esc(a.activity)}</div>
      <div class="mac">${a.minutes} min${a.kcal_burned ? ` · ${fmt(a.kcal_burned)} kcal` : ''}${a.steps ? ` · ${fmt(a.steps)} pasos` : ''}${a.distance_km ? ` · ${dec(r1(a.distance_km))} km` : ''} · suma ${fmt(C.activityKcal(P, a))} kcal a tu meta</div></div>
      <button class="icon-btn" data-delact="${a.id}">🗑️</button></div>`).join('') || `<p class="muted small">Sin entrenamientos ${isToday ? 'hoy' : 'este día'}.</p>`}
    <button type="button" id="aToggle" class="btn block" style="margin-top:8px">➕ Agregar entrenamiento</button>
    <div id="aPanel" class="hidden">
      <div class="tabs" style="margin-top:10px"><button type="button" data-at="foto" class="active">📷 Desde foto</button><button type="button" data-at="manual">✍️ Manual</button></div>
      <div id="atFoto">
        <p class="small muted">Pantallazo de la app de tu reloj (Apple Fitness/Salud, Garmin, Huawei, Zepp, Samsung…). La IA lee el entreno y, si aparece, el gasto total del día.</p>
        ${photoPicker('act', 'Pantallazo del reloj', 'resumen del entrenamiento o del día')}
        <button id="actAnalyze" class="btn block" style="margin-top:8px">✨ Leer pantallazo</button>
        <div id="actResult"></div>
      </div>
      <form id="af" class="grid2 hidden">
        <div style="grid-column:1/-1"><label>Actividad</label><input name="activity" list="acts" required placeholder="Ej: Caminar, pesas, fútbol"></div>
        <div><label>Minutos</label><input name="minutes" type="text" inputmode="numeric" pattern="[0-9]+" required></div>
        <div><label>kcal (opcional)</label><input name="kcal" type="text" inputmode="numeric" pattern="[0-9]+" placeholder="del reloj"></div>
        <div style="grid-column:1/-1"><label>Fecha</label><input name="date" type="date" value="${d}" max="${C.isoDate()}" required></div>
        <datalist id="acts">${['Caminar', 'Correr', 'Pesas / gimnasio', 'Bicicleta', 'Natación', 'Fútbol', 'Pádel / tenis', 'Yoga / pilates', 'Baile', 'Trekking', 'Crossfit / HIIT'].map((x) => `<option value="${x}">`).join('')}</datalist>
        <button class="btn" style="grid-column:1/-1">Guardar entrenamiento</button>
        <p class="small muted" style="grid-column:1/-1;margin:0">Sin kcal, se estiman según minutos, tu peso e intensidad habitual.</p>
      </form>
    </div>
  </div>

  <div class="card">
    <h2>📊 Balance del día</h2>
    ${tot.kcal > 0 ? `<div class="balance ${balance < 0 ? 'ok' : 'over'}" style="margin-top:0">
      <div class="row between"><span>${spent.source === 'reloj' ? '⌚ Con el gasto de tu reloj' : '📐 Estimado'}</span>
        <b>${balance < 0 ? `Déficit ${fmt(-balance)}` : `Superávit ${fmt(balance)}`} kcal</b></div>
      <table class="bal">
        ${spent.source === 'reloj'
          ? `<tr><td>Gasto según tu reloj${watch.active_kcal ? ` (reposo ${fmt(watch.resting_kcal || watch.total_kcal - watch.active_kcal)} + ${P.exercise_credit_pct ?? C.DEFAULT_CREDIT}% de activa ${fmt(watch.active_kcal)})` : ''}</td><td>${fmt(spent.kcal)}</td></tr>`
          : `<tr><td>Gasto sin ejercicio <span class="muted">${C.learnedWeight(P) > 0 ? '(aprendido de tu reloj)' : `(metabolismo ${fmt(C.bmr(P))} × actividad ${String(C.ACTIVITY_LEVELS[P.activity_level]?.factor ?? 1.2).replace('.', ',')})`}</span></td><td>${fmt(C.dayBase(P))}</td></tr>
             <tr><td>+ Entrenamientos</td><td>${actKcal ? `+${fmt(actKcal)}` : '0'}</td></tr>
             <tr class="sum"><td>= Gasto del día</td><td>${fmt(spent.kcal)}</td></tr>`}
        <tr><td>− Comido</td><td>−${fmt(tot.kcal)}</td></tr>
        <tr class="sum"><td>= ${balance < 0 ? 'Déficit' : 'Superávit'} <span class="muted">(objetivo: ${defTxt})</span></td><td>${fmt(Math.abs(balance))}</td></tr>
      </table>
    </div>` : '<p class="small muted">Registra tus comidas para ver el balance.</p>'}
    <button type="button" id="eToggle" class="btn ghost block" style="margin-top:10px">⌚ ${watch ? 'Editar gasto total del reloj' : 'Cerrar el día con el gasto total del reloj'}</button>
    <form id="ef" class="grid3 hidden" style="margin-top:6px">
      <div><label>Total (kcal)</label><input name="total_kcal" type="text" inputmode="numeric" pattern="[0-9]+" value="${watch?.total_kcal ?? ''}" placeholder="Ej: 2780"></div>
      <div><label>Activa</label><input name="active_kcal" type="text" inputmode="numeric" pattern="[0-9]*" value="${watch?.active_kcal ?? ''}" placeholder="opcional"></div>
      <div><label>En reposo</label><input name="resting_kcal" type="text" inputmode="numeric" pattern="[0-9]*" value="${watch?.resting_kcal ?? ''}" placeholder="opcional"></div>
      <button class="btn" style="grid-column:1/-1">Guardar gasto del día</button>
      <p class="small muted" style="grid-column:1/-1;margin:0">En Apple: app Salud → Energía activa + Energía en reposo. Se considera el ${P.exercise_credit_pct ?? C.DEFAULT_CREDIT}% de la activa. Con 7+ días registrados, tu meta aprende de tu gasto real.${watch ? ' <a href="#" id="delEnergy">Quitar dato de este día</a>' : ''}</p>
    </form>
  </div>

  <div class="card">
    <h2>⚖️ Peso y medidas</h2>
    ${weight.data ? `<p>Peso: <b>${dec(weight.data.weight_kg)} kg</b>${weight.data.waist_cm ? ` · Cintura: <b>${dec(weight.data.waist_cm)} cm</b>` : ''}</p>` : '<p class="small muted">Sin registro este día.</p>'}
    <button type="button" id="wToggle" class="btn ghost block">⚖️ ${weight.data ? 'Editar peso y/o medidas' : 'Registrar peso y/o medidas'}</button>
    <form id="wf" class="grid2 hidden" style="margin-top:6px">
      <div><label>Peso (kg)</label>${decInput('weight_kg', weight.data?.weight_kg, 'required placeholder="Ej: 78,5"')}</div>
      <div><label>Cintura (cm, opcional)</label>${decInput('waist_cm', weight.data?.waist_cm, 'placeholder="Ej: 92"')}</div>
      <button class="btn" style="grid-column:1/-1">Guardar</button>
      <p class="small muted" style="grid-column:1/-1;margin:0">Se guarda en ${prettyDate(d).toLowerCase()}. Usa ‹ › arriba para registrar otros días.</p>
    </form>
  </div>`;

  // Botones que muestran/ocultan formularios
  const reveal = (btn, panel, focus) => ($(btn).onclick = () => { $(panel).classList.remove('hidden'); $(btn).classList.add('hidden'); if (focus) focus(); });
  reveal('#aToggle', '#aPanel');
  reveal('#eToggle', '#ef', () => $('#ef').total_kcal.focus());
  $$('[data-at]').forEach((b) => (b.onclick = () => {
    $$('[data-at]').forEach((x) => x.classList.toggle('active', x === b));
    $('#atFoto').classList.toggle('hidden', b.dataset.at !== 'foto');
    $('#af').classList.toggle('hidden', b.dataset.at !== 'manual');
  }));

  $('#prev').onclick = () => { state.date = C.addDays(d, -1); route(); };
  $('#next').onclick = () => { if (d < C.isoDate()) { state.date = C.addDays(d, 1); route(); } };

  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('¿Eliminar este registro?')) return;
    const l = logs.find((x) => String(x.id) === b.dataset.del);
    const { error } = await sb.from('food_logs').delete().eq('id', l.id);
    if (error) return toast(error.message, true);
    if (l.photo_path) await sb.storage.from('food-photos').remove([l.photo_path]);
    route();
  }));
  $$('[data-delact]').forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from('activity_logs').delete().eq('id', b.dataset.delact);
    if (error) return toast(error.message, true);
    route();
  }));

  reveal('#wToggle', '#wf', () => $('#wf').weight_kg.focus());

  $('#wf').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const w = num(f.weight_kg);
    if (!(w >= 30 && w <= 300)) return toast('Ingresa un peso válido, ej: 78,5', true);
    const row = { user_id: uid, log_date: d, weight_kg: w, waist_cm: num(f.waist_cm) || null };
    const { error } = await sb.from('weight_logs').upsert(row, { onConflict: 'user_id,log_date' });
    if (error) return toast(error.message, true);
    // Si es el registro más reciente, actualiza el peso del perfil y recalcula metas
    const { data: last } = await sb.from('weight_logs').select('log_date').order('log_date', { ascending: false }).limit(1).maybeSingle();
    if (last?.log_date === d && Number(profile.weight_kg) !== row.weight_kg) {
      const t = C.targets({ ...profile, weight_kg: row.weight_kg });
      const upd = { weight_kg: row.weight_kg, bmr: t.bmr, tdee: t.tdee, kcal_target: t.kcal_target, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g };
      await sb.from('profiles').update(upd).eq('id', uid);
      Object.assign(profile, upd);
      toast('Peso guardado y metas recalculadas ✅');
    } else toast('Peso guardado ✅');
    route();
  };

  $('#ef').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const act = parseInt(f.active_kcal, 10) || null;
    const rest = parseInt(f.resting_kcal, 10) || null;
    const total = parseInt(f.total_kcal, 10) || (act && rest ? act + rest : null);
    if (!(total >= 500 && total <= 10000)) return toast('Ingresa el gasto total del día (ej: 2780), o activa + en reposo', true);
    const { error } = await sb.from('daily_energy').upsert({ user_id: uid, log_date: d, total_kcal: total, active_kcal: act, resting_kcal: rest, source: 'manual' }, { onConflict: 'user_id,log_date' });
    if (error) return toast(error.message, true);
    toast('Gasto del día guardado ⌚'); route();
  };
  if ($('#delEnergy')) $('#delEnergy').onclick = async (ev) => {
    ev.preventDefault();
    const { error } = await sb.from('daily_energy').delete().eq('log_date', d);
    if (error) return toast(error.message, true);
    route();
  };

  $('#af').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    const minutes = parseInt(f.minutes, 10);
    if (!(minutes > 0)) return toast('Ingresa los minutos', true);
    const { error } = await sb.from('activity_logs').insert({ log_date: f.date || d, activity: f.activity.trim(), minutes, kcal_burned: parseInt(f.kcal, 10) || null, source: 'manual' });
    if (error) return toast(error.message, true);
    toast(f.date && f.date !== d ? `Actividad registrada el ${shortDate(f.date)} 💪` : 'Actividad registrada 💪');
    route();
  };

  // --- Pantallazo del reloj
  let shot = null;
  let found = [];
  let totals = [];
  bindPhotoPicker('act', (img) => { shot = img; }, 1600);
  const renderActs = () => {
    $('#actResult').innerHTML = (totals.length ? `
      <div style="margin-top:10px"><b class="small">Gasto total del día</b>${totals.map((t, i) => `<label class="check"><input type="checkbox" data-tot="${i}" ${t.use ? 'checked' : ''}>
        ${shortDate(t.date)}: <b>${fmt(t.total_kcal)} kcal</b>${t.active_kcal ? ` <span class="muted">(activa ${fmt(t.active_kcal)}${t.resting_kcal ? ` · reposo ${fmt(t.resting_kcal)}` : ''})</span>` : ''}</label>`).join('')}</div>` : '')
      + (found.length ? `
      <div style="margin-top:10px">${found.length ? '<b class="small">Entrenamientos</b>' : ''}${found.map((a, i) => `<div class="item" data-i="${i}">
        <div class="row"><input data-k="activity" value="${esc(a.activity)}" placeholder="Actividad"><button type="button" class="icon-btn" data-rma="${i}">✕</button></div>
        <div class="item-nums">
          <div><span class="small muted">Fecha</span><input data-k="date" type="date" max="${C.isoDate()}" value="${esc(a.date)}"></div>
          <div><span class="small muted">Minutos</span><input data-k="minutes" type="text" inputmode="numeric" value="${a.minutes ?? ''}"></div>
          <div><span class="small muted">kcal</span><input data-k="kcal" type="text" inputmode="numeric" value="${a.kcal ?? ''}"></div>
          <div><span class="small muted">Pasos</span><input data-k="steps" type="text" inputmode="numeric" value="${a.steps ?? ''}"></div>
        </div></div>`).join('')}
      </div>` : '')
      + (found.length || totals.length ? '<button id="actSave" class="btn block" style="margin-top:8px">Guardar</button>' : '');
    $$('[data-tot]').forEach((c) => (c.onchange = () => { totals[+c.dataset.tot].use = c.checked; }));
    $$('#actResult .item input').forEach((inp) => (inp.onchange = () => {
      const a = found[+inp.closest('.item').dataset.i];
      a[inp.dataset.k] = ['minutes', 'kcal', 'steps'].includes(inp.dataset.k) ? (parseInt(inp.value, 10) || null) : inp.value;
    }));
    $$('[data-rma]').forEach((b) => (b.onclick = () => { found.splice(+b.dataset.rma, 1); renderActs(); }));
    if (found.length || totals.length) $('#actSave').onclick = async () => {
      const tRows = totals.filter((t) => t.use).map((t) => ({ user_id: uid, log_date: t.date, total_kcal: t.total_kcal, active_kcal: t.active_kcal || null, resting_kcal: t.resting_kcal || null, source: 'reloj' }));
      const rows = found.filter((a) => a.activity && (a.minutes > 0 || a.kcal > 0)).map((a) => ({
        log_date: a.date && a.date <= C.isoDate() ? a.date : d, activity: a.activity.trim().slice(0, 60),
        minutes: Math.max(1, a.minutes || 1), kcal_burned: a.kcal || null, steps: a.steps || null,
        distance_km: a.distance_km || null, source: 'reloj',
      }));
      if (!rows.length && !tRows.length) return toast('No hay nada seleccionado para guardar', true);
      const btn = $('#actSave'); busy(btn, true, 'Guardando…');
      if (rows.length) {
        const { error } = await sb.from('activity_logs').insert(rows);
        if (error) { busy(btn, false); return toast(error.message, true); }
      }
      if (tRows.length) {
        const { error } = await sb.from('daily_energy').upsert(tRows, { onConflict: 'user_id,log_date' });
        if (error) { busy(btn, false); return toast(error.message, true); }
      }
      const otherDays = [...new Set([...rows, ...tRows].map((r) => r.log_date))].filter((x) => x !== d);
      toast(otherDays.length ? `Guardado (incluye ${otherDays.map(shortDate).join(', ')}) ⌚` : 'Actividad guardada ⌚');
      route();
    };
  };
  $('#actAnalyze').onclick = async () => {
    if (!shot) return toast('Primero elige un pantallazo', true);
    const btn = $('#actAnalyze'); busy(btn, true, 'Leyendo…');
    try {
      const data = await callAI({ mode: 'activity', image: shot.base64, mimeType: 'image/jpeg', today: C.isoDate(), viewing: d });
      found = (data.activities || []).map((a) => ({
        activity: a.activity || 'Actividad', date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : d,
        minutes: Math.round(a.minutes) || null, kcal: Math.round(a.kcal_active || a.kcal_total) || null,
        steps: Math.round(a.steps) || null, distance_km: a.distance_km || null,
      }));
      totals = (data.day_totals || []).map((t) => {
        const act = Math.round(t.active_kcal) || 0, rest = Math.round(t.resting_kcal) || 0;
        const total = Math.round(t.total_kcal) || (act && rest ? act + rest : 0);
        return { date: /^\d{4}-\d{2}-\d{2}$/.test(t.date || '') ? t.date : d, total_kcal: total, active_kcal: act, resting_kcal: rest, use: true };
      }).filter((t) => t.total_kcal >= 500);
      if (!found.length && !totals.length) toast(data.notes || 'No encontré entrenamientos ni gasto total en el pantallazo', true);
      else if (data.notes) toast(data.notes);
      renderActs();
    } catch (e) { toast(e.message, true); }
    finally { busy(btn, false); }
  };
}

// ---------------------------------------------------------------- REGISTRAR COMIDA
async function resizeImage(file, max = 1024, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    const dataUrl = c.toDataURL('image/jpeg', quality);
    return { blob, dataUrl, base64: dataUrl.split(',')[1] };
  } finally { URL.revokeObjectURL(url); }
}

async function viewRegister() {
  let photo = null; // { blob, dataUrl, base64 }
  let items = [];
  let meta = { description: '', confidence: null, notes: '' };

  app.innerHTML = `
  <h1>Registrar comida</h1>
  <div class="card">
    <label style="margin-top:0">Comida</label>
    <div class="seg" id="mealSeg">${Object.entries(MEALS).map(([k, v]) => `<button type="button" data-meal="${k}" class="${k === defaultMeal() ? 'active' : ''}">${v}</button>`).join('')}</div>
    <input id="meal" type="hidden" value="${defaultMeal()}">
    <label>Fecha</label><input id="date" type="date" value="${state.date}" max="${C.isoDate()}">
    <label>Foto (recomendada)</label>
    ${photoPicker('food', 'Foto del plato', 'la foto mejora la estimación de porciones')}
    <label>¿Qué comiste? <span class="muted">(obligatorio si no hay foto)</span></label>
    <textarea id="comment" maxlength="500" placeholder="Ej: 2 huevos duros y una marraqueta con palta. Con foto puedes agregar detalles: 'le eché 1 cucharada de aceite', 'me comí la mitad'."></textarea>
    <button id="analyze" class="btn block" style="margin-top:12px">✨ Analizar con IA</button>
    <button id="manual" class="btn ghost block" style="margin-top:8px">✍️ Ingresar valores a mano</button>
  </div>
  <div id="result"></div>`;

  bindPhotoPicker('food', (img) => { photo = img; }, 1024);
  $$('#mealSeg button').forEach((b) => (b.onclick = () => {
    $$('#mealSeg button').forEach((x) => x.classList.toggle('active', x === b));
    $('#meal').value = b.dataset.meal;
  }));

  const renderResult = () => {
    const tot = C.sumLogs(items);
    $('#result').innerHTML = `
    <div class="card">
      <div class="row between"><h2 style="margin:0">Resultado</h2>
        ${meta.confidence ? `<span class="badge ${meta.confidence}">Confianza ${meta.confidence}</span>` : ''}</div>
      <label>Descripción</label><input id="desc" value="${esc(meta.description)}" placeholder="Nombre del plato">
      ${meta.notes ? `<p class="small muted">ℹ️ ${esc(meta.notes)}</p>` : ''}
      <div style="margin-top:8px">
        ${items.map((it, i) => `<div class="item" data-i="${i}">
          <div class="row"><input data-k="name" value="${esc(it.name)}" placeholder="Alimento"><button class="icon-btn" data-rm="${i}" title="Quitar">✕</button></div>
          ${it.quantity ? `<div class="small muted">${esc(it.quantity)}</div>` : ''}
          <div class="item-nums">
            ${[['kcal', 'kcal'], ['protein_g', 'Prot g'], ['carbs_g', 'Carb g'], ['fat_g', 'Grasa g']].map(([k, l]) => `<div><span class="small muted">${l}</span>
              <input data-k="${k}" type="text" inputmode="decimal" autocomplete="off" value="${dec(r1(it[k]))}"></div>`).join('')}
          </div></div>`).join('')}
        <div class="item-total"><b>Total</b><span><b>${fmt(tot.kcal)}</b> kcal · P ${r0(tot.protein_g)} · C ${r0(tot.carbs_g)} · G ${r0(tot.fat_g)}</span></div>
      </div>
      <button id="addItem" class="btn ghost sm" style="margin-top:8px">+ Agregar alimento</button>
      <p class="small muted">Puedes corregir cualquier valor antes de guardar.</p>
      <button id="save" class="btn block" style="margin-top:6px">Guardar en mi registro</button>
    </div>`;

    $$('#result .item input').forEach((inp) => (inp.onchange = () => {
      const i = +inp.closest('.item').dataset.i;
      items[i][inp.dataset.k] = inp.dataset.k === 'name' ? inp.value : Math.max(0, num(inp.value) || 0);
      meta.description = $('#desc').value;
      renderResult();
    }));
    $$('[data-rm]').forEach((b) => (b.onclick = () => { meta.description = $('#desc').value; items.splice(+b.dataset.rm, 1); renderResult(); }));
    $('#addItem').onclick = () => { meta.description = $('#desc').value; items.push({ name: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }); renderResult(); };
    $('#save').onclick = save;
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  $('#manual').onclick = () => {
    if (!items.length) items = [{ name: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }];
    renderResult();
  };

  $('#analyze').onclick = async () => {
    const comment = $('#comment').value.trim();
    if (!photo && !comment) { $('#comment').focus(); return toast('Toma una foto o escribe qué comiste (ej: "Huevo duro")', true); }
    const btn = $('#analyze'); busy(btn, true, 'Analizando…');
    try {
      const data = await callAI({ image: photo?.base64, mimeType: 'image/jpeg', comment, meal: MEALS[$('#meal').value] });
      items = (data.items || []).map((it) => ({ ...it }));
      meta = { description: data.description || '', confidence: data.confidence, notes: data.notes || '' };
      if (!items.length) { toast(data.notes || 'No se reconoció comida en la imagen', true); items = [{ name: '', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }]; }
      renderResult();
    } catch (e) {
      toast(e.message, true);
    } finally { busy(btn, false); }
  };

  async function save() {
    const btn = $('#save'); busy(btn, true, 'Guardando…');
    try {
      const valid = items.filter((it) => it.name || it.kcal);
      if (!valid.length) throw new Error('Agrega al menos un alimento');
      const tot = C.sumLogs(valid);
      let photo_path = null;
      if (photo) {
        photo_path = `${session.user.id}/${Date.now()}.jpg`;
        const { error } = await sb.storage.from('food-photos').upload(photo_path, photo.blob, { contentType: 'image/jpeg' });
        if (error) { console.warn('No se pudo subir la foto', error); photo_path = null; }
      }
      const date = $('#date').value || state.date;
      const { error } = await sb.from('food_logs').insert({
        log_date: date, meal: $('#meal').value,
        description: ($('#desc').value || valid.map((x) => x.name).join(', ')).slice(0, 200),
        comment: $('#comment').value.trim() || null, photo_path,
        kcal: r0(tot.kcal), protein_g: r1(tot.protein_g), carbs_g: r1(tot.carbs_g), fat_g: r1(tot.fat_g),
        items: valid, ai_confidence: meta.confidence,
      });
      if (error) throw error;
      state.date = date;
      toast('Comida registrada ✅');
      location.hash = '#/hoy';
    } catch (e) { toast(e.message, true); busy(btn, false); }
  }
}

// ---------------------------------------------------------------- PROGRESO
async function viewProgress() {
  const to = C.isoDate();
  const from = C.addDays(to, -(state.range - 1));
  const CAL_DAYS = 28;
  const qFrom = C.addDays(to, -(Math.max(state.range, CAL_DAYS) - 1));
  const [food, weights, acts, energy] = await Promise.all([
    sb.from('food_logs').select('log_date,kcal,protein_g,carbs_g,fat_g').gte('log_date', qFrom).lte('log_date', to),
    sb.from('weight_logs').select('log_date,weight_kg,waist_cm').order('log_date'),
    sb.from('activity_logs').select('log_date,minutes,kcal_burned').gte('log_date', qFrom).lte('log_date', to),
    sb.from('daily_energy').select('log_date,total_kcal,active_kcal,resting_kcal').gte('log_date', qFrom).lte('log_date', to),
  ]);
  if (food.error) throw food.error;
  const P = profile;

  // agregación diaria
  const days = [];
  for (let d = from; d <= to; d = C.addDays(d, 1)) days.push(d);
  const allDays = [];
  for (let d = qFrom; d <= to; d = C.addDays(d, 1)) allDays.push(d);
  const daily = Object.fromEntries(allDays.map((d) => [d, { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, n: 0, act: 0, burn: 0, watch: null }]));
  (energy.data || []).forEach((e) => { if (daily[e.log_date]) daily[e.log_date].watch = e; });
  (food.data || []).forEach((l) => { const x = daily[l.log_date]; if (!x) return; x.kcal += +l.kcal; x.protein_g += +l.protein_g; x.carbs_g += +l.carbs_g; x.fat_g += +l.fat_g; x.n++; });
  (acts.data || []).forEach((a) => { if (daily[a.log_date]) { daily[a.log_date].act += a.minutes; daily[a.log_date].burn += C.activityKcal(P, a); } });
  const totalBurn = days.reduce((a, d) => a + daily[d].burn, 0);
  allDays.forEach((d) => { const x = daily[d]; const e = C.dayExpenditure(P, x.burn, x.watch); x.spent = e.kcal; x.src = e.source; x.target = C.dayTarget(P, x.burn); });
  const inTarget = (d) => Math.abs(daily[d].kcal - daily[d].target) <= daily[d].target * 0.1;
  const balanceSum = days.filter((d) => daily[d].n > 0).reduce((a, d) => a + (daily[d].kcal - daily[d].spent), 0);
  const watchDays = days.filter((d) => daily[d].n > 0 && daily[d].src === 'reloj').length;
  // Calibración con la balanza (últimos 28 días)
  const calDays = allDays.slice(-CAL_DAYS).filter((d) => daily[d].n > 0).map((d) => ({ intake: daily[d].kcal, expenditure: daily[d].spent }));
  const calW = (weights.data || []).filter((w) => w.log_date >= C.addDays(to, -(CAL_DAYS - 1))).map((w) => ({ date: w.log_date, kg: +w.weight_kg }));
  const cal = C.calibrate(calDays, calW, CAL_DAYS);
  const dir = C.weightDirection(P.goal);
  const goodDelta = (x) => (dir === 'down' ? x < 0 : dir === 'up' ? x > 0 : Math.abs(x) < 0.5);

  const logged = days.filter((d) => daily[d].n > 0);
  const kcalOk = logged.filter(inTarget).length;
  const protOk = logged.filter((d) => daily[d].protein_g >= P.protein_g * 0.9).length;
  const avg = (k) => (logged.length ? logged.reduce((a, d) => a + daily[d][k], 0) / logged.length : 0);
  const totalAct = days.reduce((a, d) => a + daily[d].act, 0);

  const ws = weights.data || [];
  const wNow = ws.length ? +ws[ws.length - 1].weight_kg : +P.weight_kg;
  const wStart = +P.start_weight_kg || (ws[0] ? +ws[0].weight_kg : wNow);
  const wDiff = r1(wNow - wStart);

  // semanas
  const weeks = {};
  days.forEach((d) => { const w = C.weekStart(d); (weeks[w] ||= []).push(d); });
  const wRows = Object.entries(weeks).reverse().map(([w, ds]) => {
    const lg = ds.filter((d) => daily[d].n > 0);
    const a = (k) => (lg.length ? lg.reduce((s, d) => s + daily[d][k], 0) / lg.length : null);
    const inWeek = ws.filter((x) => x.log_date >= w && x.log_date <= C.addDays(w, 6));
    const before = ws.filter((x) => x.log_date < w).pop();
    const last = inWeek[inWeek.length - 1];
    const delta = last && before ? r1(last.weight_kg - before.weight_kg) : null;
    return { w, ds: ds.length, lg: lg.length, kcal: a('kcal'), prot: a('protein_g'), ok: lg.filter(inTarget).length, bal: lg.reduce((s2, d) => s2 + daily[d].kcal - daily[d].spent, 0), act: ds.reduce((s, d) => s + daily[d].act, 0), delta, last: last?.weight_kg };
  });

  const goalTxt = GOAL_SHORT[P.goal] || '—';
  app.innerHTML = `
  <h1>Mi progreso</h1>
  <div class="tabs">${[7, 30, 90].map((r) => `<button data-r="${r}" class="${state.range === r ? 'active' : ''}">${r} días</button>`).join('')}</div>

  <div class="card"><div class="stat-grid">
    <div class="stat"><div class="v">${logged.length}/${days.length}</div><div class="l">Días con registro (constancia ${pct(logged.length, days.length)}%)</div></div>
    <div class="stat"><div class="v">${pct(kcalOk, days.length)}%</div><div class="l">Días en meta calórica (±10%)</div></div>
    <div class="stat"><div class="v">${pct(protOk, days.length)}%</div><div class="l">Días cumpliendo proteína</div></div>
    <div class="stat"><div class="v">${fmt(avg('kcal'))}</div><div class="l">kcal promedio (meta base ${fmt(P.kcal_target)})</div></div>
    <div class="stat"><div class="v" style="color:${balanceSum < 0 ? 'var(--accent)' : 'var(--danger)'}">${balanceSum < 0 ? '−' : '+'}${fmt(Math.abs(balanceSum))}</div><div class="l">Balance acumulado kcal (≈ ${balanceSum < 0 ? '−' : '+'}${dec(r1(Math.abs(balanceSum) / 7700))} kg) · ${watchDays} de ${logged.length} días con dato del reloj</div></div>
    <div class="stat"><div class="v">${totalAct} min</div><div class="l">Actividad (meta ${r0(P.weekly_activity_goal_min * days.length / 7)} min)${totalBurn ? ` · ${fmt(totalBurn)} kcal de ejercicio` : ''}</div></div>
    <div class="stat"><div class="v" style="color:${wDiff !== 0 && goodDelta(wDiff) ? 'var(--accent)' : 'inherit'}">${wDiff > 0 ? '+' : ''}${String(wDiff).replace('.', ',')} kg</div><div class="l">Desde el inicio (${String(wStart).replace('.', ',')} → ${String(wNow).replace('.', ',')} kg) · objetivo: ${goalTxt}</div></div>
  </div></div>

  <div class="card"><h2>⚖️ Calibración con tu balanza</h2>
    ${cal.ok ? `<p class="small">Últimos 28 días: comiste en promedio <b>${fmt(cal.intake)} kcal</b>. La app estimó un gasto de <b>${fmt(cal.est)}</b>, lo que predecía <b>${cal.predictedKgWeek > 0 ? '+' : ''}${dec(cal.predictedKgWeek)} kg/semana</b>. Tu balanza muestra <b>${cal.realKgWeek > 0 ? '+' : ''}${dec(cal.realKgWeek)} kg/semana</b>, así que tu gasto real ronda <b>${fmt(cal.real)} kcal/día</b>.</p>
      ${Math.abs(cal.diff) >= 100 ? `<p class="small">${cal.diff < 0 ? 'Tu gasto real parece <b>menor</b> que el estimado (el reloj o el nivel de actividad sobreestiman).' : 'Tu gasto real parece <b>mayor</b> que el estimado.'} Puedes ajustar tu gasto base en <b>${cal.diff > 0 ? '+' : ''}${fmt(Math.max(-600, Math.min(600, cal.diff)))} kcal/día</b> para que tu meta calce con la realidad.</p>
        <button id="applyCal" class="btn sm">Aplicar ajuste</button>` : '<p class="small">✅ La estimación calza con tu balanza. No hace falta ajustar.</p>'}
      <p class="small muted">Supone que registraste casi todo lo que comiste. Si te saltaste comidas sin anotar, el ajuste no será confiable.</p>`
    : `<p class="small muted">Aún no hay datos suficientes. ${esc(cal.reason)} Con eso comparamos lo que la app predijo con lo que marcó tu balanza y ajustamos tu gasto real.</p>`}
  </div>

  <div class="card"><h2>🔥 Calorías vs meta</h2><div class="chart-box"><canvas id="cKcal"></canvas></div></div>
  <div class="card"><h2>🥩 Proteínas vs objetivo</h2><div class="chart-box"><canvas id="cProt"></canvas></div></div>
  <div class="card"><h2>🍞 Carbohidratos vs objetivo</h2><div class="chart-box"><canvas id="cCarb"></canvas></div></div>
  <div class="card"><h2>🥑 Grasas vs objetivo</h2><div class="chart-box"><canvas id="cFat"></canvas></div></div>
  <div class="card"><h2>⚖️ Evolución del peso</h2><div class="chart-box"><canvas id="cWeight"></canvas></div>
    ${ws.length < 2 ? '<p class="small muted">Registra tu peso en la pestaña Hoy (idealmente 1–2 veces por semana, en ayunas) para ver la curva.</p>' : ''}</div>

  <div class="card"><h2>📅 Progreso semanal</h2><div class="table-scroll"><table class="week">
    <thead><tr><th>Semana</th><th>Días reg.</th><th>kcal prom.</th><th>En meta</th><th>Prot. prom.</th><th>Actividad</th><th>Balance</th><th>Peso</th></tr></thead>
    <tbody>${wRows.map((r) => `<tr><td>${shortDate(r.w)}</td><td>${r.lg}/${r.ds}</td><td>${r.kcal == null ? '—' : fmt(r.kcal)}</td><td>${r.ok}</td>
      <td>${r.prot == null ? '—' : r0(r.prot) + ' g'}</td><td>${r.act} min</td>
      <td style="color:${r.lg ? (r.bal < 0 ? 'var(--accent)' : 'var(--danger)') : 'inherit'}">${r.lg ? `${r.bal < 0 ? '−' : '+'}${fmt(Math.abs(r.bal))}` : '—'}</td>
      <td>${r.last ? String(r.last).replace('.', ',') : '—'}${r.delta != null ? ` <span class="small" style="color:${goodDelta(r.delta) ? 'var(--accent)' : 'var(--muted)'}">(${r.delta > 0 ? '+' : ''}${String(r.delta).replace('.', ',')})</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;

  $$('.tabs button').forEach((b) => (b.onclick = () => { state.range = +b.dataset.r; route(); }));
  if ($('#applyCal')) $('#applyCal').onclick = async () => {
    const adj = Math.max(-600, Math.min(600, cal.diff));
    const calibration_kcal = Math.max(-800, Math.min(800, (P.calibration_kcal || 0) + adj));
    const t = C.targets({ ...P, calibration_kcal });
    const upd = { calibration_kcal, tdee: t.tdee, kcal_target: t.kcal_target, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g };
    const { error } = await sb.from('profiles').update(upd).eq('id', session.user.id);
    if (error) return toast(error.message, true);
    Object.assign(profile, upd);
    toast(`Meta ajustada: ahora ${fmt(t.kcal_target)} kcal/día ✅`); route();
  };

  const labels = days.map(shortDate);
  const baseOpts = (unit) => ({
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: { legend: { labels: { color: tickColor(), boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${r0(c.parsed.y)} ${unit}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: tickColor(), maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
      y: { beginAtZero: true, grid: { color: gridColor() }, ticks: { color: tickColor() } } },
  });
  const barChart = (id, key, targetIn, color, unit, tol) => { const tg = (i) => (Array.isArray(targetIn) ? targetIn[i] : targetIn); return chart($('#' + id), {
    type: 'bar',
    data: { labels, datasets: [
      { type: 'line', label: 'Meta', data: days.map((_, i) => tg(i)), borderColor: COLORS.target, borderDash: [6, 4], pointRadius: 0, borderWidth: 2, stepped: 'middle' },
      { label: 'Consumido', data: days.map((d) => r0(daily[d][key])), borderRadius: 6,
        backgroundColor: days.map((d, i) => {
          const target = tg(i);
          const v = daily[d][key];
          if (!v) return 'rgba(156,163,175,.3)';
          if (tol === 'range') return Math.abs(v - target) <= target * 0.1 ? color : v > target ? '#dc2626' : color + '88';
          return v >= target * 0.9 ? color : color + '88';
        }) },
    ] },
    options: baseOpts(unit),
  }); };
  barChart('cKcal', 'kcal', days.map((d) => daily[d].target), COLORS.kcal, 'kcal', 'range');
  barChart('cProt', 'protein_g', P.protein_g, COLORS.prot, 'g', 'min');
  barChart('cCarb', 'carbs_g', P.carbs_g, COLORS.carb, 'g', 'range');
  barChart('cFat', 'fat_g', P.fat_g, COLORS.fat, 'g', 'range');

  const wl = ws.length ? ws : [{ log_date: to, weight_kg: P.weight_kg }];
  const wOpts = baseOpts('kg');
  wOpts.scales.y.beginAtZero = false;
  wOpts.plugins.tooltip.callbacks.label = (c) => `${c.dataset.label}: ${c.parsed.y} kg`;
  chart($('#cWeight'), {
    type: 'line',
    data: { labels: wl.map((x) => shortDate(x.log_date)), datasets: [
      { label: 'Peso', data: wl.map((x) => +x.weight_kg), borderColor: COLORS.kcal, backgroundColor: COLORS.kcal + '22', fill: true, tension: 0.3, pointRadius: 3 },
      ...(P.target_weight_kg ? [{ label: 'Peso meta', data: wl.map(() => +P.target_weight_kg), borderColor: COLORS.target, borderDash: [6, 4], pointRadius: 0 }] : []),
    ] },
    options: wOpts,
  });
}

// ---------------------------------------------------------------- AMIGOS
async function viewFriends() {
  const { data: groups, error } = await sb.from('groups').select('id,name,invite_code,created_by').order('created_at');
  if (error) throw error;
  if (groups.length && !groups.some((g) => g.id === state.groupId)) state.groupId = groups[0].id;
  if (!groups.length) state.groupId = null;
  const g = groups.find((x) => x.id === state.groupId);

  app.innerHTML = `
  <h1>Amigos</h1>
  ${groups.length ? `<div class="card">
    <div class="row between wrap">
      <select id="gsel" style="flex:1;min-width:160px">${groups.map((x) => `<option value="${x.id}" ${x.id === state.groupId ? 'selected' : ''}>👥 ${esc(x.name)}</option>`).join('')}</select>
    </div>
    <div class="row between" style="margin-top:12px">
      <div><div class="small muted">Código de invitación</div><div class="code">${esc(g.invite_code)}</div></div>
      <button id="share" class="btn sm">Invitar amigos</button>
    </div>
  </div>
  <div class="tabs">${[7, 30].map((r) => `<button data-r="${r}" class="${state.groupRange === r ? 'active' : ''}">Últimos ${r} días</button>`).join('')}</div>
  <div class="card" id="board"><div class="loading">Calculando ranking…</div></div>
  <div class="card"><h2>📉 Cambio de peso vs su punto de partida</h2>
    <p class="small muted">En % respecto del peso inicial de cada uno, para comparar de forma justa.</p>
    <div class="chart-box"><canvas id="cGroup"></canvas></div></div>
  <details class="card"><summary><b>¿Cómo se calcula el puntaje?</b></summary>
    <p class="small">Premia la <b>constancia y el cumplimiento de tus propias metas</b>, no solo los kilos:</p>
    <ul class="small"><li>30% — Constancia: días con comidas registradas.</li>
      <li>25% — Días con calorías dentro de ±10% de tu meta.</li>
      <li>20% — Días alcanzando al menos 90% de tu meta de proteína.</li>
      <li>15% — Minutos de actividad física vs tu meta semanal.</li>
      <li>10% — Que tu peso vaya en la dirección de <i>tu</i> objetivo.</li></ul>
    <p class="small muted">Tus amigos solo ven estos indicadores agregados, nunca tus fotos ni el detalle de lo que comes.</p>
  </details>` : `<div class="card"><p>Aún no estás en ningún grupo. Crea uno e invita a tus amigos con el código, o únete con el código que te compartieron.</p></div>`}

  <div class="card">
    <h2>Crear grupo</h2>
    <form id="cg" class="row"><input name="name" required maxlength="60" placeholder="Ej: Los del fútbol"><button class="btn">Crear</button></form>
    <h2 style="margin-top:16px">Unirme con código</h2>
    <form id="jg" class="row"><input name="code" required maxlength="10" placeholder="ABC123" style="text-transform:uppercase"><button class="btn ghost">Unirme</button></form>
  </div>
  ${g ? `<button id="leave" class="btn danger block">Salir de “${esc(g.name)}”</button>` : ''}`;

  $('#cg').onsubmit = async (ev) => {
    ev.preventDefault();
    const { data, error } = await sb.rpc('create_group', { p_name: ev.target.name.value });
    if (error) return toast(error.message, true);
    state.groupId = data.id; localStorage.setItem('af_group', data.id);
    toast('Grupo creado. ¡Comparte el código! 🎉'); route();
  };
  $('#jg').onsubmit = async (ev) => {
    ev.preventDefault();
    const { data, error } = await sb.rpc('join_group', { p_code: ev.target.code.value });
    if (error) return toast(error.message, true);
    state.groupId = data.id; localStorage.setItem('af_group', data.id);
    toast(`Te uniste a ${data.name} 💪`); route();
  };
  if (!g) return;

  $('#gsel').onchange = (ev) => { state.groupId = ev.target.value; localStorage.setItem('af_group', state.groupId); route(); };
  $$('.tabs button').forEach((b) => (b.onclick = () => { state.groupRange = +b.dataset.r; route(); }));
  $('#share').onclick = async () => {
    const text = `¡Únete a mi grupo "${g.name}" en Amigos Fit! 💪\n1) Entra a ${BASE_URL}\n2) Crea tu cuenta\n3) En Amigos → "Unirme con código": ${g.invite_code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Amigos Fit', text });
      else { await navigator.clipboard.writeText(text); toast('Invitación copiada 📋'); }
    } catch { /* cancelado */ }
  };
  $('#leave').onclick = async () => {
    if (!confirm(`¿Salir del grupo "${g.name}"?`)) return;
    const { error } = await sb.from('group_members').delete().eq('group_id', g.id).eq('user_id', session.user.id);
    if (error) return toast(error.message, true);
    state.groupId = null; localStorage.removeItem('af_group'); route();
  };

  const to = C.isoDate();
  const from = C.addDays(to, -(state.groupRange - 1));
  const [lb, series] = await Promise.all([
    sb.rpc('group_leaderboard', { gid: g.id, p_from: from, p_to: to }),
    sb.rpc('group_weight_series', { gid: g.id, p_from: C.addDays(to, -89), p_to: to }),
  ]);
  if (lb.error) { $('#board').innerHTML = `<p class="err">${esc(lb.error.message)}</p>`; return; }
  const rows = lb.data || [];

  // Reconocimientos (no solo kilos)
  const best = (fn) => { let top = null; rows.forEach((r) => { const v = fn(r); if (v != null && v > 0 && (!top || v > top.v)) top = { r, v }; }); return top?.r.user_id; };
  const progressPct = (r) => {
    if (!r.start_weight || !r.current_weight) return null;
    const ch = ((r.current_weight - r.start_weight) / r.start_weight) * 100;
    const dr = C.weightDirection(r.goal);
    return dr === 'down' ? -ch : dr === 'up' ? ch : -Math.abs(ch);
  };
  const awards = {
    [best((r) => r.days_logged)]: ['🔥 Más constante'],
  };
  const add = (uid, label) => { if (!uid) return; (awards[uid] ||= []).push(label); };
  add(best((r) => r.protein_ok_days), '🥩 Rey/Reina de la proteína');
  add(best((r) => r.kcal_ok_days), '🎯 Más precisión calórica');
  add(best((r) => r.activity_min), '🏃 Más activo/a');
  add(best((r) => (C.weightDirection(r.goal) === 'stable' ? null : progressPct(r))), '📈 Mayor avance vs su inicio');
  delete awards.undefined;

  const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  const mini = (label, v, max, txt, color = 'var(--accent)') => `<div class="mini"><span class="muted">${label}</span>
    <div class="bar"><i style="width:${Math.min(100, pct(v, max))}%;background:${color}"></i></div><span>${txt}</span></div>`;

  $('#board').innerHTML = `<h2>🏆 Ranking — ${state.groupRange} días</h2>` + rows.map((r, i) => {
    const pp = progressPct(r);
    const ch = r.start_weight && r.current_weight ? r1(r.current_weight - r.start_weight) : null;
    const actGoal = Math.round((r.activity_goal_min * r.days_in_range) / 7);
    return `<div class="leader">
      <div class="pos">${medal(i)}</div>
      <div class="body">
        <div class="row between"><div><b>${esc(r.display_name)}</b>${r.user_id === session.user.id ? ' <span class="small muted">(tú)</span>' : ''}
          <div class="small muted">Objetivo: ${GOAL_SHORT[r.goal] || '—'}${ch != null ? ` · ${ch > 0 ? '+' : ''}${String(ch).replace('.', ',')} kg desde el inicio` : ''}</div></div>
          <div class="score">${r.score}</div></div>
        ${mini('Constancia', r.days_logged, r.days_in_range, `${r.days_logged}/${r.days_in_range} d`)}
        ${mini('Calorías ok', r.kcal_ok_days, r.days_in_range, `${r.kcal_ok_days} d`, COLORS.kcal)}
        ${mini('Proteína ok', r.protein_ok_days, r.days_in_range, `${r.protein_ok_days} d`, COLORS.prot)}
        ${mini('Actividad', r.activity_min, actGoal, `${r.activity_min} min`, COLORS.carb)}
        ${pp != null && C.weightDirection(r.goal) !== 'stable' ? mini('Avance peso', Math.max(0, pp), 10, `${ch > 0 ? '+' : ''}${String(r1(ch / r.start_weight * 100)).replace('.', ',')}%`, COLORS.fat) : ''}
        ${awards[r.user_id] ? `<div class="chips">${awards[r.user_id].map((a) => `<span class="chip">${a}</span>`).join('')}</div>` : ''}
      </div></div>`;
  }).join('') + (rows.length === 1 ? '<p class="small muted">¡Invita a tus amigos para empezar a comparar!</p>' : '');

  // gráfico de % de cambio de peso
  const ser = series.data || [];
  const people = [...new Map(ser.map((x) => [x.user_id, x.display_name])).entries()];
  const allDates = [...new Set(ser.map((x) => x.log_date))].sort();
  chart($('#cGroup'), {
    type: 'line',
    data: {
      labels: allDates.map(shortDate),
      datasets: people.map(([uid, name], i) => ({
        label: name, spanGaps: true, tension: 0.3, pointRadius: 3,
        borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length],
        data: allDates.map((d) => { const p = ser.find((x) => x.user_id === uid && x.log_date === d); return p ? +p.pct_change : null; }),
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor(), boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y > 0 ? '+' : ''}${c.parsed.y}%` } } },
      scales: { x: { grid: { display: false }, ticks: { color: tickColor(), maxTicksLimit: 8 } }, y: { grid: { color: gridColor() }, ticks: { color: tickColor(), callback: (v) => v + '%' } } },
    },
  });
}

init();
