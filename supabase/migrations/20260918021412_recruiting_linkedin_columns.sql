begin;

-- LinkedIn is the canonical candidate identity in the recruiting workflow.
-- Keep it visible on links that already satisfy the current, Notes-only
-- client-sharing contract. This changes presentation only; it does not widen
-- client edit permissions or expose any other candidate identity.
update public.role_share_links
set visible_columns=array_append(visible_columns,'linkedin')
where stage='recruiter_shortlisted'
 and editable_columns=array['client_notes']::text[]
 and not allow_decisions
 and not ('linkedin'=any(visible_columns));

create or replace function private.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text,p_allow_decisions boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_field_keys text[];
 v_static text[] := array['full_name','linkedin','headline','current_company','current_designation','location',
  'total_experience_years','rating','stage_entered_at','client_notes'];
begin
 perform private.require_admin(auth.uid());
 if p_stage is distinct from 'recruiter_shortlisted' then
  raise exception 'LS: Client links can only share Recruiter shortlisted candidates.'; end if;
 if p_visible_columns is null or cardinality(p_visible_columns)=0 or not ('client_notes'=any(p_visible_columns)) then
  raise exception 'LS: A client link must include Notes.'; end if;
 if not ('linkedin'=any(p_visible_columns)) then
  p_visible_columns:=array_append(p_visible_columns,'linkedin');
 end if;
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

create or replace function private.read_shared_stage(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.role_share_links; role_row public.roles; client_row public.clients;
 field_defs jsonb; result_rows jsonb; begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
 if link.stage<>'recruiter_shortlisted' or link.editable_columns is distinct from array['client_notes']::text[]
  or link.allow_decisions or not ('client_notes'=any(link.visible_columns))
  or not ('linkedin'=any(link.visible_columns)) then
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
   'linkedin',case when 'linkedin'=any(link.visible_columns) then
    (select min(i.normalized_value) from public.candidate_identities i
     where i.candidate_id=c.id and i.kind='linkedin') end,
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

revoke all on function private.create_share_link(uuid,uuid,text,text[],text[],timestamptz,text,text,boolean)
 from public,anon,authenticated;
grant execute on function private.create_share_link(uuid,uuid,text,text[],text[],timestamptz,text,text,boolean)
 to authenticated;
revoke all on function private.read_shared_stage(text) from public,anon,authenticated;
grant execute on function private.read_shared_stage(text) to service_role;

commit;
