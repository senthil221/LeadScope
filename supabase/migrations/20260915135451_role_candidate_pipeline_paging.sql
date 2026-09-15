-- Keep role pipeline tabs bounded as a role grows. The existing index starts
-- with client_id, while the role screen predicates by role and stage.
create index role_candidates_role_stage_entered
 on public.role_candidates(role_id,stage,stage_entered_at desc,id);

-- Counts come from the database rather than loading every membership row into
-- the server just to count stages. SECURITY INVOKER leaves the existing RLS
-- policy as the authorization boundary for every returned row.
create function public.role_candidate_stage_counts(p_role uuid)
returns table(stage text,candidate_count integer)
language sql stable security invoker set search_path = '' as $$
 select stage,count(*)::integer
 from public.role_candidates
 where role_id=p_role
 group by stage;
$$;

revoke all on function public.role_candidate_stage_counts(uuid) from public;
revoke all on function public.role_candidate_stage_counts(uuid) from anon;
grant execute on function public.role_candidate_stage_counts(uuid) to authenticated;
