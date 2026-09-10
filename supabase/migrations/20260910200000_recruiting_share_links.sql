-- Recruiting stage sharing, read-only. The first surface in this project
-- reachable by anon: a client opens /share/[token] with no login. anon gets
-- no grant on any table here and no execute grant on read_shared_stage —
-- that function is service_role only, called from a Next.js server
-- component that ships no Supabase client to the browser. A valid,
-- unexpired, unrevoked token is the entire authorization; there is no
-- require_admin() in the read path because the reader is never an agency
-- admin. Writing back is a later migration; every column this phase can
-- expose is projected read-only.
begin;

create table public.role_share_links (
 id uuid primary key default gen_random_uuid(), client_id uuid not null, role_id uuid not null,
 stage text not null
  check(stage in ('all_profiles','profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent','rejected')),
 -- Only the hash is ever stored. The raw token is returned once, at
 -- creation or regeneration, and cannot be recovered afterward.
 token_hash text not null unique,
 token_prefix text not null check(length(token_prefix)=8),
 visible_columns text[] not null default '{}',
 editable_columns text[] not null default '{}',
 allow_decisions boolean not null default false,
 expires_at timestamptz,
 revoked_at timestamptz,
 created_by uuid references public.user_profiles(id),
 created_at timestamptz not null default now(),
 last_viewed_at timestamptz,
 unique(id,client_id),
 foreign key(role_id,client_id) references public.roles(id,client_id),
 -- Enforced by the table, not only by the RPC that writes it: internal
 -- notes can never end up in a share link's projection.
 constraint internal_notes_never_shared check(
  not ('internal_notes'=any(visible_columns)) and not ('internal_notes'=any(editable_columns))
 ),
 constraint editable_subset_of_visible check(editable_columns <@ visible_columns)
);
create index role_share_links_role on public.role_share_links(role_id,stage,revoked_at);

alter table public.role_share_links enable row level security;
revoke all on public.role_share_links from anon, authenticated;
grant select on public.role_share_links to authenticated;
grant all on public.role_share_links to service_role;
create policy admin_read on public.role_share_links for select to authenticated using ((select private.is_admin()));

-- Phase 1 left this column for exactly this table. Nullable, so a MATCH
-- SIMPLE default lets every existing and future non-shared event through
-- untouched; only a row that sets share_link_id is ever validated against it.
alter table public.role_candidate_events
 add constraint role_candidate_events_share_link_fkey
 foreign key(share_link_id,client_id) references public.role_share_links(id,client_id);

-- The raw token is generated and hashed in Node (matching queries.ts's own
-- signature() helper: createHash("sha256")...) rather than in SQL, so this
-- function never depends on pgcrypto being installed, or on which schema it
-- happens to live in on a given project. Only the hash and an 8-char prefix
-- for the UI's link list ever reach the database; the raw token is never
-- stored anywhere and is returned to the caller exactly once, by the API
-- route that generated it, not by this function.
create function private.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_field_keys text[];
 v_static text[] := array['full_name','headline','current_company','current_designation','location',
  'total_experience_years','rating','stage_entered_at','client_notes','client_decision','interview_at'];
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
 insert into public.role_share_links(client_id,role_id,stage,token_hash,token_prefix,
  visible_columns,editable_columns,expires_at,created_by)
  values(p_client,p_role,p_stage,p_token_hash,p_token_prefix,p_visible_columns,
   coalesce(p_editable_columns,'{}'),p_expires_at,auth.uid())
  returning id into v_id;
 return v_id;
end $$;

-- Revocation is one-directional: there is no un-revoke. A token that leaked
-- stays dead; regenerate issues a new secret instead of reviving the old one.
create function private.revoke_share_link(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 update public.role_share_links set revoked_at=coalesce(revoked_at,now()) where id=p_id;
 if not found then raise exception 'LS: Share link not found.'; end if;
end $$;

-- Same Node-side generation as create_share_link, for the same reason.
create function private.regenerate_share_link(p_id uuid,p_token_hash text,p_token_prefix text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 if p_token_hash is null or length(p_token_hash)<>64 or p_token_prefix is null or length(p_token_prefix)<>8 then
  raise exception 'LS: Invalid share token.'; end if;
 update public.role_share_links set token_hash=p_token_hash,token_prefix=p_token_prefix,
  revoked_at=null,last_viewed_at=null where id=p_id;
 if not found then raise exception 'LS: Share link not found.'; end if;
end $$;

-- No require_admin: possession of a valid, unrevoked, unexpired token is the
-- entire authorization, exactly like a Google Sheets share link. Every
-- static and custom value is only included in the output when its key
-- literally appears in visible_columns — jsonb_strip_nulls removes the rest,
-- so an invisible column is never a key in the response, not merely blank.
create function private.read_shared_stage(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare link public.role_share_links; role_row public.roles; client_row public.clients;
 field_defs jsonb; result_rows jsonb; begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
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
  select rc.stage_entered_at, jsonb_strip_nulls(jsonb_build_object(
   'id', rc.id,
   'full_name', case when 'full_name'=any(link.visible_columns) then c.full_name end,
   'headline', case when 'headline'=any(link.visible_columns) then c.headline end,
   'current_company', case when 'current_company'=any(link.visible_columns) then c.current_company end,
   'current_designation', case when 'current_designation'=any(link.visible_columns) then c.current_designation end,
   'location', case when 'location'=any(link.visible_columns) then c.location end,
   'total_experience_years', case when 'total_experience_years'=any(link.visible_columns) then c.total_experience_years end,
   'rating', case when 'rating'=any(link.visible_columns) then rc.rating end,
   'stage_entered_at', case when 'stage_entered_at'=any(link.visible_columns) then rc.stage_entered_at end,
   'client_notes', case when 'client_notes'=any(link.visible_columns) then rc.client_notes end,
   'client_decision', case when 'client_decision'=any(link.visible_columns) then rc.client_decision end,
   'interview_at', case when 'interview_at'=any(link.visible_columns) then rc.interview_at end,
   -- Deliberately not coalesced to '{}': jsonb_object_agg returns SQL NULL
   -- over zero rows, and jsonb_strip_nulls then drops the key entirely, so a
   -- row with no visible custom values omits "custom" rather than sending an
   -- empty object.
   'custom', (select jsonb_object_agg(k,rc.custom->k)
    from unnest(link.visible_columns) k where rc.custom ? k)
  )) as row_json
 ) proj
 where rc.role_id=link.role_id and rc.stage=link.stage;

 return jsonb_build_object(
  'clientName', client_row.name, 'roleName', role_row.name, 'stage', link.stage,
  'visibleColumns', link.visible_columns, 'editableColumns', link.editable_columns,
  'allowDecisions', link.allow_decisions, 'fields', field_defs, 'rows', result_rows,
  'lastViewedAt', link.last_viewed_at
 );
end $$;

-- PostgREST (and so supabase-js's .rpc()) can only ever call a function that
-- lives in the public schema; this wrapper is what makes the call reachable
-- at all, gated entirely by the grant below rather than by anything it does.
create function public.read_shared_stage(p_token_hash text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.read_shared_stage(p_token_hash);
$$;
create function public.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text)
returns uuid language sql security invoker set search_path='' as $$
 select private.create_share_link(p_client,p_role,p_stage,p_visible_columns,p_editable_columns,
  p_expires_at,p_token_hash,p_token_prefix);
$$;
create function public.revoke_share_link(p_id uuid)
returns void language sql security invoker set search_path='' as $$
 select private.revoke_share_link(p_id);
$$;
create function public.regenerate_share_link(p_id uuid,p_token_hash text,p_token_prefix text)
returns void language sql security invoker set search_path='' as $$
 select private.regenerate_share_link(p_id,p_token_hash,p_token_prefix);
$$;

do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in
   ('create_share_link','revoke_share_link','regenerate_share_link') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

-- read_shared_stage is reachable only from the server component using the
-- service-role client. Neither anon nor authenticated ever gets execute on
-- it, on either the private implementation or the public wrapper.
revoke all on function private.read_shared_stage(text) from public,anon,authenticated;
revoke all on function public.read_shared_stage(text) from public,anon,authenticated;
grant execute on function private.read_shared_stage(text) to service_role;
grant execute on function public.read_shared_stage(text) to service_role;

commit;
