-- =====================================================================
-- Migración 015 — macros día a día de cada miembro (para el calendario de cumplimiento)
-- Meta de calorías del día: fija en modo 'average'; en modo dinámico = meta base + entreno del día − entreno promedio.
-- Solo agregados por día: nunca se exponen comidas ni fotos.
-- =====================================================================
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
  round(case when m.target_mode = 'average' then m.kcal_target
             else m.kcal_target + coalesce(ex.kc, 0) - k.avg_train end)::int,
  m.protein_g, m.carbs_g, m.fat_g
from m join kpm k on k.id = m.id
join d on d.user_id = m.id
left join ex on ex.user_id = d.user_id and ex.log_date = d.log_date
order by m.display_name, d.log_date;
$$;
grant execute on function public.group_daily_macros(uuid, date, date) to authenticated;
