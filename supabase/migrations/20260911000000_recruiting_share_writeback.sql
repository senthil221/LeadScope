-- Client edits write back through the same token that reads a shared stage.
-- Only client_notes, interview_at, and this role's active custom fields can
-- ever be made editable — never a static candidate field, never rating,
-- and never client_decision, which gets its own guided action in a later
-- phase rather than a raw field edit here. Purely additive except for
-- create_share_link, updated in place (create or replace), matching how
-- 20260908045049_simplify_campaign_criteria.sql updated save_campaign.
begin;

-- Rate-limiting reads role_candidate_events by share_link_id; most rows have
-- no share_link_id at all, so a partial index keeps that check cheap without
-- bloating the index with rows it will never match.
create index role_candidate_events_share_link on public.role_candidate_events(share_link_id,created_at)
 where share_link_id is not null;

-- Phase 1's kind CHECK predates this event kind; widen it rather than edit
-- the applied migration that created it.
alter table public.role_candidate_events drop constraint role_candidate_events_kind_check;
alter table public.role_candidate_events add constraint role_candidate_events_kind_check
 check(kind in ('import','stage','rating','reject','client_decision','screening','client_edit'));

create or replace function private.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_field_keys text[];
 v_static text[] := array['full_name','headline','current_company','current_designation','location',
  'total_experience_years','rating','stage_entered_at','client_notes','client_decision','interview_at'];
 -- Narrower than v_static: what a link is allowed to expose read-only and
 -- what it may let a client write back are different questions.
 v_editable_eligible text[] := array['client_notes','interview_at'];
begin
 perform private.require_admin(auth.uid());
 if p_stage is null or p_stage not in
  ('all_profiles','profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent','rejected') then
  raise exception 'LS: Choose a valid pipeline stage to share.'; end if;
 if p_visible_columns is null or cardinality(p_visible_columns)=0 then
  raise exception 'LS: Choose at least one column to share.'; end if;
 if 'internal_notes'=any(p_visible_columns) or 'internal_notes'=any(coalesce(p_editable_columns,'{}')) then
  raise exception 'LS: Internal notes can never be shared.'; end if;
 if not (coalesce(p_editable_columns,'{}') <@ p_visible_columns) then
  raise exception 'LS: A column must be visible before it can be made editable.'; end if;
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
 if exists(
  select 1 from unnest(coalesce(p_editable_columns,'{}')) col
  where not (col=any(v_editable_eligible)) and not (col=any(coalesce(v_field_keys,'{}')))
 ) then raise exception 'LS: One of the selected columns cannot be made editable.'; end if;
 insert into public.role_share_links(client_id,role_id,stage,token_hash,token_prefix,
  visible_columns,editable_columns,expires_at,created_by)
  values(p_client,p_role,p_stage,p_token_hash,p_token_prefix,p_visible_columns,
   coalesce(p_editable_columns,'{}'),p_expires_at,auth.uid())
  returning id into v_id;
 return v_id;
end $$;

-- No require_admin, same as read_shared_stage: a valid, unrevoked, unexpired
-- token is the entire authorization. The column allowlist is enforced here,
-- once, against the link's own editable_columns — never against a fixed set
-- decided by the caller, since a stale or tampered request must never write
-- somewhere this specific link was not configured to allow.
create function private.write_shared_cell(p_token_hash text,p_role_candidate uuid,p_column text,p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare link public.role_share_links; rc public.role_candidates; v_recent integer; v_kind text;
 v_previous jsonb; begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
 if not (p_column=any(link.editable_columns)) then
  raise exception 'LS: This column cannot be edited from this link.'; end if;
 -- A simple per-link throttle using the same event table this write appends
 -- to: no new infrastructure, and correct regardless of how many server
 -- instances are handling requests, since the database is the single ledger.
 select count(*) into v_recent from public.role_candidate_events
  where share_link_id=link.id and created_at>now()-interval '1 minute';
 if v_recent>=60 then raise exception 'LS: Too many changes in a short time. Wait a moment and try again.'; end if;
 select * into rc from public.role_candidates
  where id=p_role_candidate and role_id=link.role_id and stage=link.stage for update;
 if not found then raise exception 'LS: Candidate not found.'; end if;

 if p_column='client_notes' then
  v_previous:=to_jsonb(rc.client_notes);
  if p_value is not null and jsonb_typeof(p_value)<>'string' then raise exception 'LS: Enter text for this field.'; end if;
  if p_value is not null and length(p_value#>>'{}')>4000 then raise exception 'LS: Shorten this note before saving.'; end if;
  update public.role_candidates set client_notes=coalesce(p_value#>>'{}',''),updated_at=now() where id=rc.id;
 elsif p_column='interview_at' then
  v_previous:=to_jsonb(rc.interview_at);
  if p_value is not null and jsonb_typeof(p_value)<>'string' then raise exception 'LS: Enter a valid date.'; end if;
  begin
   update public.role_candidates set interview_at=(p_value#>>'{}')::timestamptz,updated_at=now() where id=rc.id;
  exception when others then raise exception 'LS: Enter a valid date.'; end;
 else
  select kind into v_kind from public.role_fields where role_id=link.role_id and key=p_column and not archived;
  if v_kind is null then raise exception 'LS: This column no longer exists.'; end if;
  v_previous:=rc.custom->p_column;
  if p_value is not null then
   if v_kind='number' and jsonb_typeof(p_value)<>'number' then raise exception 'LS: Enter a number for this column.'; end if;
   if v_kind='boolean' and jsonb_typeof(p_value)<>'boolean' then raise exception 'LS: Choose yes or no for this column.'; end if;
   if v_kind in ('text','date','select') and jsonb_typeof(p_value)<>'string' then
    raise exception 'LS: Enter text for this column.'; end if;
   if v_kind in ('text','date','select') and length(p_value#>>'{}')>2000 then
    raise exception 'LS: Shorten this value before saving.'; end if;
  end if;
  update public.role_candidates set
   custom=case when p_value is null then custom-p_column else jsonb_set(custom,array[p_column],p_value,true) end,
   updated_at=now() where id=rc.id;
 end if;

 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,share_link_id,detail)
  values(rc.client_id,rc.id,'client_edit',null,link.id,
   jsonb_build_object('column',p_column,'previousValue',v_previous,'value',p_value));
end $$;

create or replace function public.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text)
returns uuid language sql security invoker set search_path='' as $$
 select private.create_share_link(p_client,p_role,p_stage,p_visible_columns,p_editable_columns,
  p_expires_at,p_token_hash,p_token_prefix);
$$;
create function public.write_shared_cell(p_token_hash text,p_role_candidate uuid,p_column text,p_value jsonb)
returns void language sql security invoker set search_path='' as $$
 select private.write_shared_cell(p_token_hash,p_role_candidate,p_column,p_value);
$$;

-- write_shared_cell follows read_shared_stage exactly: service_role only,
-- reachable only from /api/share/[token] via the service-role client, never
-- from anon or a logged-in admin's own session.
revoke all on function private.write_shared_cell(text,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.write_shared_cell(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.write_shared_cell(text,uuid,text,jsonb) to service_role;
grant execute on function public.write_shared_cell(text,uuid,text,jsonb) to service_role;

commit;
