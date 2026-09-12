-- Client decisions: a share link created with allow_decisions can let its
-- viewer Shortlist, Reject, or put a candidate On hold, without a raw column
-- edit. A client Reject is not advisory — it runs the same reject path the
-- recruiter's own reject_candidate uses (stage -> 'rejected', a mandatory
-- reason, one event row), just attributed to the link instead of an admin.
-- create_share_link's signature must grow by one column; CREATE OR REPLACE
-- FUNCTION cannot add a parameter, so both overloads are dropped and
-- recreated here rather than edited in the applied migration that defined
-- them.
begin;

drop function public.create_share_link(uuid,uuid,text,text[],text[],timestamptz,text,text);
drop function private.create_share_link(uuid,uuid,text,text[],text[],timestamptz,text,text);

create function private.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text,p_allow_decisions boolean default false)
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
  visible_columns,editable_columns,allow_decisions,expires_at,created_by)
  values(p_client,p_role,p_stage,p_token_hash,p_token_prefix,p_visible_columns,
   coalesce(p_editable_columns,'{}'),coalesce(p_allow_decisions,false),p_expires_at,auth.uid())
  returning id into v_id;
 return v_id;
end $$;

-- Same trust boundary as write_shared_cell: no require_admin, the token plus
-- allow_decisions is the entire authorization, and the row must still be in
-- this link's own role and stage. A decision is a client-scoped signal
-- (client_decision), independent of the pipeline stage the recruiter drives
-- with move_stage -- except Reject, which is not advisory and always moves
-- the row to the same terminal 'rejected' stage a recruiter reject would.
create function private.write_client_decision(p_token_hash text,p_role_candidate uuid,
 p_decision text,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare link public.role_share_links; rc public.role_candidates; v_recent integer;
begin
 select * into link from public.role_share_links where token_hash=p_token_hash;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 if link.revoked_at is not null then raise exception 'LS: This link has been revoked.'; end if;
 if link.expires_at is not null and link.expires_at<=now() then raise exception 'LS: This link has expired.'; end if;
 if not link.allow_decisions then raise exception 'LS: This link cannot record decisions.'; end if;
 if p_decision is null or p_decision not in ('shortlisted','rejected','hold') then
  raise exception 'LS: Choose Shortlist, Hold, or Reject.'; end if;
 if p_decision='rejected' and length(trim(coalesce(p_reason,'')))=0 then
  raise exception 'LS: Enter a reason to reject this candidate.'; end if;
 if length(coalesce(p_reason,''))>4000 then raise exception 'LS: Shorten this reason before saving.'; end if;
 -- Same per-link throttle write_shared_cell uses, on the same counter: a
 -- decision and a cell edit from one link share one budget.
 select count(*) into v_recent from public.role_candidate_events
  where share_link_id=link.id and created_at>now()-interval '1 minute';
 if v_recent>=60 then raise exception 'LS: Too many changes in a short time. Wait a moment and try again.'; end if;
 select * into rc from public.role_candidates
  where id=p_role_candidate and role_id=link.role_id and stage=link.stage for update;
 if not found then raise exception 'LS: Candidate not found.'; end if;

 if p_decision='rejected' then
  update public.role_candidates set client_decision='rejected',stage='rejected',stage_entered_at=now(),
   updated_at=now(),rejected_at=now(),rejected_by=null,rejection_type='client',rejection_reason=p_reason
   where id=rc.id;
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,
   share_link_id,reason,detail)
   values(rc.client_id,rc.id,'reject',rc.stage,'rejected',null,link.id,p_reason,
    jsonb_build_object('rejectionType','client'));
 else
  update public.role_candidates set client_decision=p_decision,updated_at=now() where id=rc.id;
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,share_link_id,detail)
   values(rc.client_id,rc.id,'client_decision',null,link.id,
    jsonb_build_object('decision',p_decision,'reason',coalesce(p_reason,'')));
 end if;
end $$;

create function public.create_share_link(p_client uuid,p_role uuid,p_stage text,
 p_visible_columns text[],p_editable_columns text[],p_expires_at timestamptz,
 p_token_hash text,p_token_prefix text,p_allow_decisions boolean default false)
returns uuid language sql security invoker set search_path='' as $$
 select private.create_share_link(p_client,p_role,p_stage,p_visible_columns,p_editable_columns,
  p_expires_at,p_token_hash,p_token_prefix,p_allow_decisions);
$$;
create function public.write_client_decision(p_token_hash text,p_role_candidate uuid,
 p_decision text,p_reason text)
returns void language sql security invoker set search_path='' as $$
 select private.write_client_decision(p_token_hash,p_role_candidate,p_decision,p_reason);
$$;

do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname='create_share_link' loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

-- write_client_decision follows write_shared_cell exactly: service_role only,
-- reachable solely from /api/share/[token]/decision via the service-role
-- client, never from anon or a logged-in admin's own session.
revoke all on function private.write_client_decision(text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.write_client_decision(text,uuid,text,text) from public,anon,authenticated;
grant execute on function private.write_client_decision(text,uuid,text,text) to service_role;
grant execute on function public.write_client_decision(text,uuid,text,text) to service_role;

commit;
