-- =====================================================================
-- Migración 016 — meta de calorías puesta a mano para un día
-- Se guarda en daily_energy.kcal_target_manual; si existe, manda sobre la meta automática
-- (en la app, en el ranking y en el calendario día a día).
-- =====================================================================
alter table public.daily_energy add column if not exists kcal_target_manual int;
alter table public.daily_energy drop constraint if exists daily_energy_kcal_target_manual_check;
alter table public.daily_energy add constraint daily_energy_kcal_target_manual_check
  check (kcal_target_manual is null or kcal_target_manual between 800 and 8000);

-- ---------- ranking del grupo (igual que 009, pero respeta la meta manual del día)
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
        coalesce(de.kcal_target_manual, (case when m.target_mode = 'average' then m.kcal_target else m.kcal_target + coalesce(ex.kc, 0) - k.avg_train end)) * 0.9 and
        coalesce(de.kcal_target_manual, (case when m.target_mode = 'average' then m.kcal_target else m.kcal_target + coalesce(ex.kc, 0) - k.avg_train end)) * 1.1))::int as kcal_ok,
    (count(*) filter (where m.protein_g > 0 and d.prot >= m.protein_g * 0.9))::int as prot_ok,
    round(avg(d.kcal))::numeric as avg_kcal
  from m join kpm k on k.id = m.id
  left join d on d.user_id = m.id
  left join ex on ex.user_id = d.user_id and ex.log_date = d.log_date
  left join daily_energy de on de.user_id = d.user_id and de.log_date = d.log_date
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

-- ---------- macros día a día (igual que 015, respeta la meta manual)
drop function if exists public.group_daily_macros(uuid, date, date);
create or replace function public.group_daily_macros(gid uuid, p_from date, p_to date)
returns table (
  user_id uuid, display_name text, log_date date,
  kcal numeric, protein numeric, carbs numeric, fat numeric,
  kcal_target int, protein_target int, carbs_target int, fat_target int
) language sql stable security definer set search_path = public as $$
with m as (
  select p.* from group_members gm join profiles p on p.id = gm.user_id
  where gm.group_id = gid and public.is_member(gid)
),
kpm as (
  select m.id, 3.5 * coalesce(m.weight_kg, 70) / 200.0 as f,
    (coalesce(m.train_mod_sessions, 0) * coalesce(m.train_mod_minutes, 0) * 5
     + coalesce(m.train_int_sessions, 0) * coalesce(m.train_int_minutes, 0) * 8) * 3.5 * coalesce(m.weight_kg, 70) / 200.0 / 7.0 as avg_train
  from m
),
ex as (
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
d as (
  select f.user_id, f.log_date, sum(f.kcal) k, sum(f.protein_g) pr, sum(f.carbs_g) c, sum(f.fat_g) fa
  from food_logs f
  where f.user_id in (select id from m) and f.log_date between p_from and p_to
  group by 1, 2
)
select m.id, m.display_name, d.log_date, round(d.k), round(d.pr), round(d.c), round(d.fa),
  coalesce(de.kcal_target_manual, round(case when m.target_mode = 'average' then m.kcal_target
             else m.kcal_target + coalesce(ex.kc, 0) - k.avg_train end))::int,
  m.protein_g, m.carbs_g, m.fat_g
from m join kpm k on k.id = m.id
join d on d.user_id = m.id
left join ex on ex.user_id = d.user_id and ex.log_date = d.log_date
left join daily_energy de on de.user_id = d.user_id and de.log_date = d.log_date
order by m.display_name, d.log_date;
$$;
grant execute on function public.group_daily_macros(uuid, date, date) to authenticated;
