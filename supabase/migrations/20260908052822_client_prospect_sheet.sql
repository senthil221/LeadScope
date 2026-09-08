begin;

alter table public.client_profiles add column contact_status text not null default 'not_contacted'
 check (contact_status in ('not_contacted','contacted','replied','follow_up','not_interested'));

-- One row per canonical client prospect, regardless of campaign memberships.
-- Only current accepted, unsuppressed memberships qualify; existing RLS applies.
create view public.accepted_prospect_rows with (security_invoker=true) as
select p.id, p.client_id, p.canonical_url, p.notes, p.contact_status,
 p.first_seen as date_added, l.title, l.snippet, l.campaign_name,
 l.id as lead_id, l.campaign_id,
 coalesce(q.text,'') as source_query,
 p.canonical_url || ' ' || coalesce(l.title,'') || ' ' || coalesce(l.snippet,'') || ' ' || p.notes as search_text
from public.client_profiles p
join lateral (
 select r.id,r.campaign_id,r.title,r.snippet,r.campaign_name
 from public.lead_rows r
 where r.client_profile_id=p.id and r.client_id=p.client_id and r.status='accepted'
 order by r.decided_at desc nulls last,r.id limit 1
) l on true
left join lateral (
 select rq.text from public.discoveries d
 join public.search_jobs j on j.id=d.search_job_id
 join public.run_queries rq on rq.id=j.run_query_id
 where d.client_profile_id=p.id and d.campaign_id=l.campaign_id
 order by d.observed_at desc,d.id limit 1
) q on true;
revoke all on public.accepted_prospect_rows from public,anon,authenticated;
grant select on public.accepted_prospect_rows to authenticated,service_role;

create index campaign_profiles_client_prospect on public.campaign_profiles(client_id,client_profile_id);

create function private.save_contact_status(p_client uuid,p_profile uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 if p_status is null or p_status not in ('not_contacted','contacted','replied','follow_up','not_interested') then
  raise exception 'LS: Choose a valid contact status.';
 end if;
 update public.client_profiles set contact_status=p_status where id=p_profile and client_id=p_client;
 if not found then raise exception 'LS: Profile not found.'; end if;
end $$;
create function public.save_contact_status(p_client uuid,p_profile uuid,p_status text)
returns void language sql security invoker set search_path='' as $$
 select private.save_contact_status(p_client,p_profile,p_status);
$$;
revoke all on function private.save_contact_status(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.save_contact_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.save_contact_status(uuid,uuid,text) to authenticated;
grant execute on function public.save_contact_status(uuid,uuid,text) to authenticated;

-- Replace five status-count HTTP requests with one statement.
create function public.lead_counts(p_client uuid,p_campaign uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (
 select status,count(*) as n from public.lead_rows
 where client_id=p_client and (p_campaign is null or campaign_id=p_campaign) group by status
 ) counts;
$$;
revoke all on function public.lead_counts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lead_counts(uuid,uuid) to authenticated;
create function public.export_prospects(p_client uuid,p_contact text default '',p_search text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 return coalesce((select jsonb_agg(to_jsonb(r) - 'search_text' - 'lead_id' - 'campaign_id' order by r.date_added desc,r.id)
 from public.accepted_prospect_rows r where r.client_id=p_client
 and (p_contact='' or r.contact_status=p_contact)
 and (p_search='' or r.search_text ilike '%' || replace(replace(replace(p_search,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_') || '%')), '[]'::jsonb);
end $$;
revoke all on function public.export_prospects(uuid,text,text) from public,anon,authenticated;
grant execute on function public.export_prospects(uuid,text,text) to authenticated;
commit;
