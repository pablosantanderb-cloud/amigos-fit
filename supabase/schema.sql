-- =====================================================================
-- AMIGOS FIT — esquema de base de datos (Supabase / PostgreSQL)
-- Pegar completo en Supabase → SQL Editor → Run. Es idempotente.
-- =====================================================================

-- ---------- PERFILES ----------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users on delete cascade,
  display_name          text not null default '',
  sex                   text check (sex in ('M','F')),
  age                   int  check (age between 12 and 100),
  birth_date            date,
  height_cm             numeric check (height_cm between 100 and 250),
  weight_kg             numeric check (weight_kg between 30 and 300),
  start_weight_kg       numeric,
  target_weight_kg      numeric,
  activity_level        text check (activity_level in ('sedentario','ligero','moderado','activo','muy_activo')),
  goal                  text check (goal in ('lose','lose_tone','recomp','maintain','fitness','gain')),
  rate_kg_week          numeric default 0.5 check (rate_kg_week between 0 and 1.5),
  weekly_activity_goal_min int default 150,
  bmr                   int,
  tdee                  int,
  kcal_target           int,
  protein_g             int,
  carbs_g               int,
  fat_g                 int,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- Crea el perfil vacío automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- REGISTROS ----------
create table if not exists public.food_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  log_date    date not null,
  meal        text not null check (meal in ('desayuno','almuerzo','once','cena','snack','colacion','otro')),
  description text not null default '',
  comment     text,
  photo_path  text,
  kcal        numeric not null default 0,
  protein_g   numeric not null default 0,
  carbs_g     numeric not null default 0,
  fat_g       numeric not null default 0,
  items       jsonb,
  ai_confidence text,
  created_at  timestamptz default now()
);
create index if not exists food_logs_user_date on public.food_logs (user_id, log_date);

create table if not exists public.weight_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  log_date    date not null,
  weight_kg   numeric not null check (weight_kg between 30 and 300),
  waist_cm    numeric,
  body_fat_pct numeric,
  created_at  timestamptz default now(),
  unique (user_id, log_date)
);

create table if not exists public.activity_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  log_date    date not null,
  activity    text not null,
  minutes     int not null check (minutes > 0 and minutes <= 1440),
  kcal_burned int,
  steps       int,
  distance_km numeric,
  source      text,
  created_at  timestamptz default now()
);
create index if not exists activity_logs_user_date on public.activity_logs (user_id, log_date);

-- ---------- Modelo de energía: gasto base sin entrenos + crédito de ejercicio + cierre del reloj ----------
alter table public.profiles add column if not exists exercise_credit_pct int default 75;
alter table public.profiles add column if not exists calibration_kcal int default 0;
alter table public.profiles add column if not exists activity_basis text;   -- 'sin_ejercicio' = eligió el nivel con la definición nueva

create table if not exists public.daily_energy (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  log_date     date not null,
  total_kcal   int not null check (total_kcal between 500 and 10000),
  active_kcal  int,
  resting_kcal int,
  source       text,
  created_at   timestamptz default now(),
  unique (user_id, log_date)
);
alter table public.daily_energy enable row level security;
drop policy if exists "solo dueño" on public.daily_energy;
create policy "solo dueño" on public.daily_energy for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.daily_energy to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- Entrenamientos habituales (definen el gasto promedio y la meta fija) ----------
alter table public.profiles add column if not exists training_sessions_week int default 0;
alter table public.profiles add column if not exists training_minutes int default 60;
alter table public.profiles add column if not exists training_intensity text default 'moderada';

-- ---------- Gasto aprendido del reloj ----------
alter table public.profiles add column if not exists learned_tdee int;
alter table public.profiles add column if not exists learned_days int default 0;
alter table public.profiles add column if not exists learned_at date;

-- ---------- Entrenos habituales en dos filas: moderados e intensos ----------
alter table public.profiles add column if not exists train_mod_sessions int;
alter table public.profiles add column if not exists train_mod_minutes int;
alter table public.profiles add column if not exists train_int_sessions int;
alter table public.profiles add column if not exists train_int_minutes int;

-- ---------- GRUPOS ----------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_by  uuid not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);

-- ¿El usuario actual pertenece al grupo? (security definer evita recursión en RLS)
create or replace function public.is_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

-- ¿Comparto algún grupo con este usuario?
create or replace function public.is_groupmate(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from group_members a join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = uid);
$$;

-- ---------- RLS ----------
alter table public.profiles      enable row level security;
alter table public.food_logs     enable row level security;
alter table public.weight_logs   enable row level security;
alter table public.activity_logs enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "perfil propio o de amigos" on public.profiles;
create policy "perfil propio o de amigos" on public.profiles for select
  using (id = auth.uid() or public.is_groupmate(id));
drop policy if exists "editar perfil propio" on public.profiles;
create policy "editar perfil propio" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "crear perfil propio" on public.profiles;
create policy "crear perfil propio" on public.profiles for insert
  with check (id = auth.uid());

-- Los registros detallados son privados: solo el dueño. Los amigos ven agregados vía RPC.
do $$
declare t text;
begin
  foreach t in array array['food_logs','weight_logs','activity_logs'] loop
    execute format('drop policy if exists "solo dueño" on public.%I', t);
    execute format('create policy "solo dueño" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

drop policy if exists "ver mis grupos" on public.groups;
create policy "ver mis grupos" on public.groups for select using (public.is_member(id));
drop policy if exists "editar grupo propio" on public.groups;
create policy "editar grupo propio" on public.groups for update using (created_by = auth.uid());
drop policy if exists "borrar grupo propio" on public.groups;
create policy "borrar grupo propio" on public.groups for delete using (created_by = auth.uid());

drop policy if exists "ver miembros de mis grupos" on public.group_members;
create policy "ver miembros de mis grupos" on public.group_members for select using (public.is_member(group_id));
drop policy if exists "salir de un grupo" on public.group_members;
create policy "salir de un grupo" on public.group_members for delete using (user_id = auth.uid());

-- ---------- RPC: crear / unirse a grupo ----------
create or replace function public.create_group(p_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  insert into groups (name, created_by) values (trim(p_name), auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

create or replace function public.join_group(p_code text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  select * into g from groups where invite_code = upper(trim(p_code));
  if g.id is null then raise exception 'Código de invitación no válido'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end $$;

-- ---------- RPC: ranking del grupo ----------
-- Puntaje 0-100 que premia CONSTANCIA y CUMPLIMIENTO, no solo kilos:
--   30% constancia (días con registro) · 25% calorías dentro de ±10% de la meta del día (ajustada por entreno)
--   20% proteína ≥ 90% de la meta · 15% minutos de actividad vs meta semanal
--   10% tendencia del peso en la dirección de su propio objetivo
drop function if exists public.group_leaderboard(uuid, date, date);
create or replace function public.group_leaderboard(gid uuid, p_from date, p_to date)
returns table (
  user_id uuid, display_name text, goal text, days_in_range int, days_logged int,
  kcal_ok_days int, protein_ok_days int, avg_kcal numeric, kcal_target int, protein_target int,
  activity_min int, activity_goal_min int, start_weight numeric, ref_weight numeric,
  current_weight numeric, score int
) language sql stable security definer set search_path = public as $$
with m as (
  select p.* from group_members gm join profiles p on p.id = gm.user_id
  where gm.group_id = gid and public.is_member(gid)
),
n as (select greatest(1, (p_to - p_from) + 1)::int as days),
d as (
  select f.user_id, f.log_date, sum(f.kcal) kcal, sum(f.protein_g) prot
  from food_logs f
  where f.user_id in (select id from m) and f.log_date between p_from and p_to
  group by 1, 2
),

-- kcal por minuto de entreno según intensidad habitual y peso (igual que la app)
kpm as (
  select m.id, 3.5 * coalesce(m.weight_kg, 70) / 200.0 as f,
    -- promedio diario de entrenos habituales: moderados (MET 6) + intensos (MET 9)
    (coalesce(m.train_mod_sessions, 0) * coalesce(m.train_mod_minutes, 0) * 5
     + coalesce(m.train_int_sessions, 0) * coalesce(m.train_int_minutes, 0) * 8) * 3.5 * coalesce(m.weight_kg, 70) / 200.0 / 7.0 as avg_train
  from m
),
ex as (  -- entreno de cada día: % de las kcal del reloj o estimado por minutos
  select a.user_id, a.log_date,
    sum(case when coalesce(a.kcal_burned, 0) > 0 then a.kcal_burned * coalesce(m.exercise_credit_pct, 75) / 100.0
             else a.minutes * k.f * (case
               when a.activity ~* '(f[uú]tbol|nata|corr|running|crossfit|hiit|spinning|p[aá]del|tenis|box|squash|b[aá]squet|rugby|trek|escal)' then 8
               when a.activity ~* '(camin|yoga|pilates|estir|movilidad)' then 3
               else 5 end) end) kc
  from activity_logs a join m on m.id = a.user_id join kpm k on k.id = a.user_id
  where a.log_date between p_from and p_to
  group by 1, 2
),
agg as (
  select m.id,
    count(d.log_date)::int as days_logged,
    -- meta del día = meta base + (entreno del día − entreno promedio habitual), igual que en la app
    (count(*) filter (where m.kcal_target > 0 and d.kcal between
        (m.kcal_target + coalesce(ex.kc, 0) - k.avg_train) * 0.9 and
        (m.kcal_target + coalesce(ex.kc, 0) - k.avg_train) * 1.1))::int as kcal_ok,
    (count(*) filter (where m.protein_g > 0 and d.prot >= m.protein_g * 0.9))::int as prot_ok,
    round(avg(d.kcal))::numeric as avg_kcal
  from m join kpm k on k.id = m.id
  left join d on d.user_id = m.id
  left join ex on ex.user_id = d.user_id and ex.log_date = d.log_date
  group by m.id
),
act as (
  select a.user_id, sum(a.minutes)::int as mins
  from activity_logs a
  where a.user_id in (select id from m) and a.log_date between p_from and p_to
  group by 1
),
w as (
  select m.id,
    (select weight_kg from weight_logs x where x.user_id = m.id and x.log_date <= p_to order by log_date desc limit 1) as w_now,
    coalesce(
      (select weight_kg from weight_logs x where x.user_id = m.id and x.log_date < p_from order by log_date desc limit 1),
      (select weight_kg from weight_logs x where x.user_id = m.id and x.log_date between p_from and p_to order by log_date asc limit 1)
    ) as w_ref
  from m
),
s as (
  select m.id, m.display_name, m.goal, n.days, agg.days_logged, agg.kcal_ok, agg.prot_ok, agg.avg_kcal,
    m.kcal_target, m.protein_g, coalesce(act.mins, 0) as mins, coalesce(m.weekly_activity_goal_min, 150) as act_goal,
    m.start_weight_kg, w.w_ref, w.w_now,
    case
      when w.w_ref is null or w.w_now is null or w.w_ref = w.w_now and m.goal in ('lose','lose_tone','gain') then 0.5
      when m.goal in ('lose','lose_tone') then case when w.w_now < w.w_ref then 1 else 0 end
      when m.goal = 'gain'  then case when w.w_now > w.w_ref then 1 else 0 end
      else case when abs(w.w_now - w.w_ref) / w.w_ref <= 0.01 then 1 else 0.5 end
    end as wscore
  from m cross join n
  join agg on agg.id = m.id
  join w on w.id = m.id
  left join act on act.user_id = m.id
)
select id, display_name, goal, days, days_logged, kcal_ok, prot_ok, avg_kcal, kcal_target, protein_g,
  mins, act_goal, start_weight_kg, w_ref, w_now,
  round(100 * (
      0.30 * days_logged::numeric / days
    + 0.25 * kcal_ok::numeric / days
    + 0.20 * prot_ok::numeric / days
    + 0.15 * least(1, mins::numeric / greatest(1, act_goal * days / 7.0))
    + 0.10 * wscore
  ))::int as score
from s
order by score desc, display_name;
$$;

-- Serie de peso de cada miembro como % de cambio respecto de SU peso inicial
drop function if exists public.group_weight_series(uuid, date, date);
create or replace function public.group_weight_series(gid uuid, p_from date, p_to date)
returns table (user_id uuid, display_name text, log_date date, pct_change numeric)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, x.log_date,
         round((x.weight_kg - coalesce(p.start_weight_kg, x.weight_kg)) / coalesce(p.start_weight_kg, x.weight_kg) * 100, 2)
  from group_members gm
  join profiles p on p.id = gm.user_id
  join weight_logs x on x.user_id = p.id
  where gm.group_id = gid and public.is_member(gid) and x.log_date between p_from and p_to
  order by x.log_date;
$$;

-- ---------- PERMISOS DE LA DATA API ----------
-- Explícitos, por si el proyecto se creó sin "Automatically expose new tables".
-- Solo el rol "authenticated" (usuarios logueados); RLS sigue filtrando qué filas ve cada uno.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.food_logs, public.weight_logs, public.activity_logs to authenticated;
grant select, update, delete on public.groups to authenticated;
grant select, delete on public.group_members to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_groupmate(uuid) to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.group_leaderboard(uuid, date, date) to authenticated;
grant execute on function public.group_weight_series(uuid, date, date) to authenticated;

-- ---------- STORAGE: fotos de comida (privadas, carpeta por usuario) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-photos', 'food-photos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "fotos: subir propias" on storage.objects;
create policy "fotos: subir propias" on storage.objects for insert to authenticated
  with check (bucket_id = 'food-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "fotos: ver propias" on storage.objects;
create policy "fotos: ver propias" on storage.objects for select to authenticated
  using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "fotos: borrar propias" on storage.objects;
create policy "fotos: borrar propias" on storage.objects for delete to authenticated
  using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = auth.uid()::text);
