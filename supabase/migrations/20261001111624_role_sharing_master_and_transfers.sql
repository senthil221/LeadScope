begin;

-- Recoverable role tokens stay in the private schema, never in table SELECTs.
-- The approved-operator RPC is the only path that returns the role's URL.
create table private.role_client_links (
 role_id uuid primary key references public.roles(id),
 share_link_id uuid not null unique references public.role_share_links(id),
 token text not null check(token ~ '^[0-9a-f]{64}$')
);
alter table private.role_client_links enable row level security;
revoke all on private.role_client_links from public,anon,authenticated;

create function private.get_role_share_link(p_client uuid,p_role uuid,p_token text,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_link private.role_client_links; v_id uuid; begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles where id=p_role and client_id=p_client for update;
 if not found then raise exception 'LS: Role not found.'; end if;
 select * into v_link from private.role_client_links where role_id=p_role;
 if found then
  if exists(select 1 from public.role_share_links where id=v_link.share_link_id and revoked_at is not null) then
   raise exception 'LS: This role link was revoked. Contact the workspace owner.';
  end if;
  return jsonb_build_object('id',v_link.share_link_id,'token',v_link.token);
 end if;
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_hash is null or p_hash<>encode(sha256(convert_to(p_token,'UTF8')),'hex') then
  raise exception 'LS: Invalid share token.'; end if;
 insert into public.role_share_links(client_id,role_id,stage,token_hash,token_prefix,
  visible_columns,editable_columns,allow_decisions,expires_at,created_by)
 values(p_client,p_role,'recruiter_shortlisted',p_hash,left(p_token,8),
  array['full_name','linkedin','client_notes'],array['client_notes'],false,null,auth.uid()) returning id into v_id;
 insert into private.role_client_links values(p_role,v_id,p_token);
 return jsonb_build_object('id',v_id,'token',p_token);
end $$;
create function public.get_role_share_link(p_client uuid,p_role uuid,p_token text,p_hash text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.get_role_share_link(p_client,p_role,p_token,p_hash);
$$;
revoke all on function private.get_role_share_link(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.get_role_share_link(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.get_role_share_link(uuid,uuid,text,text) to authenticated;
grant execute on function public.get_role_share_link(uuid,uuid,text,text) to authenticated;

-- All current candidate/custom columns, independent of local grid preferences.
-- Legacy links continue to work. Internal notes and raw storage paths stay private.
create or replace function private.read_shared_stage(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare link public.role_share_links; field_defs jsonb; result_rows jsonb; cols text[];
begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
 if link.stage<>'recruiter_shortlisted' or link.editable_columns is distinct from array['client_notes']::text[] or link.allow_decisions then
  raise exception 'LS: This link does not meet the current client sharing rules.'; end if;
 update public.role_share_links set last_viewed_at=now() where id=link.id;
 cols:=array['created_at','stage','full_name','linkedin','headline','phone','alternate_phone','email',
  'location','current_company','current_designation','total_experience_years','current_ctc',
  'highest_qualification','resume','source','rating','client_notes','interview_at','follow_up_at',
  'client_decision','outcome','offer_amount','offer_currency','offer_sent_on','offer_response_due_at',
  'expected_start_at','offer_notes'];
 select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'kind',kind,'options',options) order by ordinal),'[]')
 into field_defs from public.role_fields where role_id=link.role_id and not archived;
 select cols || coalesce(array_agg(key order by ordinal),'{}') into cols
 from public.role_fields where role_id=link.role_id and not archived;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',rc.id,'full_name',c.full_name,'stage',rc.stage,'created_at',rc.created_at,
  'linkedin',(select min(normalized_value) from public.candidate_identities where candidate_id=c.id and kind='linkedin'),
  'headline',c.headline,'phone',c.phone,'alternate_phone',c.alternate_phone,'email',c.email,
  'location',c.location,'current_company',c.current_company,'current_designation',c.current_designation,
  'total_experience_years',c.total_experience_years,'current_ctc',c.current_ctc,'highest_qualification',c.highest_qualification,
  'resume',case when c.resume_path is not null then rc.id::text end,
  'source',rc.source,'rating',rc.rating,'client_notes',rc.client_notes,
  'interview_at',rc.interview_at,'follow_up_at',rc.follow_up_at,'client_decision',rc.client_decision,
  'outcome',rc.outcome,'offer_amount',rc.offer_amount,'offer_currency',rc.offer_currency,
  'offer_sent_on',rc.offer_sent_on,'offer_response_due_at',rc.offer_response_due_at,
  'expected_start_at',rc.expected_start_at,'offer_notes',rc.offer_notes,
  'custom',(select coalesce(jsonb_object_agg(f.key,rc.custom->f.key),'{}') from public.role_fields f
   where f.role_id=rc.role_id and not f.archived and rc.custom ? f.key)
 ) order by rc.created_at desc,rc.id),'[]') into result_rows
 from public.role_candidates rc join public.candidates c on c.id=rc.candidate_id
 where rc.role_id=link.role_id and rc.stage in ('recruiter_shortlisted','client_shortlisted','offer_sent');
 return jsonb_build_object('clientName',(select name from public.clients where id=link.client_id),
  'roleName',(select name from public.roles where id=link.role_id),'stage','recruiter_shortlisted',
  'visibleColumns',cols,'editableColumns',array['client_notes'],'fields',field_defs,'rows',result_rows);
end $$;

-- Feedback stays available as a reviewed profile advances in this role.
create or replace function private.write_shared_cell(p_token_hash text,p_role_candidate uuid,p_column text,p_value jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare link public.role_share_links; rc public.role_candidates; v_previous jsonb; begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
 if link.stage<>'recruiter_shortlisted' or link.editable_columns is distinct from array['client_notes']::text[] or link.allow_decisions then
  raise exception 'LS: This link does not meet the current client sharing rules.'; end if;
 if p_column<>'client_notes' then raise exception 'LS: Clients can edit Notes only.'; end if;
 if p_value is not null and jsonb_typeof(p_value)<>'string' then raise exception 'LS: Enter text for Notes.'; end if;
 if p_value is not null and length(p_value#>>'{}')>4000 then raise exception 'LS: Shorten this note before saving.'; end if;
 -- Serialize the per-link throttle, including concurrent requests.
 perform 1 from public.role_share_links where id=link.id for update;
 if (select count(*) from public.role_candidate_events where share_link_id=link.id and created_at>now()-interval '1 minute')>=60 then
  raise exception 'LS: Too many changes in a short time. Wait a moment and try again.'; end if;
 select * into rc from public.role_candidates where id=p_role_candidate and role_id=link.role_id
  and stage in ('recruiter_shortlisted','client_shortlisted','offer_sent') for update;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 v_previous:=to_jsonb(rc.client_notes);
 update public.role_candidates set client_notes=coalesce(p_value#>>'{}',''),updated_at=now() where id=rc.id;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,share_link_id,detail)
 values(rc.client_id,rc.id,'client_edit',null,link.id,jsonb_build_object('column','client_notes','previousValue',v_previous,'value',p_value));
end $$;

create function private.push_profiles(p_target uuid,p_source uuid,p_candidates uuid[],p_above numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.roles; wanted uuid[]; added integer; total integer; begin
 perform private.require_admin(auth.uid());
 if p_target=p_source then raise exception 'LS: Choose a different target role.'; end if;
 if p_above is not null and (p_above<0 or p_above>5 or round(p_above,1)<>p_above or p_source is null) then
  raise exception 'LS: Choose a source role and a rating from 0.0 to 5.0.'; end if;
 if p_candidates is not null and cardinality(p_candidates) not between 1 and 200 then
  raise exception 'LS: Select between 1 and 200 profiles.'; end if;
 if p_source is null and p_candidates is null then raise exception 'LS: Select profiles from Master Database.'; end if;
 -- Deterministic lock order for transfers in opposite directions.
 perform 1 from public.roles where id in (p_target,p_source) order by id for update;
 select * into target from public.roles where id=p_target and not archived and status='open';
 if not found then raise exception 'LS: Choose an open target role.'; end if;
 if p_source is not null then
  perform 1 from public.roles where id=p_source;
  if not found then raise exception 'LS: Source role not found.'; end if;
  if p_candidates is not null and exists(select 1 from unnest(p_candidates) c where not exists(
   select 1 from public.role_candidates where role_id=p_source and candidate_id=c)) then
   raise exception 'LS: Some selected profiles are no longer in this role. Reload and try again.'; end if;
  select array_agg(candidate_id) into wanted from public.role_candidates where role_id=p_source
   and (p_candidates is null or candidate_id=any(p_candidates)) and (p_above is null or rating>p_above);
 else
  if exists(select 1 from unnest(p_candidates) c where not exists(select 1 from public.candidates where id=c)) then
   raise exception 'LS: Some selected profiles no longer exist.'; end if;
  select array_agg(distinct c) into wanted from unnest(p_candidates) c;
 end if;
 total:=coalesce(cardinality(wanted),0);
 if total=0 then return jsonb_build_object('added',0,'alreadyInRole',0,'matched',0); end if;
 with ins as (
  insert into public.role_candidates(client_id,role_id,candidate_id,source,source_detail,stage,rating)
  select target.client_id,target.id,c,'master_db',
   case when p_source is null then 'Master Database' else 'From role: '||(select name from public.roles where id=p_source) end,
   'all_profiles',null from unnest(wanted) c
  on conflict(role_id,candidate_id) do nothing returning id,candidate_id
 ), history as (
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,to_stage,actor,detail)
  select target.client_id,id,'import','all_profiles',auth.uid(),
   jsonb_build_object('source','master_db','sourceRoleId',p_source,'candidateId',candidate_id,'aboveRating',p_above) from ins returning id
 ) select count(*) into added from history;
 return jsonb_build_object('added',added,'alreadyInRole',total-added,'matched',total);
end $$;
create function public.push_profiles(p_target uuid,p_source uuid,p_candidates uuid[],p_above numeric)
returns jsonb language sql security invoker set search_path='' as $$ select private.push_profiles(p_target,p_source,p_candidates,p_above); $$;
revoke all on function private.push_profiles(uuid,uuid,uuid[],numeric) from public,anon,authenticated;
revoke all on function public.push_profiles(uuid,uuid,uuid[],numeric) from public,anon,authenticated;
grant execute on function private.push_profiles(uuid,uuid,uuid[],numeric) to authenticated;
grant execute on function public.push_profiles(uuid,uuid,uuid[],numeric) to authenticated;
commit;
