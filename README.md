# 💪 Amigos Fit

Entrena, aliméntate y progresa junto a tus amigos. App web (funciona en celular, se puede “Agregar a pantalla de inicio”).

## Arquitectura (100% gratis)

| Pieza | Servicio gratuito | Para qué |
|---|---|---|
| Frontend estático (HTML/JS, sin build) | **GitHub Pages** (o Render Static Site / Netlify) | La app |
| Base de datos + login + recuperar contraseña | **Supabase** (plan Free) | Postgres con RLS, Auth por correo, Storage de fotos |
| Análisis de fotos de comida | **Google Gemini API** (capa gratuita) vía **Supabase Edge Function** | Estima kcal y macros desde la foto + comentario |

```
index.html, css/, js/          → frontend
  js/calc.js                   → Mifflin-St Jeor, GET, déficit, macros
  js/app.js                    → vistas: login, perfil, hoy, registrar, progreso, amigos
  js/config.js                 → URL + anon key de Supabase (completar)
supabase/schema.sql            → tablas, RLS, ranking del grupo, bucket de fotos
supabase/functions/analyze-food/index.ts → llamada a Gemini (la API key queda en el servidor)
dev/                           → mock para probar la UI sin backend
```

## Puesta en marcha (≈ 20 min)

### 1. Supabase
1. Crear cuenta y proyecto en https://supabase.com (plan Free, región São Paulo).
2. **SQL Editor → New query** → pegar todo `supabase/schema.sql` → **Run**.
3. **Project Settings → API**: copiar `Project URL` y la `anon public` key en `js/config.js`.

### 2. Clave de Gemini (gratis)
1. https://aistudio.google.com/apikey → **Create API key**.
2. En Supabase: **Edge Functions → Secrets** → agregar `GEMINI_API_KEY` = la clave.
   (Opcional: `GEMINI_MODEL` para cambiar de modelo; por defecto `gemini-2.5-flash`.)

### 3. Función de análisis de fotos
En Supabase: **Edge Functions → Deploy a new function → Via Editor** → nombre `analyze-food` → pegar
`supabase/functions/analyze-food/index.ts` → **Deploy**. En *Settings* de la función, desactivar *Verify JWT with legacy secret*: la función valida al usuario en su propio código.

### 4. Publicar la web
1. Subir esta carpeta a un repositorio de GitHub.
2. **Settings → Pages → Deploy from a branch → main / (root)**. Queda en `https://<usuario>.github.io/amigos-fit/`.

### 5. Configurar correos de Auth
En Supabase **Authentication → URL Configuration**:
- **Site URL** = la URL de la app (ej. `https://<usuario>.github.io/amigos-fit/`)
- **Redirect URLs** = la misma URL.

Así funcionan los links de confirmación de cuenta y de **recuperar contraseña**.

> ⚠️ El correo integrado de Supabase permite muy pocos envíos por hora (pensado para pruebas).
> Para uso real conectar un SMTP gratuito en **Authentication → Emails → SMTP Settings**
> (ej. Resend: 3.000 correos/mes gratis, host `smtp.resend.com`, puerto 465, usuario `resend`, contraseña = API key).
> Ahí también se pueden traducir las plantillas de correo al español.

## Cómo funciona

- **Plan personal**: TMB (Mifflin-St Jeor) × factor de actividad (1,2–1,9) = GET. Bajar: déficit = ritmo × 7.700/7
  (300–1.000 kcal, nunca bajo el TMB ni 1.200/1.500 kcal). Subir: superávit 150–500 kcal.
  Proteína 2,0 / 1,6 / 1,8 g/kg (bajar / mantener / subir), grasa 25 % kcal, carbohidratos el resto.
  Al registrar un peso nuevo las metas se recalculan.
- **Registro por foto**: la foto se reduce a 1024 px en el celular, la Edge Function la envía a Gemini junto al
  comentario (que tiene prioridad), y el resultado es editable antes de guardar. También se puede ingresar a mano.
- **Privacidad**: fotos y detalle de comidas solo los ve su dueño (RLS). Los amigos ven solo indicadores agregados.
- **Ranking del grupo** (0–100): 30 % constancia, 25 % días en meta calórica (±10 %), 20 % días con proteína ≥ 90 %,
  15 % actividad vs meta semanal, 10 % peso yendo en la dirección de *su* objetivo. El gráfico de peso del grupo usa
  % de cambio desde el punto de partida de cada uno.

## Límites de los planes gratuitos
- Supabase Free: 500 MB de BD, 1 GB de fotos (~10.000 fotos), 500 mil llamadas a funciones/mes.
  **El proyecto se pausa tras 7 días sin uso** (se reactiva desde el panel).
- Gemini gratis: límite de solicitudes por minuto/día (de sobra para un grupo de amigos). En la capa gratuita
  Google puede usar los datos enviados para mejorar sus productos.

## Correos en español con el logo
Supabase → **Authentication → Emails → Templates**:
- *Confirm signup* → Subject `Confirma tu cuenta de Amigos Fit` → pegar `supabase/email-templates/confirmar-cuenta.html`
- *Reset password* → Subject `Restablece tu contraseña de Amigos Fit` → pegar `supabase/email-templates/recuperar-contrasena.html`
