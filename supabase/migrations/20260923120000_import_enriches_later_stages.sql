-- An import into a later stage no longer creates anybody.
--
-- Letting a spreadsheet drop new people straight into Client shortlisted put
-- profiles into stages nobody had worked them through. So: All profiles is the
-- only door in. Import there and new people are created and added. Import into
-- any later stage and it updates the people already on that role and skips
-- everyone else.
--
-- Details still reach every stage, because the detail columns live on the
-- shared public.candidates row rather than on the role membership. Updating
-- someone from the Recruiter shortlisted tab updates the person, so the new
-- value shows wherever that person appears, in this role and in every other.
begin;

drop function if exists public.import_candidates(uuid,uuid,jsonb,text,text);
drop function if exists private.import_candidates(uuid,uuid,jsonb,text,text);

create function private.import_candidates(p_client uuid,p_role uuid,p_rows jsonb,p_source text,p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 r jsonb; e jsonb; f jsonb; k text; v text; v_source_detail text; v_custom jsonb;
 v_custom_key text; v_custom_value jsonb; v_field_kind text; v_field_options jsonb;
 ok boolean; n_ident integer; v_custom_valid boolean; v_adding boolean; v_new_person boolean;
 v_ids uuid[]; v_candidate uuid; v_role_candidate uuid; v_existed boolean;
 n_created integer:=0; n_matched integer:=0; n_already_in_role integer:=0; n_invalid integer:=0;
 n_updated integer:=0; n_skipped integer:=0;
begin
 perform private.require_admin(auth.uid());
 if p_source is null or p_source not in ('linkedin','naukri','manual','url_paste','csv','sourcing_import','other') then
  raise exception 'LS: Unsupported candidate source.'; end if;
 -- Rejected is absent: that stage needs a rejection type and reason, which an
 -- imported row has no way to supply.
 if p_stage is null or p_stage not in
  ('all_profiles','profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent') then
  raise exception 'LS: Choose a pipeline stage to import into.'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 200 then
  raise exception 'LS: Import between 1 and 200 candidates at a time.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding candidates.'; end if;

 -- All profiles is the only stage that admits somebody new.
 v_adding := p_stage = 'all_profiles';

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

  if length(coalesce(f->>'currentCtc',''))>80
   or length(coalesce(f->>'highestQualification',''))>200 then
   n_invalid:=n_invalid+1; continue rows; end if;

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
   -- Nobody by this identity. Only All profiles may create one.
   if not v_adding then n_skipped:=n_skipped+1; continue rows; end if;
   insert into public.candidates(full_name,headline,current_company,current_designation,location,
    total_experience_years,phone,email,current_ctc,highest_qualification,created_by)
    values(trim(r->>'name'),coalesce(f->>'headline',''),coalesce(f->>'currentCompany',''),
     coalesce(f->>'currentDesignation',''),coalesce(f->>'location',''),
     (f->>'totalExperienceYears')::numeric,nullif(f->>'phone',''),nullif(f->>'email',''),
     coalesce(f->>'currentCtc',''),coalesce(f->>'highestQualification',''),auth.uid())
    returning id into v_candidate;
   n_created:=n_created+1;
   v_new_person:=true; v_existed:=false;
  else
   v_new_person:=false;
   select exists(select 1 from public.role_candidates where role_id=p_role and candidate_id=v_candidate)
    into v_existed;
   -- A later stage only updates people already on this role. Someone who
   -- exists elsewhere in the database is left alone rather than pulled in.
   if not v_adding and not v_existed then n_skipped:=n_skipped+1; continue rows; end if;
   update public.candidates set
    headline=case when coalesce(f->>'headline','')='' then headline else f->>'headline' end,
    current_company=case when coalesce(f->>'currentCompany','')='' then current_company else f->>'currentCompany' end,
    current_designation=case when coalesce(f->>'currentDesignation','')='' then current_designation else f->>'currentDesignation' end,
    location=case when coalesce(f->>'location','')='' then location else f->>'location' end,
    total_experience_years=coalesce((f->>'totalExperienceYears')::numeric,total_experience_years),
    phone=coalesce(nullif(f->>'phone',''),phone), email=coalesce(nullif(f->>'email',''),email),
    current_ctc=case when coalesce(f->>'currentCtc','')='' then current_ctc else f->>'currentCtc' end,
    highest_qualification=case when coalesce(f->>'highestQualification','')='' then highest_qualification else f->>'highestQualification' end,
    updated_at=now() where id=v_candidate;
   if not v_adding then n_updated:=n_updated+1; end if;
  end if;

  insert into public.candidate_identities(candidate_id,kind,normalized_value)
   select distinct v_candidate,x.value->>'kind',x.value->>'value' from jsonb_array_elements(r->'identities') x
   where not exists(select 1 from public.candidate_identities c
    where c.candidate_id=v_candidate and c.kind=x.value->>'kind' and c.normalized_value=x.value->>'value')
   on conflict do nothing;

  -- Only All profiles adds a role membership, and never a second one.
  if not v_adding then continue rows; end if;
  if v_existed then
   n_already_in_role:=n_already_in_role+1;
  else
   if not v_new_person then n_matched:=n_matched+1; end if;
   v_role_candidate:=null;
   insert into public.role_candidates(client_id,role_id,candidate_id,source,source_detail,custom,stage)
    values(p_client,p_role,v_candidate,p_source,v_source_detail,v_custom,'all_profiles')
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
  'alreadyInRole',n_already_in_role,'invalid',n_invalid,
  'updated',n_updated,'skipped',n_skipped);
end $$;

create function public.import_candidates(p_client uuid,p_role uuid,p_rows jsonb,p_source text,p_stage text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.import_candidates(p_client,p_role,p_rows,p_source,p_stage);
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
