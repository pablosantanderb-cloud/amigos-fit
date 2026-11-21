-- =====================================================================
-- Migración 021 — "Macros vs el objetivo de cada uno" usa la meta de CADA DÍA
-- (la misma del ranking y del calendario: reloj, entrenos y meta manual) y no cuenta
-- el día de hoy, que todavía está incompleto. Los carbos objetivo se ajustan a la meta del día.
-- =====================================================================
drop function if exists public.group_macros(uuid, date, date);
create or replace function public.group_macros(gid uuid, p_from date, p_to date)
returns table (
  user_id uuid, display_name text, days_logged int,
  avg_kcal numeric, avg_protein numeric, avg_carbs numeric, avg_fat numeric,
  kcal_target int, protein_target int, carbs_target int, fat_target int
) language sql stable security definer set search_path = public as $$
  with m as (
    select p.* from group_members gm join profiles p on p.id = gm.user_id
    where gm.group_id = gid and public.is_member(gid)
  ),
  dd as (
    select * from public.group_daily_macros(gid, p_from, least(p_to, (now() at time zone 'America/Santiago')::date - 1))
  )
  select m.id, m.display_name, count(dd.log_date)::int,
    round(avg(dd.kcal)), round(avg(dd.protein)), round(avg(dd.carbs)), round(avg(dd.fat)),
    coalesce(round(avg(dd.kcal_target)), m.kcal_target)::int,
    m.protein_g,
    coalesce(round(avg(case when coalesce(m.carbs_manual, 0) > 0 then m.carbs_manual
      else greatest(0, (dd.kcal_target - m.protein_g * 4 - m.fat_g * 9) / 4.0) end)), m.carbs_g)::int,
    m.fat_g
  from m left join dd on dd.user_id = m.id
  group by m.id, m.display_name, m.kcal_target, m.protein_g, m.carbs_g, m.fat_g, m.carbs_manual
  order by m.display_name;
$$;
grant execute on function public.group_macros(uuid, date, date) to authenticated;
