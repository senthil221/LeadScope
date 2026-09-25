-- Correcting a source to Naukri moves the row, like adding one does.
--
-- The rule was written into the two places a profile arrives and nowhere
-- else, which made it a property of the import rather than of the source. But
-- what it says is: we do not rate Naukri profiles. That is just as true of a
-- row whose source is put right afterwards, and leaving those in All profiles
-- left them in a rating queue the rule had already excused them from.
--
-- So a bulk edit that sets the source to Naukri takes rows out of All
-- profiles and into Profile shortlisted, writing the move into the timeline
-- the same way. The preview counts them first, so it is stated before it
-- happens rather than noticed afterwards.
begin;

create or replace function private.bulk_edit_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text,p_field text,p_value jsonb,p_mode text,p_expected text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; snapshot text; rows jsonb:='[]'; current_value jsonb; next_value jsonb;
 shared boolean; custom_key text; custom_kind text; custom_options jsonb; batch uuid; changed integer:=0;
 moved integer:=0;
begin
 perform private.require_admin(auth.uid());
 if p_mode is null or p_mode not in ('replace','fill_empty','clear') then raise exception 'LS: Choose an edit mode.'; end if;
 -- Every row came from somewhere. Correcting that is an edit; emptying it is
 -- not something the table can hold.
 if p_field='source' and p_mode='clear' then raise exception 'LS: Every row has a source. Choose one instead of clearing.'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 2000 or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then raise exception 'LS: Select 1–2000 unique rows.'; end if;
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
  -- Naukri profiles are not rated here. Saying a row came from Naukri is
  -- therefore saying it is not waiting for a score, so it leaves the rating
  -- queue - the same rule that applies when one is added, applied when one is
  -- corrected. Counted on the preview so it is not a surprise on apply.
  if p_field='source' and next_value#>>'{}'='naukri' and item.stage='all_profiles' then
   moved:=moved+1;
  end if;
  -- The preview lists the first fifty and counts the rest. A thousand rows of
  -- before and after is not something anybody reads, and sending it makes the
  -- preview slower than the edit.
  if jsonb_array_length(rows)<50 then
   rows:=rows||jsonb_build_array(jsonb_build_object('id',item.id,'name',item.full_name,'before',current_value,'after',next_value));
  end if;
  if p_expected is not null then
   if shared then perform private.save_candidate_field(item.candidate_id,p_field,next_value#>>'{}');
   elsif custom_key is not null then perform private.save_custom_field(p_client,item.id,custom_key,next_value);
   elsif p_field='rating' then perform private.rate_candidate_decimal(p_client,item.id,(next_value#>>'{}')::numeric);
   elsif p_field='client_notes' then perform private.save_client_note(p_client,item.id,next_value#>>'{}');
   -- Where somebody came from is a fact about this role membership, so it is
   -- written straight here; the history trigger records the before and after.
   elsif p_field='source' then
    update public.role_candidates set source=next_value#>>'{}',updated_at=now() where id=item.id;
    if next_value#>>'{}'='naukri' and item.stage='all_profiles' then
     update public.role_candidates set stage='profile_shortlisted',stage_entered_at=now(),
      updated_at=now() where id=item.id;
     insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
      values(p_client,item.id,'stage','all_profiles','profile_shortlisted',auth.uid(),
       'Source set to Naukri, which is not rated here.');
    end if;
   else update public.role_candidates set internal_notes=coalesce(next_value#>>'{}',''),updated_at=now() where id=item.id;
   end if;
  end if;
 end loop;
 if p_expected is not null then perform set_config('leadscope.batch_id','',true); end if;
 return jsonb_build_object('token',snapshot,'rows',rows,'changed',changed,'skipped',cardinality(p_ids)-changed,'shared',shared,'batchId',batch,'moved',moved,
  'otherRoleMemberships',case when shared then (select count(*) from public.role_candidates where role_id<>p_role and candidate_id in (select candidate_id from public.role_candidates where id=any(p_ids))) else 0 end);
end $$;

commit;
