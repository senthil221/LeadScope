begin;

-- Search is maintained once per profile edit, not by fetching identifiers per
-- search result. The projection contains only fields already visible to operators.
alter table public.candidates add column search_text text not null default '';
create function private.refresh_candidate_search() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.search_text := concat_ws(' ',new.full_name,new.headline,new.current_company,new.current_designation,new.location,new.email,new.phone,new.alternate_phone,
   (select string_agg(normalized_value,' ') from public.candidate_identities where candidate_id=new.id));
 return new;
end $$;
create trigger candidates_search before insert or update of full_name,headline,current_company,current_designation,location,email,phone,alternate_phone,search_text
on public.candidates for each row execute function private.refresh_candidate_search();
create function private.refresh_identity_search() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then update public.candidates set search_text='' where id=old.candidate_id; end if;
 if tg_op<>'DELETE' then update public.candidates set search_text='' where id=new.candidate_id; end if;
 return null;
end $$;
create trigger identities_search after insert or update or delete on public.candidate_identities for each row execute function private.refresh_identity_search();
revoke all on function private.refresh_candidate_search(),private.refresh_identity_search() from public,anon,authenticated;
update public.candidates set search_text='';
create index candidates_created_page on public.candidates(created_at desc,id);
create index role_candidates_added_page on public.role_candidates(role_id,created_at,id);
create index role_candidates_stage_added_page on public.role_candidates(role_id,stage,created_at,id);

-- Compare only the edited field. Two recruiters editing different fields do
-- not conflict, while changing the same field cannot silently lose a save.
create function private.save_cell_checked(p_kind text,p_id uuid,p_field text,p_value text,p_expected text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.candidates; rc public.role_candidates; old_value text; result jsonb; field_kind text; custom_value jsonb;
begin
 perform private.require_admin(auth.uid());
 if p_kind='profile' then
  select * into c from public.candidates where id=p_id for update;
  if not found then raise exception 'LS: Profile not found.'; end if;
  if p_field='linkedin' then
   select min(normalized_value) into old_value from public.candidate_identities where candidate_id=p_id and kind='linkedin';
  else old_value:=to_jsonb(c)->>p_field; end if;
 else
  select * into rc from public.role_candidates where id=p_id for update;
  if not found then raise exception 'LS: Role profile not found.'; end if;
  if p_field like 'custom:%' then
   old_value:=rc.custom->>substring(p_field from 8);
   select kind into field_kind from public.role_fields where role_id=rc.role_id and key=substring(p_field from 8) and not archived;
  else old_value:=to_jsonb(rc)->>p_field; end if;
 end if;
 if (case when p_field in ('rating','total_experience_years') or field_kind='number' then nullif(old_value,'')::numeric is distinct from nullif(p_expected,'')::numeric else coalesce(nullif(trim(old_value),''),'') is distinct from coalesce(nullif(trim(p_expected),''),'') end) then
  raise exception 'LS: Another operator changed this field. Your draft is kept. Refresh to review their value before retrying.';
 end if;
 if p_kind='profile' then
  if p_field='linkedin' then perform private.set_candidate_linkedin(p_id,p_value);
  else perform private.save_candidate_field(p_id,p_field,p_value); end if;
 elsif p_kind='role' then
  case
   when p_field='client_notes' then perform private.save_client_note(rc.client_id,p_id,coalesce(p_value,''));
   when p_field='follow_up_note' then perform private.save_follow_up_note(rc.client_id,p_id,coalesce(p_value,''));
   when p_field='rating' then perform private.rate_candidate_decimal(rc.client_id,p_id,nullif(p_value,'')::numeric);
   when p_field='source' then result:=private.set_candidate_source(rc.client_id,p_id,p_value);
   when p_field like 'custom:%' then
    select kind into field_kind from public.role_fields where role_id=rc.role_id and key=substring(p_field from 8) and not archived;
    custom_value:=case when nullif(p_value,'') is null then null when field_kind='number' then to_jsonb(p_value::numeric) when field_kind='boolean' then to_jsonb(p_value::boolean) else to_jsonb(p_value) end;
    perform private.save_custom_field(rc.client_id,p_id,substring(p_field from 8),custom_value);
   else raise exception 'LS: Unsupported field.';
  end case;
 else raise exception 'LS: Unsupported edit.';
 end if;
 return coalesce(result,'{}'::jsonb);
end $$;
create function public.save_cell_checked(p_kind text,p_id uuid,p_field text,p_value text,p_expected text)
returns jsonb language sql security invoker set search_path='' as $$ select private.save_cell_checked(p_kind,p_id,p_field,p_value,p_expected); $$;
revoke all on function private.save_cell_checked(text,uuid,text,text,text),public.save_cell_checked(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.save_cell_checked(text,uuid,text,text,text),public.save_cell_checked(text,uuid,text,text,text) to authenticated;

-- Full-dataset filters precede pagination; membership context is bounded to
-- the requested page, so a global search never downloads the whole database.
create function private.master_profiles_page(p_filters jsonb,p_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; term text:=left(trim(coalesce(p_filters->>'q','')),200); pattern text;
begin
 perform private.require_admin(auth.uid());
 pattern:='%'||replace(replace(replace(term,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with filtered as (
  select c.* from public.candidates c where
  (term='' or c.search_text ilike pattern)
  and (coalesce(p_filters->>'company','')='' or c.current_company ilike '%'||replace(replace(p_filters->>'company','%',E'\\%'),'_',E'\\_')||'%')
  and (coalesce(p_filters->>'location','')='' or c.location ilike '%'||replace(replace(p_filters->>'location','%',E'\\%'),'_',E'\\_')||'%')
  and (coalesce(p_filters->>'contact','')<>'missing' or (c.phone is null and c.alternate_phone is null))
  and (coalesce(p_filters->>'contact','')<>'available' or c.phone is not null or c.alternate_phone is not null)
  and (coalesce(p_filters->>'company_missing','')<>'1' or trim(c.current_company)='')
  and (coalesce(p_filters->>'experience','')='' or c.total_experience_years>=least(70,greatest(0,(p_filters->>'experience')::numeric)))
  and (coalesce(p_filters->>'client','')='' or exists(select 1 from public.role_candidates rc where rc.candidate_id=c.id and rc.client_id=(p_filters->>'client')::uuid))
  and (coalesce(p_filters->>'role','')='' or exists(select 1 from public.role_candidates rc where rc.candidate_id=c.id and rc.role_id=(p_filters->>'role')::uuid))
 ), paged as (select * from filtered order by created_at desc,id limit 50 offset (least(100000,greatest(1,p_page))-1)*50)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce(jsonb_agg(
  (to_jsonb(c)-'search_text')||jsonb_build_object('candidate_identities',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'normalized_value',normalized_value)) from public.candidate_identities where candidate_id=c.id),'[]'::jsonb),
  'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',rc.id,'role_id',r.id,'role_name',r.name,'client_id',cl.id,'client_name',cl.name,'stage',rc.stage,'recruiters',r.recruiter_names,'archived',r.archived)) from public.role_candidates rc join public.roles r on r.id=rc.role_id join public.clients cl on cl.id=rc.client_id where rc.candidate_id=c.id),'[]'::jsonb))
 ) ,'[]'::jsonb)) into result from paged c;
 return result;
end $$;
create function public.master_profiles_page(p_filters jsonb default '{}',p_page integer default 1) returns jsonb language sql security invoker set search_path='' as $$ select private.master_profiles_page(p_filters,p_page); $$;
revoke all on function private.master_profiles_page(jsonb,integer),public.master_profiles_page(jsonb,integer) from public,anon,authenticated;
grant execute on function private.master_profiles_page(jsonb,integer),public.master_profiles_page(jsonb,integer) to authenticated;

create function public.agency_workbench() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(work) order by work.due desc,work.waiting_mobile desc,work.role_name),'[]'::jsonb) from (
 select r.id role_id,r.client_id,r.name role_name,c.name client_name,r.recruiter_names,
 count(rc.id) filter(where rc.follow_up_at<=current_date and rc.stage='recruiter_shortlisted')::int due,
 count(rc.id) filter(where rc.stage='profile_shortlisted' and p.phone is null and p.alternate_phone is null)::int waiting_mobile,
 count(rc.id) filter(where rc.stage in ('profile_shortlisted','recruiter_shortlisted','client_shortlisted','later') and rc.stage_entered_at<now()-interval '7 days')::int stale,
 count(rc.id) filter(where rc.stage='client_shortlisted')::int client_review,
 count(rc.id) filter(where rc.rating is null)::int unrated,
 (case when cardinality(r.recruiter_names)=0 then 1 else 0 end + case when trim(r.ctc)='' then 1 else 0 end + case when trim(r.role_brief)='' then 1 else 0 end + case when r.jd_path is null then 1 else 0 end)::int setup_missing
 from public.roles r join public.clients c on c.id=r.client_id left join public.role_candidates rc on rc.role_id=r.id left join public.candidates p on p.id=rc.candidate_id
 where not r.archived and not c.archived and r.status='open' group by r.id,c.name
 order by due desc,waiting_mobile desc,r.name limit 200
 ) work;
$$;
revoke all on function public.agency_workbench() from public,anon,authenticated;
grant execute on function public.agency_workbench() to authenticated;

-- Lifecycle state determines active recruiting work. On-hold and closed roles
-- retain their candidate history but do not make an agency-wide queue noisy.
create or replace function public.client_directory_counts()
returns table(
  client_id uuid,
  active_roles integer,
  all_profiles integer,
  profile_shortlisted integer,
  recruiter_shortlisted integer,
  client_shortlisted integer,
  offer_sent integer,
  due_follow_ups integer,
  offers_in_progress integer
)
language sql stable security invoker set search_path='' as $$
  select
    c.id,
    count(distinct r.id)::integer,
    count(rc.id)::integer,
    count(rc.id) filter (where rc.stage='profile_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='recruiter_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='client_shortlisted')::integer,
    count(rc.id) filter (where rc.stage='offer_sent')::integer,
    count(rc.id) filter (
      where rc.stage<>'rejected' and rc.follow_up_at is not null and rc.follow_up_at<=current_date
    )::integer,
    count(rc.id) filter (
      where rc.stage='offer_sent' and coalesce(rc.outcome,'offer_sent') not in ('offer_declined','joined')
    )::integer
  from public.clients c
  left join public.roles r on r.client_id=c.id and not r.archived and r.status='open'
  left join public.role_candidates rc on rc.role_id=r.id
  group by c.id;
$$;


create function private.write_shared_cell_checked(p_token_hash text,p_role_candidate uuid,p_column text,p_value jsonb,p_expected text)
returns void language plpgsql security definer set search_path='' as $$
declare current_note text; link public.role_share_links;
begin
 select * into link from public.role_share_links where token_hash=p_token_hash and revoked_at is null and (expires_at is null or expires_at>now()) for update;
 if not found then raise exception 'LS: This link is no longer valid.'; end if;
 -- Lock in the same order as the existing writer: link, then its shared row.
 select client_notes into current_note from public.role_candidates where id=p_role_candidate and role_id=link.role_id and stage in ('recruiter_shortlisted','client_shortlisted','offer_sent') for update;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 if coalesce(current_note,'') is distinct from coalesce(p_expected,'') then raise exception 'LS: Feedback changed in another window. Your draft is kept. Copy it, refresh, and review the latest feedback.'; end if;
 perform private.write_shared_cell(p_token_hash,p_role_candidate,p_column,p_value);
end $$;
create function public.write_shared_cell_checked(p_token_hash text,p_role_candidate uuid,p_column text,p_value jsonb,p_expected text)
returns void language sql security invoker set search_path='' as $$ select private.write_shared_cell_checked(p_token_hash,p_role_candidate,p_column,p_value,p_expected); $$;
revoke all on function private.write_shared_cell_checked(text,uuid,text,jsonb,text),public.write_shared_cell_checked(text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function private.write_shared_cell_checked(text,uuid,text,jsonb,text),public.write_shared_cell_checked(text,uuid,text,jsonb,text) to service_role;
create function private.save_profile_patch(p_id uuid,p_values jsonb,p_expected jsonb) returns void language plpgsql security definer set search_path='' as $$
declare k text; v text;
begin
 perform private.require_admin(auth.uid());
 perform 1 from public.candidates where id=p_id for update;
 if not found then raise exception 'LS: Profile not found.'; end if;
 for k,v in select key,value from jsonb_each_text(p_values) loop
  if not (p_expected ? k) then raise exception 'LS: Refresh the profile before saving.'; end if;
  if v is distinct from p_expected->>k then perform private.save_cell_checked('profile',p_id,k,v,p_expected->>k); end if;
 end loop;
end $$;
create function public.save_profile_patch(p_id uuid,p_values jsonb,p_expected jsonb) returns void language sql security invoker set search_path='' as $$ select private.save_profile_patch(p_id,p_values,p_expected); $$;
revoke all on function private.save_profile_patch(uuid,jsonb,jsonb),public.save_profile_patch(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.save_profile_patch(uuid,jsonb,jsonb),public.save_profile_patch(uuid,jsonb,jsonb) to authenticated;

create function private.workspace_mobile_health() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_admin(auth.uid());
 return jsonb_build_object(
  'worker_online',exists(select 1 from private.mobile_worker_health where last_seen>now()-interval '90 seconds'),
  'active',(select count(*) from public.mobile_waterfall_jobs where status in ('queued','running','waiting','waiting_setup')),
  'attention',(select count(*) from public.mobile_waterfall_jobs where status in ('needs_review','waiting_setup','failed')),
  'completed_today',(select count(*) from public.mobile_waterfall_jobs where status='complete' and updated_at>now()-interval '24 hours'),
  'empty_today',(select count(*) from public.mobile_waterfall_jobs where status='no_mobile' and updated_at>now()-interval '24 hours'),
  'roles',coalesce((select jsonb_agg(to_jsonb(t)) from (select r.id,r.name,count(*)::int jobs from public.mobile_waterfall_jobs j join public.roles r on r.id=j.role_id where j.status in ('needs_review','waiting_setup','failed') group by r.id order by count(*) desc limit 10) t),'[]'::jsonb)
 );
end $$;
create function public.workspace_mobile_health() returns jsonb language sql stable security invoker set search_path='' as $$ select private.workspace_mobile_health(); $$;
revoke all on function private.workspace_mobile_health(),public.workspace_mobile_health() from public,anon,authenticated;
grant execute on function private.workspace_mobile_health(),public.workspace_mobile_health() to authenticated;
notify pgrst,'reload schema';
commit;
