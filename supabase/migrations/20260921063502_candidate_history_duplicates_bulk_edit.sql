begin;

-- Audit values are private and append-only to application roles. No historical
-- before-values are invented: recording starts when these triggers are installed.
create table private.candidate_edit_history (
 id bigint generated always as identity primary key,
 candidate_id uuid not null, candidate_name text not null,
 role_id uuid, actor_id uuid, changed_at timestamptz not null default clock_timestamp(),
 batch_id uuid, field text not null, before_value jsonb, after_value jsonb
);
alter table private.candidate_edit_history enable row level security;
revoke all on private.candidate_edit_history from public,anon,authenticated;
create index candidate_edit_history_role on private.candidate_edit_history(role_id,id desc);
create index candidate_edit_history_person on private.candidate_edit_history(candidate_id,id desc);

create function private.capture_candidate_edit() returns trigger
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
  fields:=array['full_name','headline','current_company','current_designation','location','total_experience_years','phone','email','current_ctc','highest_qualification','resume_path'];
 else
  person:=new.candidate_id; role_uuid:=new.role_id;
  select full_name into person_name from public.candidates where id=person;
  fields:=array['stage','rating','internal_notes','client_notes','interview_at','follow_up_at','rejection_type','rejection_reason','client_decision','outcome','offer_amount','offer_currency','offer_sent_on','offer_response_due_at','expected_start_at','offer_notes','screening','custom'];
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
create trigger candidates_edit_history after update on public.candidates for each row execute function private.capture_candidate_edit();
create trigger role_candidates_edit_history after update on public.role_candidates for each row execute function private.capture_candidate_edit();
create trigger identities_edit_history after insert or update or delete on public.candidate_identities for each row execute function private.capture_candidate_edit();

create function private.candidate_edit_history_page(p_client uuid,p_role uuid,p_candidate uuid default null,p_before bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_admin(auth.uid());
 if not exists(select 1 from public.roles where id=p_role and client_id=p_client) then raise exception 'LS: Role not found.'; end if;
 select coalesce(jsonb_agg(entry order by id desc),'[]') into result from (
  select h.id,jsonb_build_object('id',h.id::text,'candidateId',h.candidate_id,'candidateName',h.candidate_name,
   'field',h.field,'fieldLabel',case when h.field like 'custom:%' then (select label from public.role_fields where role_id=h.role_id and key=substr(h.field,8)) else null end,
   'before',h.before_value,'after',h.after_value,'at',h.changed_at,'batchId',h.batch_id,
   'scope',case when h.role_id is null then 'Shared profile' else 'This role' end,
   'actor',case when h.actor_id is null then 'Shared link / system' else coalesce(to_jsonb(u)->>'email','Operator '||left(h.actor_id::text,8)) end) entry
  from private.candidate_edit_history h left join auth.users u on u.id=h.actor_id
  where (p_before is null or h.id<p_before) and (p_candidate is null or h.candidate_id=p_candidate)
   and (h.role_id=p_role or (h.role_id is null and exists(select 1 from public.role_candidates rc where rc.role_id=p_role and rc.candidate_id=h.candidate_id)))
  order by h.id desc limit 51
 ) entries;
 return jsonb_build_object('rows',case when jsonb_array_length(result)>50 then result-50 else result end,
  'nextCursor',case when jsonb_array_length(result)>50 then result->49->>'id' else null end);
end $$;

-- Preview and apply use the same locked snapshot. Changes since preview cause
-- an all-or-nothing rejection, including changes in shared candidate fields.
create function private.bulk_edit_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text,p_field text,p_value jsonb,p_mode text,p_expected text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record; snapshot text; rows jsonb:='[]'; current_value jsonb; next_value jsonb;
 shared boolean; custom_key text; custom_kind text; custom_options jsonb; batch uuid; changed integer:=0;
begin
 perform private.require_admin(auth.uid());
 if p_mode is null or p_mode not in ('replace','fill_empty','clear') then raise exception 'LS: Choose an edit mode.'; end if;
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
 elsif not coalesce(shared,false) and p_field not in ('rating','internal_notes','client_notes') then
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
   else update public.role_candidates set internal_notes=coalesce(next_value#>>'{}',''),updated_at=now() where id=item.id;
   end if;
  end if;
 end loop;
 if p_expected is not null then perform set_config('leadscope.batch_id','',true); end if;
 return jsonb_build_object('token',snapshot,'rows',rows,'changed',changed,'skipped',cardinality(p_ids)-changed,'shared',shared,'batchId',batch,
  'otherRoleMemberships',case when shared then (select count(*) from public.role_candidates where role_id<>p_role and candidate_id in (select candidate_id from public.role_candidates where id=any(p_ids))) else 0 end);
end $$;

create function private.duplicate_text(value text) returns text language sql immutable set search_path='' as $$ select nullif(regexp_replace(lower(trim(coalesce(value,''))),'[[:space:]]+',' ','g'),''); $$;
create index candidates_duplicate_email on public.candidates(private.duplicate_text(email));
create index candidates_duplicate_phone on public.candidates(phone);
create index candidates_duplicate_name_company on public.candidates(private.duplicate_text(full_name),private.duplicate_text(current_company));
create table private.candidate_duplicate_reviews (
 first_id uuid not null references public.candidates(id), second_id uuid not null references public.candidates(id),
 fingerprint text not null, status text not null check(status in ('pending','confirmed','separate')),
 note text not null default '' check(length(note)<=2000), reviewed_by uuid not null, reviewed_at timestamptz not null default now(),
 revision integer not null default 1, primary key(first_id,second_id), check(first_id<second_id)
);
alter table private.candidate_duplicate_reviews enable row level security;
revoke all on private.candidate_duplicate_reviews from public,anon,authenticated;
create function private.duplicate_fingerprint(a public.candidates,b public.candidates) returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(a.id,a.full_name,a.email,a.phone,a.current_company,b.id,b.full_name,b.email,b.phone,b.current_company)::text);
$$;
create function private.duplicate_reasons(a public.candidates,b public.candidates) returns text[] language sql immutable set search_path='' as $$
 select array_remove(array[
  case when private.duplicate_text(a.email)=private.duplicate_text(b.email) then 'Same email' end,
  case when nullif(a.phone,'')=nullif(b.phone,'') then 'Same phone' end,
  case when private.duplicate_text(a.full_name)=private.duplicate_text(b.full_name) and private.duplicate_text(a.current_company)=private.duplicate_text(b.current_company) then 'Same name and company' end
 ],null);
$$;
create function private.duplicate_profile(c public.candidates) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.full_name,'email',c.email,'phone',c.phone,'company',c.current_company,'designation',c.current_designation,'location',c.location,
 'linkedin',(select normalized_value from public.candidate_identities where candidate_id=c.id and kind='linkedin' order by id limit 1),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'client',cl.name,'stage',rc.stage)) from public.role_candidates rc join public.roles r on r.id=rc.role_id join public.clients cl on cl.id=r.client_id where rc.candidate_id=c.id),'[]'));
$$;

create function private.duplicate_review_page(p_client uuid,p_role uuid,p_status text default 'pending',p_after text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_admin(auth.uid());
 if not exists(select 1 from public.roles where id=p_role and client_id=p_client) then raise exception 'LS: Role not found.'; end if;
 if p_status is null or p_status not in ('pending','confirmed','separate') then raise exception 'LS: Choose a review status.'; end if;
 with role_people as materialized (select c.* from public.candidates c join public.role_candidates rc on rc.candidate_id=c.id where rc.role_id=p_role),
 pairs as (
  select distinct least(a.id,b.id) first_id,greatest(a.id,b.id) second_id from role_people a join public.candidates b on a.id<>b.id and (
   private.duplicate_text(a.email)=private.duplicate_text(b.email) or nullif(a.phone,'')=b.phone or
   (private.duplicate_text(a.full_name)=private.duplicate_text(b.full_name) and private.duplicate_text(a.current_company)=private.duplicate_text(b.current_company)))
 ), matches as (
  select a,b,private.duplicate_fingerprint(a,b) fingerprint,private.duplicate_reasons(a,b) reasons,
   coalesce(d.revision,0) revision,d.note,d.reviewed_at,
   case when d.fingerprint=private.duplicate_fingerprint(a,b) then d.status else 'pending' end status,
   a.id::text||':'||b.id::text cursor
  from pairs p join public.candidates a on a.id=p.first_id join public.candidates b on b.id=p.second_id
  left join private.candidate_duplicate_reviews d on d.first_id=p.first_id and d.second_id=p.second_id
 ), page as (select * from matches where status=p_status and (p_after is null or cursor>p_after) order by cursor limit 21)
 select coalesce(jsonb_agg(jsonb_build_object('first',private.duplicate_profile(a),'second',private.duplicate_profile(b),
  'fingerprint',fingerprint,'reasons',reasons,'revision',revision,'status',status,'note',coalesce(note,''),'reviewedAt',reviewed_at,'cursor',cursor) order by cursor),'[]') into result from page;
 return jsonb_build_object('rows',case when jsonb_array_length(result)>20 then result-20 else result end,
  'nextCursor',case when jsonb_array_length(result)>20 then result->19->>'cursor' else null end);
end $$;

create function private.review_candidate_duplicate(p_client uuid,p_role uuid,p_first uuid,p_second uuid,p_fingerprint text,p_revision integer,p_status text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.candidates; b public.candidates; prior private.candidate_duplicate_reviews;
begin
 perform private.require_admin(auth.uid());
 if not exists(select 1 from public.roles where id=p_role and client_id=p_client) then raise exception 'LS: Role not found.'; end if;
 if not exists(select 1 from public.role_candidates where role_id=p_role and candidate_id in(p_first,p_second)) then raise exception 'LS: Neither profile belongs to this role.'; end if;
 if p_first>=p_second or p_first is null or p_second is null or p_status is null or p_status not in ('pending','confirmed','separate') or length(coalesce(p_note,''))>2000 then raise exception 'LS: Invalid review.'; end if;
 perform 1 from public.candidates where id in(p_first,p_second) order by id for update;
 select * into a from public.candidates where id=p_first;
 select * into b from public.candidates where id=p_second;
 if a.id is null or b.id is null or cardinality(private.duplicate_reasons(a,b))=0 or p_fingerprint is distinct from private.duplicate_fingerprint(a,b) then raise exception 'LS: Matching fields changed. Reload the review.'; end if;
 select * into prior from private.candidate_duplicate_reviews where first_id=p_first and second_id=p_second for update;
 if p_revision is distinct from coalesce(prior.revision,0) then raise exception 'LS: Another operator reviewed this pair. Reload the review.'; end if;
 insert into private.candidate_duplicate_reviews(first_id,second_id,fingerprint,status,note,reviewed_by)
 values(p_first,p_second,p_fingerprint,p_status,trim(coalesce(p_note,'')),auth.uid())
 on conflict(first_id,second_id) do update set fingerprint=excluded.fingerprint,status=excluded.status,note=excluded.note,reviewed_by=excluded.reviewed_by,reviewed_at=now(),revision=private.candidate_duplicate_reviews.revision+1;
 insert into private.candidate_edit_history(candidate_id,candidate_name,role_id,actor_id,field,before_value,after_value)
 values(a.id,a.full_name,p_role,auth.uid(),'duplicate_review',jsonb_build_object('status',coalesce(prior.status,'pending'),'note',prior.note),jsonb_build_object('status',p_status,'matchedProfile',b.full_name,'note',trim(coalesce(p_note,''))));
end $$;

create function public.candidate_edit_history_page(p_client uuid,p_role uuid,p_candidate uuid default null,p_before bigint default null) returns jsonb language sql security invoker set search_path='' as $$ select private.candidate_edit_history_page(p_client,p_role,p_candidate,p_before); $$;
create function public.bulk_edit_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text,p_field text,p_value jsonb,p_mode text,p_expected text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.bulk_edit_role_candidates(p_client,p_role,p_ids,p_stage,p_field,p_value,p_mode,p_expected); $$;
create function public.duplicate_review_page(p_client uuid,p_role uuid,p_status text default 'pending',p_after text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.duplicate_review_page(p_client,p_role,p_status,p_after); $$;
create function public.review_candidate_duplicate(p_client uuid,p_role uuid,p_first uuid,p_second uuid,p_fingerprint text,p_revision integer,p_status text,p_note text) returns void language sql security invoker set search_path='' as $$ select private.review_candidate_duplicate(p_client,p_role,p_first,p_second,p_fingerprint,p_revision,p_status,p_note); $$;

revoke all on function private.duplicate_text(text),private.duplicate_fingerprint(public.candidates,public.candidates),private.duplicate_reasons(public.candidates,public.candidates),private.duplicate_profile(public.candidates) from public,anon,authenticated;
revoke all on function private.candidate_edit_history_page(uuid,uuid,uuid,bigint),public.candidate_edit_history_page(uuid,uuid,uuid,bigint),private.bulk_edit_role_candidates(uuid,uuid,uuid[],text,text,jsonb,text,text),public.bulk_edit_role_candidates(uuid,uuid,uuid[],text,text,jsonb,text,text),private.duplicate_review_page(uuid,uuid,text,text),public.duplicate_review_page(uuid,uuid,text,text),private.review_candidate_duplicate(uuid,uuid,uuid,uuid,text,integer,text,text),public.review_candidate_duplicate(uuid,uuid,uuid,uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function private.candidate_edit_history_page(uuid,uuid,uuid,bigint),public.candidate_edit_history_page(uuid,uuid,uuid,bigint),private.bulk_edit_role_candidates(uuid,uuid,uuid[],text,text,jsonb,text,text),public.bulk_edit_role_candidates(uuid,uuid,uuid[],text,text,jsonb,text,text),private.duplicate_review_page(uuid,uuid,text,text),public.duplicate_review_page(uuid,uuid,text,text),private.review_candidate_duplicate(uuid,uuid,uuid,uuid,text,integer,text,text),public.review_candidate_duplicate(uuid,uuid,uuid,uuid,text,integer,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
