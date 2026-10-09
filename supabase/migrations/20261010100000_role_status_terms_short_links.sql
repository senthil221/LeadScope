-- Roles: Active, Hired or Closed; no archive; a CTC range and an opening date.
-- Client links: a short readable code, and only the Recruiter shortlisted columns.
--
-- 'open' stays the stored value for Active, because the work queues, Later and
-- profile pushes already test for it; only On hold goes, folded into Active.
-- Archiving is replaced by the Closed status, so archived roles become Closed
-- and visible again under that filter.
begin;

-- What each role was before, so this step can be reversed exactly.
create table private.roles_before_20261010 as select id, status, archived from public.roles where archived or status = 'on_hold';
revoke all on private.roles_before_20261010 from public, anon, authenticated;

alter table public.roles drop constraint if exists roles_status_check;
update public.roles set status = 'open' where status = 'on_hold';
update public.roles set status = 'closed', archived = false where archived;
alter table public.roles add constraint roles_status_check check (status in ('open', 'hired', 'closed'));

create or replace function private.save_role(
  p_id uuid, p_client uuid, p_name text, p_description text, p_threshold numeric, p_status text, p_revision integer
)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.roles;
begin
  perform private.require_admin(auth.uid());
  if p_threshold is null or p_threshold not between 0 and 5 or p_threshold<>round(p_threshold,1) then
    raise exception 'LS: Choose a rating floor from 0.0 to 5.0.';
  end if;
  if p_status is null or p_status not in ('open','hired','closed') then
    raise exception 'LS: Choose Active, Hired or Closed.';
  end if;
  if length(trim(coalesce(p_name,'')))=0 or length(p_name)>120 then
    raise exception 'LS: Enter a role name.';
  end if;
  perform 1 from public.clients where id=p_client and not archived for update;
  if not found then
    raise exception 'LS: Restore this client before editing roles.';
  end if;
  if p_id is null then
    insert into public.roles(client_id,name,description,rating_threshold,status)
      values(p_client,trim(p_name),coalesce(p_description,''),p_threshold,p_status)
      returning * into r;
  else
    select * into r from public.roles where id=p_id and client_id=p_client for update;
    if not found then
      raise exception 'LS: Role not found.';
    end if;
    if r.revision is distinct from p_revision then
      raise exception 'LS: Another operator saved changes. Reload before saving.';
    end if;
    update public.roles
      set name=trim(p_name), description=coalesce(p_description,''), rating_threshold=p_threshold,
          status=p_status, revision=revision+1, updated_at=now()
      where id=r.id
      returning * into r;
  end if;
  return r.id;
end $$;

-- CTC as a range in lakhs per annum, and the day the role opened.
alter table public.roles
  add column ctc_min numeric(7,2) check (ctc_min >= 0 and ctc_min <= 10000),
  add column ctc_max numeric(7,2) check (ctc_max >= 0 and ctc_max <= 10000),
  add column opened_on date;
alter table public.roles add constraint roles_ctc_range check (ctc_min is null or ctc_max is null or ctc_min <= ctc_max);
update public.roles set opened_on = (created_at at time zone 'Asia/Kolkata')::date;
alter table public.roles alter column opened_on set default current_date, alter column opened_on set not null;

-- What was typed as text, read as a range where it plainly is one:
-- "12-18 LPA" is 12 to 18, "15 LPA" is up to 15. Anything else stays text only.
with parsed as (
  select id,
    regexp_match(ctc, '(\d+(?:\.\d+)?)\s*(?:lpa|l|lakhs?)?\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)', 'i') as pair,
    regexp_match(ctc, '(\d+(?:\.\d+)?)') as one
  from public.roles where ctc ~ '\d'
)
update public.roles r
  set ctc_min = case when p.pair is not null then p.pair[1]::numeric end,
      ctc_max = coalesce(p.pair[2], p.one[1])::numeric
  from parsed p
  where r.id = p.id
    and coalesce(p.pair[2], p.one[1])::numeric <= 10000
    and (p.pair is null or p.pair[1]::numeric <= p.pair[2]::numeric);

create function private.lpa_text(p numeric) returns text language sql immutable set search_path='' as $$
  select case when p = trunc(p) then trunc(p)::text else rtrim(p::text, '0') end;
$$;

-- One save for the whole form, so the range, the date and the rest land together.
create function private.save_role_v2(
  p_id uuid, p_client uuid, p_name text, p_description text, p_threshold numeric, p_status text, p_revision integer,
  p_recruiters text[], p_brief text, p_ctc_min numeric, p_ctc_max numeric, p_opened_on date
)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; v_ctc text;
begin
  perform private.require_admin(auth.uid());
  if (p_ctc_min is not null and p_ctc_min not between 0 and 10000) or (p_ctc_max is not null and p_ctc_max not between 0 and 10000)
    or (p_ctc_min is not null and p_ctc_max is not null and p_ctc_min > p_ctc_max) then
    raise exception 'LS: Enter a CTC range in LPA, lowest first.';
  end if;
  if p_opened_on is not null and p_opened_on not between date '2000-01-01' and current_date + 366 then
    raise exception 'LS: Check the date of opening.';
  end if;
  v_ctc := case
    when p_ctc_min is not null and p_ctc_max is not null and p_ctc_min = p_ctc_max then private.lpa_text(p_ctc_max) || ' LPA'
    when p_ctc_min is not null and p_ctc_max is not null then private.lpa_text(p_ctc_min) || '–' || private.lpa_text(p_ctc_max) || ' LPA'
    when p_ctc_max is not null then 'Up to ' || private.lpa_text(p_ctc_max) || ' LPA'
    when p_ctc_min is not null then private.lpa_text(p_ctc_min) || '+ LPA'
    else '' end;
  rid := private.save_role_details(p_id, p_client, p_name, p_description, p_threshold, p_status, p_revision, p_recruiters, v_ctc, p_brief);
  update public.roles set ctc_min = p_ctc_min, ctc_max = p_ctc_max, opened_on = coalesce(p_opened_on, opened_on, current_date) where id = rid;
  return rid;
end $$;
create function public.save_role_v2(
  p_id uuid, p_client uuid, p_name text, p_description text, p_threshold numeric, p_status text, p_revision integer,
  p_recruiters text[], p_brief text, p_ctc_min numeric, p_ctc_max numeric, p_opened_on date
)
returns uuid language sql security invoker set search_path='' as $$
  select private.save_role_v2(p_id, p_client, p_name, p_description, p_threshold, p_status, p_revision, p_recruiters, p_brief, p_ctc_min, p_ctc_max, p_opened_on);
$$;
revoke all on function private.save_role_v2(uuid,uuid,text,text,numeric,text,integer,text[],text,numeric,numeric,date) from public, anon, authenticated;
revoke all on function public.save_role_v2(uuid,uuid,text,text,numeric,text,integer,text[],text,numeric,numeric,date) from public, anon, authenticated;
grant execute on function private.save_role_v2(uuid,uuid,text,text,numeric,text,integer,text[],text,numeric,numeric,date) to authenticated;
grant execute on function public.save_role_v2(uuid,uuid,text,text,numeric,text,integer,text[],text,numeric,numeric,date) to authenticated;
revoke all on function private.lpa_text(numeric) from public, anon;

-- Short client links: /c/<client>/<role>-<code>. The names are for reading;
-- the code alone finds the link, so renaming a role never breaks one.
alter table private.role_client_links add column short_code text unique check (short_code ~ '^[a-z2-9]{6}$');

-- The app supplies a fresh random code; it is kept only if the link has none.
drop function public.get_role_share_link(uuid,uuid,text,text);
drop function private.get_role_share_link(uuid,uuid,text,text);
create function private.get_role_share_link(p_client uuid,p_role uuid,p_token text,p_hash text,p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_link private.role_client_links; v_id uuid; begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles where id=p_role and client_id=p_client for update;
 if not found then raise exception 'LS: Role not found.'; end if;
 if p_code is null or p_code !~ '^[a-z2-9]{6}$' then raise exception 'LS: Invalid share code.'; end if;
 select * into v_link from private.role_client_links where role_id=p_role;
 if found then
  if exists(select 1 from public.role_share_links where id=v_link.share_link_id and revoked_at is not null) then
   raise exception 'LS: This role link was revoked. Contact the workspace owner.';
  end if;
  if v_link.short_code is null then
   update private.role_client_links set short_code=p_code where role_id=p_role returning * into v_link;
  end if;
  return jsonb_build_object('id',v_link.share_link_id,'token',v_link.token,'code',v_link.short_code);
 end if;
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_hash is null or p_hash<>encode(sha256(convert_to(p_token,'UTF8')),'hex') then
  raise exception 'LS: Invalid share token.'; end if;
 insert into public.role_share_links(client_id,role_id,stage,token_hash,token_prefix,
  visible_columns,editable_columns,allow_decisions,expires_at,created_by)
 values(p_client,p_role,'recruiter_shortlisted',p_hash,left(p_token,8),
  array['full_name','linkedin','client_notes'],array['client_notes'],false,null,auth.uid()) returning id into v_id;
 insert into private.role_client_links(role_id,share_link_id,token,short_code) values(p_role,v_id,p_token,p_code);
 return jsonb_build_object('id',v_id,'token',p_token,'code',p_code);
end $$;
create function public.get_role_share_link(p_client uuid,p_role uuid,p_token text,p_hash text,p_code text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.get_role_share_link(p_client,p_role,p_token,p_hash,p_code);
$$;
revoke all on function private.get_role_share_link(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.get_role_share_link(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.get_role_share_link(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.get_role_share_link(uuid,uuid,text,text,text) to authenticated;

-- Only the server, holding the integration key, turns a code back into its link.
create function private.share_token_for_code(p_code text) returns text language sql stable security definer set search_path='' as $$
 select token from private.role_client_links where p_code ~ '^[a-z2-9]{6}$' and short_code = p_code;
$$;
create function public.share_token_for_code(p_code text) returns text language sql stable security invoker set search_path='' as $$
 select private.share_token_for_code(p_code);
$$;
revoke all on function private.share_token_for_code(text), public.share_token_for_code(text) from public, anon, authenticated;
grant execute on function private.share_token_for_code(text), public.share_token_for_code(text) to service_role;

-- The client sees what the Recruiter shortlisted tab shows, plus their own
-- feedback and the stage. Ratings, sources, offers and internal notes stay in.
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
 cols:=array['created_at','stage','full_name','linkedin','phone','alternate_phone','email','location',
  'current_company','current_designation','total_experience_years','current_ctc','highest_qualification','resume','client_notes'];
 select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'kind',kind,'options',options) order by ordinal),'[]')
 into field_defs from public.role_fields where role_id=link.role_id and not archived;
 select cols || coalesce(array_agg(key order by ordinal),'{}') into cols
 from public.role_fields where role_id=link.role_id and not archived;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',rc.id,'full_name',c.full_name,'stage',rc.stage,'created_at',rc.created_at,
  'linkedin',(select min(normalized_value) from public.candidate_identities where candidate_id=c.id and kind='linkedin'),
  'phone',c.phone,'alternate_phone',c.alternate_phone,'email',c.email,'location',c.location,
  'current_company',c.current_company,'current_designation',c.current_designation,
  'total_experience_years',c.total_experience_years,'current_ctc',c.current_ctc,'highest_qualification',c.highest_qualification,
  'resume',case when c.resume_path is not null then rc.id::text end,
  'client_notes',rc.client_notes,
  'custom',(select coalesce(jsonb_object_agg(f.key,rc.custom->f.key),'{}') from public.role_fields f
   where f.role_id=rc.role_id and not f.archived and rc.custom ? f.key)
 ) order by rc.created_at desc,rc.id),'[]') into result_rows
 from public.role_candidates rc join public.candidates c on c.id=rc.candidate_id
 where rc.role_id=link.role_id and rc.stage in ('recruiter_shortlisted','client_shortlisted','offer_sent');
 return jsonb_build_object('clientName',(select name from public.clients where id=link.client_id),
  'roleName',(select name from public.roles where id=link.role_id),'stage','recruiter_shortlisted',
  'visibleColumns',cols,'editableColumns',array['client_notes'],'fields',field_defs,'rows',result_rows);
end $$;

notify pgrst, 'reload schema';
commit;
