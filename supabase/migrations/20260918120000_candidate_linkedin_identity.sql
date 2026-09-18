-- LinkedIn is the primary recruiter-facing profile link. Keep it in the
-- identity table so duplicate prevention and the master candidate record use
-- the same canonical value.
begin;

create or replace function private.set_candidate_linkedin(p_id uuid,p_linkedin text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_linkedin text:=trim(coalesce(p_linkedin,'')); begin
 perform private.require_admin(auth.uid());
 if v_linkedin !~ '^https://www[.]linkedin[.]com/in/[^/?#[:space:]]+$' then
  raise exception 'LS: Enter a valid LinkedIn profile URL.';
 end if;
 perform 1 from public.candidates where id=p_id for update;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 if exists(
  select 1 from public.candidate_identities
  where kind='linkedin' and normalized_value=v_linkedin and candidate_id<>p_id
 ) then
  raise exception 'LS: This LinkedIn profile already belongs to another candidate.';
 end if;
 delete from public.candidate_identities where candidate_id=p_id and kind='linkedin';
 insert into public.candidate_identities(candidate_id,kind,normalized_value)
  values(p_id,'linkedin',v_linkedin);
 update public.candidates set updated_at=now() where id=p_id;
end $$;

create or replace function public.set_candidate_linkedin(p_id uuid,p_linkedin text)
returns void language sql security invoker set search_path = '' as $$
 select private.set_candidate_linkedin(p_id,p_linkedin);
$$;

revoke all on function private.set_candidate_linkedin(uuid,text) from public,anon,authenticated;
revoke all on function public.set_candidate_linkedin(uuid,text) from public,anon,authenticated;
grant execute on function public.set_candidate_linkedin(uuid,text) to authenticated;

commit;
