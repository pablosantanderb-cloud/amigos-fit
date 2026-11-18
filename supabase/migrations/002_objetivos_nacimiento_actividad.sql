-- =====================================================================
-- Migración 002 — fecha de nacimiento, más objetivos, actividad desde el reloj
-- Pegar en Supabase → SQL Editor → Run (solo afecta al proyecto amigos-fit).
-- =====================================================================
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles drop constraint if exists profiles_goal_check;
alter table public.profiles add constraint profiles_goal_check
  check (goal in ('lose','lose_tone','recomp','maintain','fitness','gain'));

alter table public.food_logs drop constraint if exists food_logs_meal_check;
alter table public.food_logs add constraint food_logs_meal_check
  check (meal in ('desayuno','almuerzo','once','cena','snack','colacion','otro'));

alter table public.activity_logs add column if not exists steps int;
alter table public.activity_logs add column if not exists distance_km numeric;
alter table public.activity_logs add column if not exists source text;

-- ---------- RPC: ranking del grupo ----------
-- Puntaje 0-100 que premia CONSTANCIA y CUMPLIMIENTO, no solo kilos:
--   30% constancia (días con registro) · 25% calorías dentro de ±10% de la meta
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
agg as (
  select m.id,
    count(d.log_date)::int as days_logged,
    (count(*) filter (where m.kcal_target > 0 and d.kcal between m.kcal_target * 0.9 and m.kcal_target * 1.1))::int as kcal_ok,
    (count(*) filter (where m.protein_g > 0 and d.prot >= m.protein_g * 0.9))::int as prot_ok,
    round(avg(d.kcal))::numeric as avg_kcal
  from m left join d on d.user_id = m.id
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

grant execute on function public.group_leaderboard(uuid, date, date) to authenticated;
