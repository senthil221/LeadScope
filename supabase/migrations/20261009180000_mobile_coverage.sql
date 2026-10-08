-- How well each mobile lookup source has done, for the Credits page.
--
-- Every lookup records, step by step, which source it asked and how many
-- numbers that source returned. Summed over a period this says which tool
-- finds numbers most often, which one finds the people the others missed,
-- and how often a number was already on file and cost nothing.
begin;

create function private.mobile_coverage(p_days integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since timestamptz := case when p_days is null then '-infinity'::timestamptz else now() - make_interval(days => greatest(1, least(p_days, 3650))) end;
begin
 perform private.require_admin(auth.uid());
 return jsonb_build_object(
  'since', case when p_days is null then null else since end,
  'lookups', (select jsonb_build_object(
     'total', count(*),
     'found', count(*) filter (where status = 'complete'),
     'none', count(*) filter (where status = 'no_mobile'),
     'failed', count(*) filter (where status in ('failed','needs_review','cancelled')),
     'pending', count(*) filter (where status in ('queued','running','waiting','waiting_setup')))
   from public.mobile_waterfall_jobs where created_at >= since),
  'providers', coalesce((select jsonb_agg(row order by ord) from (
     select s->>'provider' as provider,
      case s->>'provider' when 'database' then 0 when 'signalhire' then 1 when 'apollo' then 2 else 3 end as ord,
      count(*) filter (where s->>'outcome' = 'checked') as checked,
      count(*) filter (where s->>'outcome' = 'checked' and coalesce((s->>'count')::int, 0) > 0) as found,
      coalesce(sum((s->>'count')::int) filter (where s->>'outcome' = 'checked'), 0) as numbers,
      count(*) filter (where s->>'outcome' = 'error') as errors
     from public.mobile_waterfall_jobs j, jsonb_array_elements(j.steps) s
     where j.created_at >= since and s->>'provider' in ('database','signalhire','apollo','bettercontact')
     group by s->>'provider') row), '[]'::jsonb)
 );
end $$;
create function public.mobile_coverage(p_days integer) returns jsonb language sql stable security invoker set search_path='' as $$ select private.mobile_coverage(p_days); $$;
revoke all on function private.mobile_coverage(integer), public.mobile_coverage(integer) from public, anon, authenticated;
grant execute on function private.mobile_coverage(integer), public.mobile_coverage(integer) to authenticated;
notify pgrst, 'reload schema';
commit;
