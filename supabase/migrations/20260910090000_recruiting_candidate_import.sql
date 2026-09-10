-- Recruiting candidate import: one transactional RPC serves every import
-- source (paste, manual, CSV, sourcing pull). Purely additive; no existing
-- table, view, function or grant is modified.
begin;

-- Bulk version of upsert_candidate + add_candidates_to_role. The two single-
-- row RPCs stay for other callers; this one exists because a batch cannot
-- afford to abort on the first malformed row the way upsert_candidate does.
-- Invalid rows are skipped and counted, never raised, so a 200-row paste with
-- a handful of bad entries still imports everything good.
create function private.import_candidates(p_client uuid,p_role uuid,p_rows jsonb,p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 r jsonb; e jsonb; f jsonb; k text; v text; ok boolean; n_ident integer;
 v_ids uuid[]; v_candidate uuid; v_role_candidate uuid; v_existed boolean;
 n_created integer:=0; n_matched integer:=0; n_already_in_role integer:=0; n_invalid integer:=0;
begin
 perform private.require_admin(auth.uid());
 if p_source is null or p_source not in ('linkedin','naukri','manual','url_paste','csv','sourcing_import','other') then
  raise exception 'LS: Unsupported candidate source.'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then
  raise exception 'LS: Import between 1 and 200 candidates at a time.'; end if;
 -- Client, then role: the same lock order as add_candidates_to_role, so a
 -- concurrent import into the same role serializes instead of racing on the
 -- role_candidates uniqueness constraint below.
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding candidates.'; end if;

 <<rows>>
 for r in select * from jsonb_array_elements(p_rows) loop
  f:=coalesce(r->'fields','{}'::jsonb);
  if r->>'name' is null or length(trim(r->>'name'))=0 or length(r->>'name')>200 or jsonb_typeof(f)<>'object' then
   n_invalid:=n_invalid+1; continue rows; end if;
  if r->'identities' is null or jsonb_typeof(r->'identities')<>'array'
   or jsonb_array_length(r->'identities') not between 1 and 10 then
   n_invalid:=n_invalid+1; continue rows; end if;
  -- Same per-identity validation as upsert_candidate, but a bad identity
  -- fails only this row, not the batch.
  ok:=true; n_ident:=0;
  for e in select * from jsonb_array_elements(r->'identities') loop
   k:=e->>'kind'; v:=e->>'value';
   if k is null or k not in ('linkedin','naukri','email','phone','external') then ok:=false; exit; end if;
   if v is null or length(v) not between 1 and 500 then ok:=false; exit; end if;
   if k='linkedin' and v !~ '^https://www[.]linkedin[.]com/in/[^/?#[:space:]]+$' then ok:=false; exit; end if;
   if k='email' and v !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then ok:=false; exit; end if;
   if k in ('linkedin','naukri','email','external') then n_ident:=n_ident+1; end if;
  end loop;
  if not ok or n_ident=0 then n_invalid:=n_invalid+1; continue rows; end if;

  -- Resolve by identity, same ambiguity guard as upsert_candidate: a row
  -- whose identities span two existing candidates is skipped, not merged.
  select array_agg(distinct i.candidate_id) into v_ids
   from public.candidate_identities i
   join jsonb_array_elements(r->'identities') x
    on x.value->>'kind'=i.kind and x.value->>'value'=i.normalized_value
   where i.kind in ('linkedin','naukri','email','external');
  if coalesce(array_length(v_ids,1),0)>1 then n_invalid:=n_invalid+1; continue rows; end if;
  v_candidate:=v_ids[1];

  if v_candidate is null then
   insert into public.candidates(full_name,headline,current_company,current_designation,location,
    total_experience_years,phone,email,created_by)
    values(trim(r->>'name'),coalesce(f->>'headline',''),coalesce(f->>'currentCompany',''),
     coalesce(f->>'currentDesignation',''),coalesce(f->>'location',''),
     (f->>'totalExperienceYears')::numeric,nullif(f->>'phone',''),nullif(f->>'email',''),auth.uid())
    returning id into v_candidate;
   n_created:=n_created+1;
  else
   -- Never overwrite reusable contact data with a blank from a thinner row.
   update public.candidates set
    headline=case when coalesce(f->>'headline','')='' then headline else f->>'headline' end,
    current_company=case when coalesce(f->>'currentCompany','')='' then current_company else f->>'currentCompany' end,
    current_designation=case when coalesce(f->>'currentDesignation','')='' then current_designation else f->>'currentDesignation' end,
    location=case when coalesce(f->>'location','')='' then location else f->>'location' end,
    total_experience_years=coalesce((f->>'totalExperienceYears')::numeric,total_experience_years),
    phone=coalesce(nullif(f->>'phone',''),phone), email=coalesce(nullif(f->>'email',''),email),
    updated_at=now() where id=v_candidate;
   n_matched:=n_matched+1;
  end if;

  insert into public.candidate_identities(candidate_id,kind,normalized_value)
   select distinct v_candidate,x.value->>'kind',x.value->>'value' from jsonb_array_elements(r->'identities') x
   where not exists(select 1 from public.candidate_identities c
    where c.candidate_id=v_candidate and c.kind=x.value->>'kind' and c.normalized_value=x.value->>'value')
   on conflict do nothing;

  select exists(select 1 from public.role_candidates where role_id=p_role and candidate_id=v_candidate) into v_existed;
  if v_existed then
   n_already_in_role:=n_already_in_role+1;
  else
   v_role_candidate:=null;
   insert into public.role_candidates(client_id,role_id,candidate_id,source)
    values(p_client,p_role,v_candidate,p_source)
    on conflict(role_id,candidate_id) do nothing
    returning id into v_role_candidate;
   if v_role_candidate is not null then
    insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,actor,detail)
     values(p_client,v_role_candidate,'import','all_profiles',auth.uid(),
      jsonb_build_object('source',p_source,'candidateId',v_candidate));
   end if;
  end if;
 end loop;

 return jsonb_build_object('created',n_created,'matchedExisting',n_matched,
  'alreadyInRole',n_already_in_role,'invalid',n_invalid);
end $$;

create function public.import_candidates(p_client uuid,p_role uuid,p_rows jsonb,p_source text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.import_candidates(p_client,p_role,p_rows,p_source);
$$;
do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname='import_candidates' loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
