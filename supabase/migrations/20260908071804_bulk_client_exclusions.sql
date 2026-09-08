begin;
-- Reuse the existing client suppression boundary: sheets, exports and future
-- ingestion all consult the same blocklist. Do not create a second identity list.
create function private.exclude_profiles(p_client uuid,p_urls text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_added integer; v_count integer;
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.clients where id=p_client for update;
 if not found then raise exception 'LS: Client not found.'; end if;
 if p_urls is null or cardinality(p_urls) not between 1 and 500 then
  raise exception 'LS: Paste between 1 and 500 LinkedIn profile URLs.';
 end if;
 if exists(select 1 from unnest(p_urls) u where u is null or length(u)>2000 or u !~ '^https://www[.]linkedin[.]com/in/[^/?#[:space:]]+$') then
  raise exception 'LS: Use valid LinkedIn profile URLs.';
 end if;
 select count(distinct u) into v_count from unnest(p_urls) u;
 with changed as (
  insert into public.suppressions(client_id,canonical_url,reason,note,active,created_by)
  select p_client,u,'Imported blocklist','',true,auth.uid() from (select distinct unnest(p_urls) as u) urls
  on conflict(client_id,canonical_url) do update set active=true,updated_at=now()
   where not public.suppressions.active
  returning canonical_url,reason,note
 ), history as (
  insert into public.suppression_events(client_id,canonical_url,reason,note,active,actor)
  select p_client,canonical_url,reason,note,true,auth.uid() from changed returning id
 ) select count(*) into v_added from history;
 return jsonb_build_object('added',v_added,'alreadyExcluded',v_count-v_added);
end $$;
create function public.exclude_profiles(p_client uuid,p_urls text[])
returns jsonb language sql security invoker set search_path='' as $$
 select private.exclude_profiles(p_client,p_urls);
$$;
revoke all on function private.exclude_profiles(uuid,text[]) from public,anon,authenticated;
revoke all on function public.exclude_profiles(uuid,text[]) from public,anon,authenticated;
grant execute on function private.exclude_profiles(uuid,text[]) to authenticated;
grant execute on function public.exclude_profiles(uuid,text[]) to authenticated;
commit;
