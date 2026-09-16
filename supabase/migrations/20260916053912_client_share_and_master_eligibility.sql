begin;

-- A Master DB record is an agency-wide eligibility fact, not a copy of a
-- candidate or a snapshot of their current role stage. It is set once when a
-- candidate first reaches the named AI Shortlisted stage (or any later stage)
-- and is never cleared if a recruiter later rejects them.
alter table public.candidates
 add column master_qualified_at timestamptz;

with historical_qualification as (
 select rc.candidate_id,min(e.created_at) as qualified_at
 from public.role_candidate_events e
 join public.role_candidates rc on rc.id=e.role_candidate_id
 where e.to_stage in ('profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent')
 group by rc.candidate_id
), current_qualification as (
 select candidate_id,min(stage_entered_at) as qualified_at
 from public.role_candidates
 where stage in ('profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent')
 group by candidate_id
), qualification as (
 select candidate_id,min(qualified_at) as qualified_at
 from (
  select * from historical_qualification
  union all
  select * from current_qualification
 ) q
 group by candidate_id
)
update public.candidates c
set master_qualified_at=q.qualified_at
from qualification q
where c.id=q.candidate_id and c.master_qualified_at is null;

create index candidates_master_qualified_created
 on public.candidates(created_at desc,id)
 where master_qualified_at is not null;

create function private.mark_master_candidate_qualified()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.stage in ('profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent') then
  update public.candidates
  set master_qualified_at=coalesce(master_qualified_at,new.stage_entered_at,now())
  where id=new.candidate_id and master_qualified_at is null;
 end if;
 return new;
end $$;

create trigger role_candidates_mark_master_qualified
 after insert or update of stage on public.role_candidates
 for each row execute function private.mark_master_candidate_qualified();

revoke all on function private.mark_master_candidate_qualified() from public,anon,authenticated;

-- Earlier share links could be created for any stage and could carry broader
-- client permissions. Keep their audit records but revoke every active token
-- before enforcing the narrower client-review contract below.
update public.role_share_links
set revoked_at=coalesce(revoked_at,now()),allow_decisions=false
where revoked_at is null;

create or replace function private.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text,p_allow_decisions boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_field_keys text[];
 v_static text[] := array['full_name','headline','current_company','current_designation','location',
  'total_experience_years','rating','stage_entered_at','client_notes'];
begin
 perform private.require_admin(auth.uid());
 if p_stage is distinct from 'recruiter_shortlisted' then
  raise exception 'LS: Client links can only share Recruiter shortlisted candidates.'; end if;
 if p_visible_columns is null or cardinality(p_visible_columns)=0 or not ('client_notes'=any(p_visible_columns)) then
  raise exception 'LS: A client link must include Notes.'; end if;
 if p_editable_columns is distinct from array['client_notes']::text[] then
  raise exception 'LS: Clients can edit Notes only.'; end if;
 if coalesce(p_allow_decisions,false) then
  raise exception 'LS: Client links cannot move or reject candidates.'; end if;
 if p_token_hash is null or length(p_token_hash)<>64 or p_token_prefix is null or length(p_token_prefix)<>8 then
  raise exception 'LS: Invalid share token.'; end if;
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 perform 1 from public.roles where id=p_role and client_id=p_client for update;
 if not found then raise exception 'LS: Role not found.'; end if;
 select array_agg(key) into v_field_keys from public.role_fields where role_id=p_role and not archived;
 if exists(
  select 1 from unnest(p_visible_columns) col
  where not (col=any(v_static)) and not (col=any(coalesce(v_field_keys,'{}')))
 ) then raise exception 'LS: One of the selected columns is not available for this role.'; end if;
 insert into public.role_share_links(client_id,role_id,stage,token_hash,token_prefix,
  visible_columns,editable_columns,allow_decisions,expires_at,created_by)
 values(p_client,p_role,p_stage,p_token_hash,p_token_prefix,p_visible_columns,
  array['client_notes'],false,p_expires_at,auth.uid())
 returning id into v_id;
 return v_id;
end $$;

create or replace function private.regenerate_share_link(p_id uuid,p_token_hash text,p_token_prefix text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 if p_token_hash is null or length(p_token_hash)<>64 or p_token_prefix is null or length(p_token_prefix)<>8 then
  raise exception 'LS: Invalid share token.'; end if;
 update public.role_share_links
 set token_hash=p_token_hash,token_prefix=p_token_prefix,revoked_at=null,last_viewed_at=null
 where id=p_id and stage='recruiter_shortlisted'
  and editable_columns=array['client_notes']::text[] and not allow_decisions
  and 'client_notes'=any(visible_columns);
 if found then return; end if;
 if exists(select 1 from public.role_share_links where id=p_id) then
  raise exception 'LS: Create a new client link to use the current sharing rules.';
 end if;
 raise exception 'LS: Share link not found.';
end $$;

create or replace function private.read_shared_stage(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.role_share_links; role_row public.roles; client_row public.clients;
 field_defs jsonb; result_rows jsonb; begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
 if link.stage<>'recruiter_shortlisted' or link.editable_columns is distinct from array['client_notes']::text[]
  or link.allow_decisions or not ('client_notes'=any(link.visible_columns)) then
  raise exception 'LS: This link does not meet the current client sharing rules.'; end if;
 select * into role_row from public.roles where id=link.role_id;
 select * into client_row from public.clients where id=link.client_id;
 update public.role_share_links set last_viewed_at=now() where id=link.id;
 select coalesce(jsonb_agg(jsonb_build_object('key',f.key,'label',f.label,'kind',f.kind,'options',f.options)
   order by f.ordinal),'[]'::jsonb)
  into field_defs
  from public.role_fields f where f.role_id=link.role_id and not f.archived and f.key=any(link.visible_columns);
 select coalesce(jsonb_agg(proj.row_json order by proj.stage_entered_at desc),'[]'::jsonb) into result_rows
 from public.role_candidates rc join public.candidates c on c.id=rc.candidate_id,
 lateral (
  select rc.stage_entered_at,jsonb_strip_nulls(jsonb_build_object(
   'id',rc.id,
   'full_name',case when 'full_name'=any(link.visible_columns) then c.full_name end,
   'headline',case when 'headline'=any(link.visible_columns) then c.headline end,
   'current_company',case when 'current_company'=any(link.visible_columns) then c.current_company end,
   'current_designation',case when 'current_designation'=any(link.visible_columns) then c.current_designation end,
   'location',case when 'location'=any(link.visible_columns) then c.location end,
   'total_experience_years',case when 'total_experience_years'=any(link.visible_columns) then c.total_experience_years end,
   'rating',case when 'rating'=any(link.visible_columns) then rc.rating end,
   'stage_entered_at',case when 'stage_entered_at'=any(link.visible_columns) then rc.stage_entered_at end,
   'client_notes',case when 'client_notes'=any(link.visible_columns) then rc.client_notes end,
   'custom',(select jsonb_object_agg(k,rc.custom->k) from unnest(link.visible_columns) k where rc.custom ? k)
  )) as row_json
 ) proj
 where rc.role_id=link.role_id and rc.stage='recruiter_shortlisted';
 return jsonb_build_object(
  'clientName',client_row.name,'roleName',role_row.name,'stage','recruiter_shortlisted',
  'visibleColumns',link.visible_columns,'editableColumns',array['client_notes'],
  'allowDecisions',false,'fields',field_defs,'rows',result_rows,'lastViewedAt',link.last_viewed_at
 );
end $$;

create or replace function private.write_shared_cell(p_token_hash text,p_role_candidate uuid,p_column text,p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare link public.role_share_links; rc public.role_candidates; v_recent integer; v_previous jsonb;
begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
 if link.stage<>'recruiter_shortlisted' or link.editable_columns is distinct from array['client_notes']::text[] or link.allow_decisions then
  raise exception 'LS: This link does not meet the current client sharing rules.'; end if;
 if p_column<>'client_notes' then raise exception 'LS: Clients can edit Notes only.'; end if;
 if p_value is not null and jsonb_typeof(p_value)<>'string' then raise exception 'LS: Enter text for Notes.'; end if;
 if p_value is not null and length(p_value#>>'{}')>4000 then raise exception 'LS: Shorten this note before saving.'; end if;
 select count(*) into v_recent from public.role_candidate_events
 where share_link_id=link.id and created_at>now()-interval '1 minute';
 if v_recent>=60 then raise exception 'LS: Too many changes in a short time. Wait a moment and try again.'; end if;
 select * into rc from public.role_candidates
 where id=p_role_candidate and role_id=link.role_id and stage='recruiter_shortlisted' for update;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 v_previous:=to_jsonb(rc.client_notes);
 update public.role_candidates set client_notes=coalesce(p_value#>>'{}',''),updated_at=now() where id=rc.id;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,share_link_id,detail)
 values(rc.client_id,rc.id,'client_edit',null,link.id,
  jsonb_build_object('column','client_notes','previousValue',v_previous,'value',p_value));
end $$;

create or replace function private.write_client_decision(p_token_hash text,p_role_candidate uuid,
 p_decision text,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 raise exception 'LS: Client links cannot move or reject candidates.';
end $$;

commit;
