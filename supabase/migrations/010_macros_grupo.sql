-- =====================================================================
-- Migración 010 — comparación de macros del grupo
-- Promedio diario de lo comido (solo días con registro) vs las metas de cada miembro.
-- Solo agregados: nunca se exponen comidas ni fotos.
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
  d as (
    select f.user_id, f.log_date, sum(f.kcal) k, sum(f.protein_g) pr, sum(f.carbs_g) c, sum(f.fat_g) fa
    from food_logs f
    where f.user_id in (select id from m) and f.log_date between p_from and p_to
    group by 1, 2
  )
  select m.id, m.display_name, count(d.log_date)::int,
    round(avg(d.k)), round(avg(d.pr)), round(avg(d.c)), round(avg(d.fa)),
    m.kcal_target, m.protein_g, m.carbs_g, m.fat_g
  from m left join d on d.user_id = m.id
  group by m.id, m.display_name, m.kcal_target, m.protein_g, m.carbs_g, m.fat_g
  order by m.display_name;
$$;
grant execute on function public.group_macros(uuid, date, date) to authenticated;
