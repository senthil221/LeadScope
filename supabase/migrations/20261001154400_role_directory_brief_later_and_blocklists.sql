begin;

alter table public.roles
 add column recruiter_names text[] not null default '{}' check(cardinality(recruiter_names)<=20),
 add column ctc text not null default '' check(length(ctc)<=200),
 add column role_brief text not null default '' check(length(role_brief)<=50000),
 add column jd_path text,
 add column jd_name text not null default '' check(length(jd_name)<=255);
create index roles_recruiter_tags on public.roles using gin(recruiter_names);
alter table public.role_candidates
 add column follow_up_note text not null default '' check(length(follow_up_note)<=4000);
alter table public.role_candidates drop constraint role_candidates_stage_check;
alter table public.role_candidates add constraint role_candidates_stage_check
 check(stage in ('all_profiles','profile_shortlisted','recruiter_shortlisted','client_shortlisted','offer_sent','rejected','later'));

create function private.save_role_details(p_id uuid,p_client uuid,p_name text,p_description text,p_threshold numeric,p_status text,p_revision integer,p_recruiters text[],p_ctc text,p_brief text)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 perform private.require_admin(auth.uid());
 if coalesce(cardinality(p_recruiters),0)>20 or exists(select 1 from unnest(p_recruiters) n where length(trim(n)) not between 1 and 120)
   or length(coalesce(p_ctc,''))>200 or length(coalesce(p_brief,''))>50000 then raise exception 'LS: Check recruiter names, CTC and role brief length.'; end if;
 rid:=private.save_role(p_id,p_client,p_name,p_description,p_threshold,p_status,p_revision);
 update public.roles set recruiter_names=coalesce(p_recruiters,'{}'),ctc=coalesce(p_ctc,''),role_brief=coalesce(p_brief,role_brief) where id=rid;
 return rid;
end $$;
create function public.save_role_details(p_id uuid,p_client uuid,p_name text,p_description text,p_threshold numeric,p_status text,p_revision integer,p_recruiters text[],p_ctc text,p_brief text)
returns uuid language sql security invoker set search_path='' as $$ select private.save_role_details(p_id,p_client,p_name,p_description,p_threshold,p_status,p_revision,p_recruiters,p_ctc,p_brief); $$;

create function private.save_role_jd(p_id uuid,p_path text,p_name text,p_revision integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles r join public.clients c on c.id=r.client_id where r.id=p_id and not r.archived and not c.archived and r.revision=p_revision for update of r;
 if not found then raise exception 'LS: Role changed or is archived. Refresh before attaching the JD.'; end if;
 if p_path is null or p_path not like 'roles/'||p_id::text||'/%' or length(p_name) not between 1 and 255 then raise exception 'LS: Invalid JD attachment.'; end if;
 update public.roles set jd_path=p_path,jd_name=p_name,revision=revision+1,updated_at=now() where id=p_id;
end $$;
create function public.save_role_jd(p_id uuid,p_path text,p_name text,p_revision integer)
returns void language sql security invoker set search_path='' as $$ select private.save_role_jd(p_id,p_path,p_name,p_revision); $$;

-- Holding is a branch, never an automatic step in the main pipeline.
create function private.move_later(p_client uuid,p_ids uuid[],p_restore boolean)
returns void language plpgsql security definer set search_path='' as $$
declare origin text:=case when p_restore then 'later' else 'profile_shortlisted' end;
 target text:=case when p_restore then 'profile_shortlisted' else 'later' end;
begin
 perform private.require_admin(auth.uid());
 if coalesce(cardinality(p_ids),0) not between 1 and 200 then raise exception 'LS: Select between 1 and 200 profiles.'; end if;
 perform 1 from public.clients where id=p_client and not archived for update;
 if not found then raise exception 'LS: Restore this client first.'; end if;
 perform 1 from public.roles where client_id=p_client and id in (select role_id from public.role_candidates where id=any(p_ids)) order by id for update;
 perform 1 from public.role_candidates where client_id=p_client and id=any(p_ids) order by id for update;
 if (select count(*) from public.role_candidates rc join public.roles r on r.id=rc.role_id where rc.client_id=p_client and rc.id=any(p_ids) and rc.stage=origin and not r.archived and r.status='open')<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'LS: Only profiles in the expected stage of an open role can move.'; end if;
 update public.role_candidates set stage=target,stage_entered_at=now(),updated_at=now() where client_id=p_client and id=any(p_ids);
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,from_stage,to_stage,actor,reason)
 select p_client,id,'stage',origin,target,auth.uid(),case when p_restore then 'Returned from Later' else 'Deferred for mobile lookup' end from public.role_candidates where client_id=p_client and id=any(p_ids);
end $$;
create function public.move_later(p_client uuid,p_ids uuid[],p_restore boolean default false)
returns void language sql security invoker set search_path='' as $$ select private.move_later(p_client,p_ids,p_restore); $$;

create function private.save_follow_up_note(p_client uuid,p_id uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 if length(coalesce(p_note,''))>4000 then raise exception 'LS: Keep the follow-up note under 4000 characters.'; end if;
 perform 1 from public.role_candidates rc join public.roles r on r.id=rc.role_id join public.clients c on c.id=r.client_id where rc.id=p_id and rc.client_id=p_client and not r.archived and not c.archived for update of rc;
 if not found then raise exception 'LS: Active role profile not found.'; end if;
 update public.role_candidates set follow_up_note=coalesce(p_note,''),updated_at=now() where id=p_id;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
 values(p_client,p_id,'screening',auth.uid(),jsonb_build_object('field','follow_up_note'));
end $$;
create function public.save_follow_up_note(p_client uuid,p_id uuid,p_note text)
returns void language sql security invoker set search_path='' as $$ select private.save_follow_up_note(p_client,p_id,p_note); $$;

create function private.capture_follow_up_note_edit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.candidate_edit_history(candidate_id,candidate_name,role_id,actor_id,field,before_value,after_value)
 select new.candidate_id,c.full_name,new.role_id,auth.uid(),'follow_up_note',to_jsonb(old.follow_up_note),to_jsonb(new.follow_up_note) from public.candidates c where c.id=new.candidate_id;
 return null;
end $$;
revoke all on function private.capture_follow_up_note_edit() from public,anon,authenticated;
create trigger follow_up_note_edit_history after update of follow_up_note on public.role_candidates
 for each row when(old.follow_up_note is distinct from new.follow_up_note) execute function private.capture_follow_up_note_edit();

create table public.recruiting_blocklist (
 id uuid primary key default gen_random_uuid(),
 client_id uuid references public.clients(id),
 linkedin_url text not null check(length(linkedin_url)<=500 and linkedin_url ~ '^https://www[.]linkedin[.]com/in/[^/?#]+$'),
 note text not null default '' check(length(note)<=4000),
 created_by uuid not null references public.user_profiles(id),
 created_at timestamptz not null default now()
);
create unique index recruiting_blocklist_global on public.recruiting_blocklist(linkedin_url) where client_id is null;
create unique index recruiting_blocklist_client on public.recruiting_blocklist(client_id,linkedin_url) where client_id is not null;
alter table public.recruiting_blocklist enable row level security;
revoke all on public.recruiting_blocklist from public,anon,authenticated;
grant select on public.recruiting_blocklist to authenticated;
grant all on public.recruiting_blocklist to service_role;
create policy admin_read on public.recruiting_blocklist for select to authenticated using ((select private.is_admin()));

create function private.manage_recruiting_blocklist(p_client uuid,p_urls text[],p_note text,p_remove uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform private.require_admin(auth.uid());
 if p_client is not null then
  perform 1 from public.clients where id=p_client for update;
  if not found then raise exception 'LS: Client not found.'; end if;
 end if;
 -- Serialize blocklist changes and membership inserts, including global rules.
 perform pg_advisory_xact_lock(1986987,10);
 if p_remove is not null then
  delete from public.recruiting_blocklist where id=p_remove and client_id is not distinct from p_client;
  get diagnostics n=row_count;
  if n=0 then raise exception 'LS: Blocklist entry not found in this scope.'; end if;
 else
  if coalesce(cardinality(p_urls),0) not between 1 and 200 or length(coalesce(p_note,''))>4000 then raise exception 'LS: Add between 1 and 200 URLs at a time.'; end if;
  insert into public.recruiting_blocklist(client_id,linkedin_url,note,created_by)
   select p_client,u,coalesce(p_note,''),auth.uid() from (select distinct unnest(p_urls) u) urls on conflict do nothing;
  get diagnostics n=row_count;
 end if;
 return n;
end $$;
create function public.manage_recruiting_blocklist(p_client uuid,p_urls text[] default null,p_note text default '',p_remove uuid default null)
returns integer language sql security invoker set search_path='' as $$ select private.manage_recruiting_blocklist(p_client,p_urls,p_note,p_remove); $$;

create function private.enforce_recruiting_blocklist()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(1986987,10);
 if exists(select 1 from public.candidate_identities i join public.recruiting_blocklist b on b.linkedin_url=i.normalized_value and (b.client_id is null or b.client_id=new.client_id) where i.candidate_id=new.candidate_id and i.kind='linkedin') then
  raise exception 'LS: This LinkedIn profile is blocklisted globally or for this client. Remove the blocklist entry before adding it.';
 end if;
 return new;
end $$;
create trigger recruiting_blocklist_membership before insert on public.role_candidates for each row execute function private.enforce_recruiting_blocklist();

-- Prevent a later identity edit from bypassing the membership boundary.
create function private.enforce_blocklisted_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='linkedin' then
  perform pg_advisory_xact_lock(1986987,10);
  if exists(select 1 from public.recruiting_blocklist b join public.role_candidates rc on rc.candidate_id=new.candidate_id where b.linkedin_url=new.normalized_value and (b.client_id is null or b.client_id=rc.client_id)) then raise exception 'LS: This LinkedIn URL is blocklisted for an existing role membership.'; end if;
 end if;
 return new;
end $$;
create trigger recruiting_blocklist_identity before insert or update on public.candidate_identities for each row execute function private.enforce_blocklisted_identity();

do $$ declare signature text; begin
 foreach signature in array array[
  'save_role_details(uuid,uuid,text,text,numeric,text,integer,text[],text,text)',
  'save_role_jd(uuid,text,text,integer)',
  'move_later(uuid,uuid[],boolean)',
  'save_follow_up_note(uuid,uuid,text)',
  'manage_recruiting_blocklist(uuid,text[],text,uuid)'
 ] loop
  execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
  execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
  execute 'grant execute on function private.'||signature||' to authenticated';
  execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $$;
revoke all on function private.enforce_recruiting_blocklist(),private.enforce_blocklisted_identity() from public,anon,authenticated;
create or replace function private.remove_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text)
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid;
begin
 perform private.require_owner(auth.uid());
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Active role not found.'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 2000
    or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then
  raise exception 'LS: Select between 1 and 2000 unique rows.';
 end if;
 perform 1 from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids) order by id for update;
 if (select count(*) from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids)
     and (p_stage is null or p_stage='all_profiles' or stage=p_stage))<>cardinality(p_ids) then
  raise exception 'LS: Some selected rows changed or no longer belong to this stage. Refresh and select them again.';
 end if;
 insert into private.role_candidate_trash(client_id,role_id,deleted_by,records,events)
 values(p_client,p_role,auth.uid(),
  (select jsonb_agg(to_jsonb(rc)) from public.role_candidates rc where id=any(p_ids)),
  coalesce((select jsonb_agg(to_jsonb(e)) from public.role_candidate_events e where role_candidate_id=any(p_ids)),'[]'))
 returning id into batch;
 delete from public.role_candidate_events where role_candidate_id=any(p_ids);
 delete from public.role_candidates where id=any(p_ids) and role_id=p_role and client_id=p_client;
 return batch;
end $$;


notify pgrst,'reload schema';
commit;
