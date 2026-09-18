begin;

-- Existing records may contain legacy contact values. Validate every insert
-- and every contact change, while allowing an unrelated update to a legacy
-- candidate until a recruiter corrects that contact value.
create function private.validate_candidate_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if (tg_op='INSERT' or new.phone is distinct from old.phone)
  and new.phone is not null and new.phone !~ '^\+[1-9][0-9]{7,14}$' then
  raise exception 'LS: Choose a country code and enter a valid phone number.';
 end if;
 if (tg_op='INSERT' or new.email is distinct from old.email)
  and new.email is not null and (
   length(new.email) not between 3 and 254
   or new.email<>lower(trim(new.email))
   or new.email !~ '^[^@[:space:]]+@[^@[:space:].]+([.][^@[:space:].]+)+$'
  ) then
  raise exception 'LS: Enter a valid email address, such as name@company.com.';
 end if;
 return new;
end $$;

create trigger candidates_validate_contacts
 before insert or update of phone,email on public.candidates
 for each row execute function private.validate_candidate_contacts();

revoke all on function private.validate_candidate_contacts() from public,anon,authenticated;

create or replace function private.update_candidate_details(p_id uuid,p_full_name text,p_headline text,
 p_current_company text,p_current_designation text,p_location text,p_total_experience_years numeric,
 p_phone text,p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 if length(trim(coalesce(p_full_name,'')))=0 or length(p_full_name)>200 then
  raise exception 'LS: Enter a candidate name.'; end if;
 if length(coalesce(p_headline,''))>300 or length(coalesce(p_current_company,''))>200
  or length(coalesce(p_current_designation,''))>200 or length(coalesce(p_location,''))>200 then
  raise exception 'LS: One of these fields is too long.'; end if;
 if p_total_experience_years is not null and p_total_experience_years not between 0 and 70 then
  raise exception 'LS: Experience must be between 0 and 70 years.'; end if;
 if p_phone is not null and trim(p_phone) !~ '^\+[1-9][0-9]{7,14}$' then
  raise exception 'LS: Choose a country code and enter a valid phone number.'; end if;
 if p_email is not null and (length(trim(p_email)) not between 3 and 254
  or lower(trim(p_email)) !~ '^[^@[:space:]]+@[^@[:space:].]+([.][^@[:space:].]+)+$') then
  raise exception 'LS: Enter a valid email address, such as name@company.com.'; end if;
 update public.candidates set full_name=trim(p_full_name),headline=coalesce(p_headline,''),
  current_company=coalesce(p_current_company,''),current_designation=coalesce(p_current_designation,''),
  location=coalesce(p_location,''),total_experience_years=p_total_experience_years,
  phone=nullif(trim(p_phone),''),email=nullif(lower(trim(p_email)),''),updated_at=now()
  where id=p_id;
 if not found then raise exception 'LS: Candidate not found.'; end if;
end $$;

revoke all on function private.update_candidate_details(uuid,text,text,text,text,text,numeric,text,text)
 from public,anon,authenticated;
grant execute on function private.update_candidate_details(uuid,text,text,text,text,text,numeric,text,text)
 to authenticated;

-- The public LinkedIn wrapper is SECURITY INVOKER, so its private target must
-- also be executable by the signed-in recruiter role. The previous migration
-- revoked this grant and caused the generic save error shown in the drawer.
grant execute on function private.set_candidate_linkedin(uuid,text) to authenticated;

commit;
