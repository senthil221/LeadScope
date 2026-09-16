-- One role-level snapshot powers the compact client dashboard without loading
-- every candidate membership into the application process.
-- Some early workspaces were created before Follow-ups shipped. Keep this
-- migration safe for those databases rather than requiring a manual repair.
alter table public.role_candidates add column if not exists follow_up_at date;

do $$
declare r record; v_follow_up_at date;
begin
  for r in
    select id, nullif(screening->>'followUpAt','') as follow_up_at
    from public.role_candidates
    where nullif(screening->>'followUpAt','') is not null
  loop
    begin
      v_follow_up_at := r.follow_up_at::date;
    exception when others then
      v_follow_up_at := null;
    end;
    update public.role_candidates set follow_up_at=v_follow_up_at where id=r.id;
  end loop;
end $$;

create index if not exists role_candidates_follow_up_queue
  on public.role_candidates(role_id,follow_up_at,id)
  where follow_up_at is not null and stage<>'rejected';

create or replace function private.save_screening(p_client uuid,p_id uuid,p_screening jsonb,p_internal_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_follow_up_text text; v_follow_up_at date;
begin
  perform private.require_admin(auth.uid());
  if p_screening is null or jsonb_typeof(p_screening)<>'object' then
    raise exception 'LS: Invalid screening data.';
  end if;
  if length(p_screening::text)>8000 then
    raise exception 'LS: Screening notes are too long.';
  end if;
  if length(coalesce(p_internal_notes,''))>4000 then
    raise exception 'LS: Shorten the internal note before saving.';
  end if;
  v_follow_up_text:=nullif(p_screening->>'followUpAt','');
  if v_follow_up_text is not null then
    if v_follow_up_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'LS: Choose a valid follow-up date.';
    end if;
    begin
      v_follow_up_at:=v_follow_up_text::date;
    exception when others then
      raise exception 'LS: Choose a valid follow-up date.';
    end;
  end if;
  perform 1 from public.clients where id=p_client for update;
  update public.role_candidates
    set screening=p_screening,internal_notes=coalesce(p_internal_notes,''),follow_up_at=v_follow_up_at,updated_at=now()
    where id=p_id and client_id=p_client;
  if not found then raise exception 'LS: Candidate not found.'; end if;
  insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
    values(p_client,p_id,'screening',auth.uid(),p_screening);
end $$;

revoke all on function private.save_screening(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.save_screening(uuid,uuid,jsonb,text) to authenticated;

create function public.role_dashboard_counts(p_client uuid)
returns table(
  role_id uuid,
  all_profiles integer,
  profile_shortlisted integer,
  recruiter_shortlisted integer,
  client_shortlisted integer,
  offer_sent integer,
  rejected integer,
  due_follow_ups integer,
  offers_in_progress integer
)
language sql stable security invoker set search_path='' as $$
  select
    r.id,
    count(rc.id) filter (where rc.stage='all_profiles')::integer,
    count(rc.id) filter (where rc.stage='profile_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='recruiter_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='client_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='offer_sent')::integer,
    count(rc.id) filter (where rc.stage='rejected')::integer,
    count(rc.id) filter (
      where rc.stage<>'rejected' and rc.follow_up_at is not null and rc.follow_up_at<=current_date
    )::integer,
    count(rc.id) filter (
      where rc.stage='offer_sent' and coalesce(rc.outcome,'offer_sent') not in ('offer_declined','joined')
    )::integer
  from public.roles r
  left join public.role_candidates rc on rc.role_id=r.id
  where r.client_id=p_client
  group by r.id;
$$;

revoke all on function public.role_dashboard_counts(uuid) from public,anon,authenticated;
grant execute on function public.role_dashboard_counts(uuid) to authenticated;
