-- Six sources, and Naukri profiles that do not wait to be rated.
--
-- A row carried two overlapping ideas of where it came from: a `source` that
-- was really the mechanism it arrived by (pasted, typed, a CSV) and a free
-- text `source_detail` holding the thing anybody would actually call the
-- source - "LinkedIn Recruiter", "Upwork", whatever was typed that day. The
-- Source column showed whichever of the two happened to be filled in, so the
-- same profile read differently depending on how it got here.
--
-- There is now one list, and it is the one the agency uses: LinkedIn
-- Recruiter, Naukri, Google Search, CSV Import, Master Database, Other. The
-- mechanism-shaped values stay valid so old rows keep opening, but they are
-- not offered and the rows holding them are moved onto the six. Nothing typed
-- into source_detail is deleted; it just stops being what the table shows.
--
-- And Naukri profiles skip the rating gate. We do not score them, so leaving
-- them in All profiles means leaving them in a queue whose only exit is a
-- rating nobody intends to give. They arrive in Profile shortlisted, with the
-- move written into the timeline like any other.
begin;

alter table public.role_candidates drop constraint role_candidates_source_check;
alter table public.role_candidates add constraint role_candidates_source_check
 check(source in ('linkedin','naukri','google','csv','master_db','other',
  -- Readable, not offered: what rows recorded before this list existed.
  'manual','url_paste','sourcing_import'));

-- Before the history trigger starts watching this column, so a one-time
-- correction does not surface in Edit history as somebody's edit. A profile
-- typed into the sheet or pasted as a URL came from LinkedIn Recruiter; the
-- two pulled from the old sourcing workspace have no home in the new list.
update public.role_candidates set source='linkedin' where source in ('manual','url_paste');
update public.role_candidates set source='other' where source='sourcing_import';

-- Now it is worth recording: changing where somebody came from is an edit.
create or replace function private.capture_candidate_edit() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_doc jsonb:=to_jsonb(old); new_doc jsonb:=to_jsonb(new);
 person uuid; role_uuid uuid; person_name text; key text; nested text; fields text[];
begin
 if tg_table_name='candidate_identities' then
  person:=coalesce((new_doc->>'candidate_id')::uuid,(old_doc->>'candidate_id')::uuid);
  select full_name into person_name from public.candidates where id=person;
  if (old_doc->>'normalized_value') is distinct from (new_doc->>'normalized_value') then
   insert into private.candidate_edit_history(candidate_id,candidate_name,actor_id,batch_id,field,before_value,after_value)
   values(person,coalesce(person_name,'Deleted profile'),auth.uid(),nullif(current_setting('leadscope.batch_id',true),'')::uuid,
    'identity:'||coalesce(new_doc->>'kind',old_doc->>'kind'),old_doc->'normalized_value',new_doc->'normalized_value');
  end if;
  return null;
 end if;
 if tg_table_name='candidates' then
  person:=new.id; person_name:=new.full_name;
  fields:=array['full_name','headline','current_company','current_designation','location','total_experience_years','phone','alternate_phone','email','current_ctc','highest_qualification','resume_path'];
 else
  person:=new.candidate_id; role_uuid:=new.role_id;
  select full_name into person_name from public.candidates where id=person;
  fields:=array['stage','rating','source','internal_notes','client_notes','interview_at','follow_up_at','rejection_type','rejection_reason','client_decision','outcome','offer_amount','offer_currency','offer_sent_on','offer_response_due_at','expected_start_at','offer_notes','screening','custom'];
 end if;
 foreach key in array fields loop
  if old_doc->key is not distinct from new_doc->key then continue; end if;
  if key in ('screening','custom') then
   for nested in select jsonb_object_keys(coalesce(old_doc->key,'{}')||coalesce(new_doc->key,'{}')) loop
    if old_doc->key->nested is distinct from new_doc->key->nested then
     insert into private.candidate_edit_history(candidate_id,candidate_name,role_id,actor_id,batch_id,field,before_value,after_value)
     values(person,person_name,role_uuid,auth.uid(),nullif(current_setting('leadscope.batch_id',true),'')::uuid,key||':'||nested,old_doc->key->nested,new_doc->key->nested);
    end if;
   end loop;
  else
   insert into private.candidate_edit_history(candidate_id,candidate_name,role_id,actor_id,batch_id,field,before_value,after_value)
   values(person,person_name,role_uuid,auth.uid(),nullif(current_setting('leadscope.batch_id',true),'')::uuid,key,old_doc->key,new_doc->key);
  end if;
 end loop;
 return null;
end $$;
revoke all on function private.capture_candidate_edit() from public,anon,authenticated;

-- Adding from the master database follows the same rule: a Naukri profile
-- starts in Profile shortlisted.
create or replace function private.add_candidates_to_role(p_client uuid,p_role uuid,p_candidate_ids uuid[],p_source text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_added integer; v_total integer; v_stage text; begin
 perform private.require_admin(auth.uid());
 if p_candidate_ids is null or cardinality(p_candidate_ids) not between 1 and 200 then
  raise exception 'LS: Add between 1 and 200 candidates at a time.'; end if;
 if p_source is null or p_source not in ('linkedin','naukri','google','csv','master_db','other') then
  raise exception 'LS: Unsupported candidate source.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding candidates.'; end if;
 select count(distinct u) into v_total from unnest(p_candidate_ids) u;
 if (select count(*) from public.candidates where id=any(p_candidate_ids))<>v_total then
  raise exception 'LS: Some candidates no longer exist. Reload and try again.'; end if;
 v_stage:=case when p_source='naukri' then 'profile_shortlisted' else 'all_profiles' end;
 with wanted as (select distinct unnest(p_candidate_ids) as cid),
 ins as (
  insert into public.role_candidates(client_id,role_id,candidate_id,source,stage)
  select p_client,p_role,cid,p_source,v_stage from wanted
  on conflict(role_id,candidate_id) do nothing
  returning id,candidate_id
 ), moved as (
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
  select p_client,id,'stage','all_profiles',v_stage,auth.uid(),'Naukri profile, added without a rating.'
  from ins where v_stage<>'all_profiles'
  returning id
 ), history as (
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,actor,detail)
  select p_client,id,'import',v_stage,auth.uid(),
   jsonb_build_object('source',p_source,'candidateId',candidate_id) from ins
  returning id
 ) select count(*) into v_added from history;
 return jsonb_build_object('added',v_added,'alreadyInRole',v_total-v_added);
end $$;
revoke all on function private.add_candidates_to_role(uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function private.add_candidates_to_role(uuid,uuid,uuid[],text) to authenticated;

drop function if exists public.import_candidates(uuid,uuid,jsonb,text,text);
drop function if exists private.import_candidates(uuid,uuid,jsonb,text,text);

create function private.import_candidates(p_client uuid,p_role uuid,p_rows jsonb,p_source text,p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 r jsonb; e jsonb; f jsonb; k text; v text; v_source_detail text; v_custom jsonb;
 v_custom_key text; v_custom_value jsonb; v_field_kind text; v_field_options jsonb;
 ok boolean; n_ident integer; v_custom_valid boolean; v_adding boolean; v_new_person boolean;
 v_li_ids uuid[]; v_match_kind text; v_flagged jsonb:='[]'::jsonb;
 v_row_source text; v_landing text;
 v_candidate uuid; v_role_candidate uuid; v_existed boolean;
 n_created integer:=0; n_matched integer:=0; n_already_in_role integer:=0; n_invalid integer:=0;
 n_updated integer:=0; n_skipped integer:=0; n_rated integer:=0; n_flagged integer:=0;
 -- Deliberately unconstrained: declaring these numeric(3,1) would round the
 -- value on assignment, so 4.55 became a valid 4.6 before the check below
 -- ever saw it. The column keeps the scale; the check needs the raw number.
 v_rating numeric; v_previous numeric; v_threshold numeric(3,1); v_stage text;
 v_phone text; v_alt text; v_cur_phone text; v_cur_alt text;
begin
 perform private.require_admin(auth.uid());
 if p_source is null or p_source not in ('linkedin','naukri','google','csv','master_db','other') then
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
 select rating_threshold into v_threshold from public.roles
  where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this role before adding candidates.'; end if;

 -- All profiles is the only stage that admits somebody new.
 v_adding := p_stage = 'all_profiles';

 <<rows>>
 for r in select * from jsonb_array_elements(p_rows) loop
  f:=coalesce(r->'fields','{}'::jsonb);
  -- A Source cell in the file speaks for its own row; the batch setting is
  -- what the rest of the file gets. Anything unrecognised falls back rather
  -- than failing a row over a spelling.
  v_row_source:=coalesce(nullif(r->>'source',''),p_source);
  if v_row_source not in ('linkedin','naukri','google','csv','master_db','other') then v_row_source:=p_source; end if;
  -- Naukri profiles are not rated here, so they would sit in All profiles
  -- waiting for a score nobody intends to give. They start one stage in.
  v_landing:=case when v_row_source='naukri' then 'profile_shortlisted' else 'all_profiles' end;
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
   if k='phone' and v !~ '^[0-9]{10}$' then ok:=false; exit; end if;
   if k='email' and v !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then ok:=false; exit; end if;
   if k in ('linkedin','naukri','email','external') then n_ident:=n_ident+1; end if;
  end loop;
  if not ok or n_ident=0 then n_invalid:=n_invalid+1; continue rows; end if;

  if length(coalesce(f->>'currentCtc',''))>80
   or length(coalesce(f->>'highestQualification',''))>200 then
   n_invalid:=n_invalid+1; continue rows; end if;

  -- A rating is the one imported value that can move somebody, so a
  -- malformed one fails its row rather than being dropped in silence.
  v_rating:=null;
  if f ? 'rating' and jsonb_typeof(f->'rating')<>'null' then
   if jsonb_typeof(f->'rating')<>'number' then n_invalid:=n_invalid+1; continue rows; end if;
   v_rating:=(f->>'rating')::numeric;
   if v_rating not between 0 and 5 or v_rating<>round(v_rating,1) then
    n_invalid:=n_invalid+1; continue rows; end if;
  end if;

  -- Ten digits each. A second number that repeats the first is one number
  -- written twice rather than a bad row: the copy is dropped and the row
  -- imports with the single number it actually carries.
  v_phone:=nullif(f->>'phone','');
  v_alt:=nullif(f->>'alternatePhone','');
  if v_phone is not null and v_phone !~ '^[0-9]{10}$' then
   n_invalid:=n_invalid+1; continue rows; end if;
  if v_alt is not null and v_alt !~ '^[0-9]{10}$' then
   n_invalid:=n_invalid+1; continue rows; end if;
  if v_alt=v_phone then v_alt:=null; end if;

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

  -- The profile URL is the only identity allowed to decide that two rows are
  -- one person. An email or a Naukri id that lands on somebody already on file
  -- is handed back by name instead of merged: a shared inbox, a colleague's
  -- address typed into the wrong row, a reused id - each is common enough that
  -- merging on one quietly writes this row's details over a different person.
  select array_agg(distinct i.candidate_id) into v_li_ids
   from public.candidate_identities i
   join jsonb_array_elements(r->'identities') x
    on x.value->>'kind'=i.kind and x.value->>'value'=i.normalized_value
   where i.kind='linkedin';
  if coalesce(array_length(v_li_ids,1),0)>1 then n_invalid:=n_invalid+1; continue rows; end if;
  v_candidate:=v_li_ids[1];
  if v_candidate is null then
   select min(i.kind) into v_match_kind
    from public.candidate_identities i
    join jsonb_array_elements(r->'identities') x
     on x.value->>'kind'=i.kind and x.value->>'value'=i.normalized_value
    where i.kind in ('naukri','email','external');
   -- Reported, not imported. Nothing is written for this row either way.
   if v_match_kind is not null then
    n_flagged:=n_flagged+1;
    if jsonb_array_length(v_flagged)<25 then
     v_flagged:=v_flagged||jsonb_build_object('name',trim(r->>'name'),'matchedOn',v_match_kind);
    end if;
    continue rows;
   end if;
  end if;

  if v_candidate is null then
   -- Nobody by this identity. Only All profiles may create one.
   if not v_adding then n_skipped:=n_skipped+1; continue rows; end if;
   insert into public.candidates(full_name,headline,current_company,current_designation,location,
    total_experience_years,phone,alternate_phone,email,current_ctc,highest_qualification,created_by)
    values(trim(r->>'name'),coalesce(f->>'headline',''),coalesce(f->>'currentCompany',''),
     coalesce(f->>'currentDesignation',''),coalesce(f->>'location',''),
     (f->>'totalExperienceYears')::numeric,v_phone,
     v_alt,nullif(f->>'email',''),
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
   -- Merge both numbers against what is already on file before writing either
   -- one. A sheet that lists somebody twice - their second number in the
   -- alternate column of one row, that same number as the primary of another -
   -- used to leave the merged record holding one number in both places, which
   -- the no-duplicate rule then refused, taking the whole batch down with it.
   select phone,alternate_phone into v_cur_phone,v_cur_alt
    from public.candidates where id=v_candidate for update;
   v_phone:=coalesce(v_phone,v_cur_phone);
   v_alt:=coalesce(v_alt,v_cur_alt);
   if v_alt=v_phone then v_alt:=null; end if;
   update public.candidates set
    headline=case when coalesce(f->>'headline','')='' then headline else f->>'headline' end,
    current_company=case when coalesce(f->>'currentCompany','')='' then current_company else f->>'currentCompany' end,
    current_designation=case when coalesce(f->>'currentDesignation','')='' then current_designation else f->>'currentDesignation' end,
    location=case when coalesce(f->>'location','')='' then location else f->>'location' end,
    total_experience_years=coalesce((f->>'totalExperienceYears')::numeric,total_experience_years),
    phone=v_phone,
    alternate_phone=v_alt,
    email=coalesce(nullif(f->>'email',''),email),
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
  if v_adding then
  if v_existed then
   n_already_in_role:=n_already_in_role+1;
  else
   if not v_new_person then n_matched:=n_matched+1; end if;
   v_role_candidate:=null;
   insert into public.role_candidates(client_id,role_id,candidate_id,source,source_detail,custom,stage)
    values(p_client,p_role,v_candidate,v_row_source,v_source_detail,v_custom,v_landing)
    on conflict(role_id,candidate_id) do nothing
    returning id into v_role_candidate;
   if v_role_candidate is not null then
    if v_landing<>'all_profiles' then
     insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
      values(p_client,v_role_candidate,'stage','all_profiles',v_landing,auth.uid(),
       'Naukri profile, added without a rating.');
    end if;
    insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,actor,detail)
     values(p_client,v_role_candidate,'import',v_landing,auth.uid(),
      jsonb_build_object('source',v_row_source,'sourceDetail',v_source_detail,
       'customKeys',(select coalesce(jsonb_agg(key),'[]'::jsonb) from jsonb_object_keys(v_custom) as keys(key)),
       'candidateId',v_candidate));
   end if;
  end if;
  end if;

  -- A rating belongs to the person's place on this role rather than to the
  -- person, so it is written to whichever membership this row landed on: the
  -- one just created, the one already there, or the one a later-stage import
  -- matched. What happens next is what happens when the same number is typed
  -- into the grid, floor included, so a sheet of ratings and an afternoon of
  -- typing end in the same place.
  if v_rating is not null then
   select id,stage,rating into v_role_candidate,v_stage,v_previous
    from public.role_candidates where role_id=p_role and candidate_id=v_candidate for update;
   if found and v_previous is distinct from v_rating then
    insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
     values(p_client,v_role_candidate,'rating',auth.uid(),
      jsonb_build_object('rating',v_rating,'previousRating',v_previous,'via','import'));
    if v_stage='all_profiles' and v_rating>=v_threshold then
     update public.role_candidates set rating=v_rating,rated_by=auth.uid(),rated_at=now(),
      stage='profile_shortlisted',stage_entered_at=now(),threshold_at_rating=v_threshold,
      updated_at=now() where id=v_role_candidate;
     insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
      values(p_client,v_role_candidate,'stage','all_profiles','profile_shortlisted',auth.uid(),
       'Rating met the floor.');
    else
     update public.role_candidates set rating=v_rating,rated_by=auth.uid(),rated_at=now(),
      updated_at=now() where id=v_role_candidate;
    end if;
    n_rated:=n_rated+1;
   end if;
  end if;
 end loop;

 return jsonb_build_object('created',n_created,'matchedExisting',n_matched,
  'alreadyInRole',n_already_in_role,'invalid',n_invalid,
  'updated',n_updated,'skipped',n_skipped,'rated',n_rated,
  'flagged',n_flagged,'flaggedRows',v_flagged);
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

create or replace function private.bulk_edit_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text,p_field text,p_value jsonb,p_mode text,p_expected text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; snapshot text; rows jsonb:='[]'; current_value jsonb; next_value jsonb;
 shared boolean; custom_key text; custom_kind text; custom_options jsonb; batch uuid; changed integer:=0;
begin
 perform private.require_admin(auth.uid());
 if p_mode is null or p_mode not in ('replace','fill_empty','clear') then raise exception 'LS: Choose an edit mode.'; end if;
 -- Every row came from somewhere. Correcting that is an edit; emptying it is
 -- not something the table can hold.
 if p_field='source' and p_mode='clear' then raise exception 'LS: Every row has a source. Choose one instead of clearing.'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 50 or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then raise exception 'LS: Select 1–50 unique rows.'; end if;
 perform 1 from public.clients where id=p_client for update;
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Active role not found.'; end if;
 perform 1 from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids) order by id for update;
 if (select count(*) from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids) and (p_stage is null or stage=p_stage))<>cardinality(p_ids) then
  raise exception 'LS: Selected rows changed stage or scope. Refresh and select them again.';
 end if;
 perform 1 from public.candidates where id in(select candidate_id from public.role_candidates where id=any(p_ids)) order by id for update;
 shared:=p_field=any(array['headline','current_company','current_designation','location','current_ctc','highest_qualification','total_experience_years']);
 if p_field like 'custom:%' then
  custom_key:=substr(p_field,8);
  select kind,options into custom_kind,custom_options from public.role_fields where role_id=p_role and key=custom_key and not archived;
  if custom_kind is null then raise exception 'LS: Custom column no longer available.'; end if;
 elsif not coalesce(shared,false) and p_field not in ('rating','source','internal_notes','client_notes') then
  raise exception 'LS: This field is not available for bulk editing.';
 end if;
 if p_field is null then raise exception 'LS: Choose a field.'; end if;
 next_value:=case when p_mode='clear' then null else nullif(p_value,'null'::jsonb) end;
 if p_mode<>'clear' and (next_value is null or next_value='""') then raise exception 'LS: Enter a value, or choose Clear values.'; end if;
 if next_value is not null then
  if shared or p_field in ('internal_notes','client_notes') then
   if jsonb_typeof(next_value)<>'string' then raise exception 'LS: Enter a text value.'; end if;
   next_value:=to_jsonb(trim(next_value#>>'{}'));
   if next_value='""' then raise exception 'LS: Enter a value, or choose Clear values.'; end if;
   if length(next_value#>>'{}')>(case p_field when 'current_ctc' then 80 when 'headline' then 300 when 'internal_notes' then 4000 when 'client_notes' then 4000 else 200 end) then raise exception 'LS: Value is too long.'; end if;
   if p_field='total_experience_years' and ((next_value#>>'{}') !~ '^[0-9]{1,2}([.][0-9])?$' or (next_value#>>'{}')::numeric not between 0 and 70) then raise exception 'LS: Experience must be between 0 and 70 years.'; end if;
  elsif p_field='source' then
   if jsonb_typeof(next_value)<>'string' or (next_value#>>'{}') not in ('linkedin','naukri','google','csv','master_db','other') then raise exception 'LS: Choose one of the listed sources.'; end if;
  elsif p_field='rating' then
   if jsonb_typeof(next_value)<>'number' or (next_value#>>'{}')::numeric not between 0 and 5 or (next_value#>>'{}')::numeric<>round((next_value#>>'{}')::numeric,1) then raise exception 'LS: Choose a rating from 0.0 to 5.0.'; end if;
  elsif custom_key is not null then
   if (custom_kind='number' and jsonb_typeof(next_value)<>'number') or (custom_kind='boolean' and jsonb_typeof(next_value)<>'boolean') or (custom_kind in ('text','select','date') and jsonb_typeof(next_value)<>'string') then raise exception 'LS: Value does not match the custom column type.'; end if;
   if length(next_value#>>'{}')>2000 then raise exception 'LS: Value is too long.'; end if;
   if custom_kind='select' and not custom_options @> jsonb_build_array(next_value) then raise exception 'LS: Choose an existing column option.'; end if;
   if custom_kind='date' then
    if (next_value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'LS: Choose a valid date.'; end if;
    perform (next_value#>>'{}')::date;
   end if;
  end if;
 end if;
 select md5(jsonb_build_array(p_field,next_value,p_mode,p_stage,custom_kind,custom_options,(select to_jsonb(r) from public.roles r where r.id=p_role),jsonb_agg(jsonb_build_array(to_jsonb(rc),to_jsonb(c)) order by rc.id))::text) into snapshot
 from public.role_candidates rc join public.candidates c on c.id=rc.candidate_id where rc.id=any(p_ids);
 if p_expected is not null and p_expected<>snapshot then raise exception 'LS: Data changed since this preview. Preview again before applying.'; end if;
 if p_expected is not null then batch:=gen_random_uuid(); perform set_config('leadscope.batch_id',batch::text,true); end if;
 for item in select rc.*,c.full_name,to_jsonb(c) person from public.role_candidates rc join public.candidates c on c.id=rc.candidate_id where rc.id=any(p_ids) order by rc.id loop
  current_value:=case when shared then item.person->p_field when custom_key is not null then item.custom->custom_key else to_jsonb(item)->p_field end;
  if p_mode='fill_empty' and current_value is not null and current_value not in ('null'::jsonb,'""'::jsonb) then continue; end if;
  if coalesce(current_value,'null')=coalesce(next_value,'null') or (next_value is null and current_value='""') then continue; end if;
  changed:=changed+1;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',item.id,'name',item.full_name,'before',current_value,'after',next_value));
  if p_expected is not null then
   if shared then perform private.save_candidate_field(item.candidate_id,p_field,next_value#>>'{}');
   elsif custom_key is not null then perform private.save_custom_field(p_client,item.id,custom_key,next_value);
   elsif p_field='rating' then perform private.rate_candidate_decimal(p_client,item.id,(next_value#>>'{}')::numeric);
   elsif p_field='client_notes' then perform private.save_client_note(p_client,item.id,next_value#>>'{}');
   -- Where somebody came from is a fact about this role membership, so it is
   -- written straight here; the history trigger records the before and after.
   elsif p_field='source' then update public.role_candidates set source=next_value#>>'{}',updated_at=now() where id=item.id;
   else update public.role_candidates set internal_notes=coalesce(next_value#>>'{}',''),updated_at=now() where id=item.id;
   end if;
  end if;
 end loop;
 if p_expected is not null then perform set_config('leadscope.batch_id','',true); end if;
 return jsonb_build_object('token',snapshot,'rows',rows,'changed',changed,'skipped',cardinality(p_ids)-changed,'shared',shared,'batchId',batch,
  'otherRoleMemberships',case when shared then (select count(*) from public.role_candidates where role_id<>p_role and candidate_id in (select candidate_id from public.role_candidates where id=any(p_ids))) else 0 end);
end $$;

commit;
