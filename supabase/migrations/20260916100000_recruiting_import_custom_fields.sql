-- CSV imports may populate active role-specific fields. Values are checked
-- against the same field types used by inline edits before a candidate enters
-- the role, so a stale or malformed mapping cannot create invalid custom data.
begin;

create or replace function private.import_candidates(p_client uuid,p_role uuid,p_rows jsonb,p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 r jsonb; e jsonb; f jsonb; k text; v text; v_source_detail text; v_custom jsonb;
 v_custom_key text; v_custom_value jsonb; v_field_kind text; v_field_options jsonb;
 ok boolean; n_ident integer; v_custom_valid boolean;
 v_ids uuid[]; v_candidate uuid; v_role_candidate uuid; v_existed boolean;
 n_created integer:=0; n_matched integer:=0; n_already_in_role integer:=0; n_invalid integer:=0;
begin
 perform private.require_admin(auth.uid());
 if p_source is null or p_source not in ('linkedin','naukri','manual','url_paste','csv','sourcing_import','other') then
  raise exception 'LS: Unsupported candidate source.'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then
  raise exception 'LS: Import between 1 and 200 candidates at a time.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding candidates.'; end if;

 <<rows>>
 for r in select * from jsonb_array_elements(p_rows) loop
  f:=coalesce(r->'fields','{}'::jsonb);
  v_custom:=coalesce(r->'custom','{}'::jsonb);
  v_source_detail:=trim(coalesce(r->>'sourceDetail',''));
  if r->>'name' is null or length(trim(r->>'name'))=0 or length(r->>'name')>200
    or jsonb_typeof(f)<>'object' or jsonb_typeof(v_custom)<>'object' or length(v_source_detail)>500 then
   n_invalid:=n_invalid+1; continue rows; end if;
  if r->'identities' is null or jsonb_typeof(r->'identities')<>'array'
   or jsonb_array_length(r->'identities') not between 1 and 10 then
   n_invalid:=n_invalid+1; continue rows; end if;
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

  v_custom_valid:=true;
  for v_custom_key,v_custom_value in select key,value from jsonb_each(v_custom) loop
   select kind,options into v_field_kind,v_field_options from public.role_fields
    where role_id=p_role and key=v_custom_key and not archived;
   if v_field_kind is null then v_custom_valid:=false; exit; end if;
   if v_field_kind='number' and jsonb_typeof(v_custom_value)<>'number' then v_custom_valid:=false; exit; end if;
   if v_field_kind='boolean' and jsonb_typeof(v_custom_value)<>'boolean' then v_custom_valid:=false; exit; end if;
   if v_field_kind in ('text','date','select') and jsonb_typeof(v_custom_value)<>'string' then v_custom_valid:=false; exit; end if;
   if v_field_kind in ('text','date','select') and length(v_custom_value#>>'{}')>2000 then v_custom_valid:=false; exit; end if;
   if v_field_kind='select' and not (v_field_options ? (v_custom_value#>>'{}')) then v_custom_valid:=false; exit; end if;
  end loop;
  if not v_custom_valid then n_invalid:=n_invalid+1; continue rows; end if;

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
   insert into public.role_candidates(client_id,role_id,candidate_id,source,source_detail,custom)
    values(p_client,p_role,v_candidate,p_source,v_source_detail,v_custom)
    on conflict(role_id,candidate_id) do nothing
    returning id into v_role_candidate;
   if v_role_candidate is not null then
    insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,actor,detail)
     values(p_client,v_role_candidate,'import','all_profiles',auth.uid(),
      jsonb_build_object('source',p_source,'sourceDetail',v_source_detail,
       'customKeys',(select coalesce(jsonb_agg(key),'[]'::jsonb) from jsonb_object_keys(v_custom) as keys(key)),
       'candidateId',v_candidate));
   end if;
  end if;
 end loop;

 return jsonb_build_object('created',n_created,'matchedExisting',n_matched,
  'alreadyInRole',n_already_in_role,'invalid',n_invalid);
end $$;

revoke all on function private.import_candidates(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.import_candidates(uuid,uuid,jsonb,text) to authenticated;

commit;
