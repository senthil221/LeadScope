-- Recoverable deletion of a role membership, never the shared person.
begin;

create table private.role_candidate_trash (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.clients(id),
 role_id uuid not null references public.roles(id),
 deleted_by uuid not null references public.user_profiles(id),
 deleted_at timestamptz not null default now(),
 restored_at timestamptz,
 records jsonb not null check(jsonb_typeof(records)='array'),
 events jsonb not null check(jsonb_typeof(events)='array')
);
alter table private.role_candidate_trash enable row level security;
revoke all on private.role_candidate_trash from public, anon, authenticated;
create index role_candidate_trash_role on private.role_candidate_trash(role_id,deleted_at desc) where restored_at is null;

create function private.remove_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text)
returns uuid language plpgsql security definer set search_path='' as $$
declare batch uuid;
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Active role not found.'; end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 50
    or (select count(distinct id) from unnest(p_ids) id)<>cardinality(p_ids) then
  raise exception 'LS: Select between 1 and 50 unique rows.';
 end if;
 perform 1 from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids) order by id for update;
 if (select count(*) from public.role_candidates where role_id=p_role and client_id=p_client and id=any(p_ids)
     and (p_stage is null or stage=p_stage))<>cardinality(p_ids) then
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

create function private.restore_role_candidates(p_client uuid,p_role uuid,p_batch uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare trash private.role_candidate_trash;
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.roles where id=p_role and client_id=p_client and not archived for update;
 if not found then raise exception 'LS: Active role not found.'; end if;
 select * into trash from private.role_candidate_trash where id=p_batch and client_id=p_client and role_id=p_role for update;
 if not found then raise exception 'LS: Deleted rows not found for this role.'; end if;
 if trash.restored_at is not null then return 0; end if;
 if exists(select 1 from jsonb_to_recordset(trash.records) as old(candidate_id uuid)
  join public.role_candidates rc on rc.role_id=p_role and rc.candidate_id=old.candidate_id) then
  raise exception 'LS: A candidate in this batch has already been added back to the role. Resolve that duplicate before restoring the batch.';
 end if;
 insert into public.role_candidates select * from jsonb_populate_recordset(null::public.role_candidates,trash.records);
 insert into public.role_candidate_events select * from jsonb_populate_recordset(null::public.role_candidate_events,trash.events);
 update private.role_candidate_trash set restored_at=now() where id=p_batch;
 return jsonb_array_length(trash.records);
end $$;

create function private.deleted_role_candidate_batches(p_client uuid,p_role uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 if not exists(select 1 from public.roles where id=p_role and client_id=p_client) then raise exception 'LS: Role not found.'; end if;
 return coalesce((select jsonb_agg(batch order by batch->>'deletedAt' desc) from (
  select jsonb_build_object('id',id,'deletedAt',deleted_at,'count',jsonb_array_length(records)) batch
  from private.role_candidate_trash where role_id=p_role and client_id=p_client and restored_at is null
  order by deleted_at desc limit 100
 ) recent),'[]');
end $$;

create function public.remove_role_candidates(p_client uuid,p_role uuid,p_ids uuid[],p_stage text)
returns uuid language sql security invoker set search_path='' as $$ select private.remove_role_candidates(p_client,p_role,p_ids,p_stage); $$;
create function public.restore_role_candidates(p_client uuid,p_role uuid,p_batch uuid)
returns integer language sql security invoker set search_path='' as $$ select private.restore_role_candidates(p_client,p_role,p_batch); $$;
create function public.deleted_role_candidate_batches(p_client uuid,p_role uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.deleted_role_candidate_batches(p_client,p_role); $$;

revoke all on function private.remove_role_candidates(uuid,uuid,uuid[],text), public.remove_role_candidates(uuid,uuid,uuid[],text),
 private.restore_role_candidates(uuid,uuid,uuid), public.restore_role_candidates(uuid,uuid,uuid),
 private.deleted_role_candidate_batches(uuid,uuid), public.deleted_role_candidate_batches(uuid,uuid) from public,anon,authenticated;
grant execute on function private.remove_role_candidates(uuid,uuid,uuid[],text), public.remove_role_candidates(uuid,uuid,uuid[],text),
 private.restore_role_candidates(uuid,uuid,uuid), public.restore_role_candidates(uuid,uuid,uuid),
 private.deleted_role_candidate_batches(uuid,uuid), public.deleted_role_candidate_batches(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
