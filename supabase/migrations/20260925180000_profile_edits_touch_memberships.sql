-- An edit to a profile counts as a change to the rows that show it.
--
-- Sorting a stage by what changed most recently is about to be offered, and
-- role_candidates.updated_at is what it reads. That column moved when a stage,
-- rating or note changed, but not when somebody corrected a company name in
-- the grid: that writes to the candidate, which every role shares. So the
-- edit a recruiter had just made was the one thing the sort could not see.
--
-- Both profile writes now touch the memberships that show them. It is a
-- timestamp only - no history entry, because the trigger records fields that
-- were asked for and this is not one of them.
begin;

create or replace function private.save_candidate_field(p_id uuid,p_field text,p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare v text := nullif(trim(coalesce(p_value,'')),'');
begin
 perform private.require_admin(auth.uid());
 if p_field='full_name' then
  if v is null or length(v)>200 then raise exception 'LS: Enter a candidate name.'; end if;
  update public.candidates set full_name=v,updated_at=now() where id=p_id;
 elsif p_field='headline' then
  if length(coalesce(v,''))>300 then raise exception 'LS: This headline is too long.'; end if;
  update public.candidates set headline=coalesce(v,''),updated_at=now() where id=p_id;
 elsif p_field='current_company' then
  if length(coalesce(v,''))>200 then raise exception 'LS: This company name is too long.'; end if;
  update public.candidates set current_company=coalesce(v,''),updated_at=now() where id=p_id;
 elsif p_field='current_designation' then
  if length(coalesce(v,''))>200 then raise exception 'LS: This designation is too long.'; end if;
  update public.candidates set current_designation=coalesce(v,''),updated_at=now() where id=p_id;
 elsif p_field='location' then
  if length(coalesce(v,''))>200 then raise exception 'LS: This location is too long.'; end if;
  update public.candidates set location=coalesce(v,''),updated_at=now() where id=p_id;
 elsif p_field='current_ctc' then
  if length(coalesce(v,''))>80 then raise exception 'LS: This CTC value is too long.'; end if;
  update public.candidates set current_ctc=coalesce(v,''),updated_at=now() where id=p_id;
 elsif p_field='highest_qualification' then
  if length(coalesce(v,''))>200 then raise exception 'LS: This qualification is too long.'; end if;
  update public.candidates set highest_qualification=coalesce(v,''),updated_at=now() where id=p_id;
 elsif p_field='total_experience_years' then
  if v is not null and (v !~ '^[0-9]{1,2}([.][0-9])?$' or v::numeric not between 0 and 70) then
   raise exception 'LS: Experience must be between 0 and 70 years.'; end if;
  update public.candidates set total_experience_years=v::numeric,updated_at=now() where id=p_id;
 elsif p_field='phone' then
  -- The candidates_validate_contacts trigger is the authority on format; this
  -- check only produces the friendlier message before it fires.
  if v is not null and v !~ '^[0-9]{10}$' then
   raise exception 'LS: Enter a 10 digit mobile number.'; end if;
  update public.candidates set phone=v,updated_at=now() where id=p_id;
 elsif p_field='alternate_phone' then
  if v is not null and v !~ '^[0-9]{10}$' then
   raise exception 'LS: Enter a 10 digit mobile number.'; end if;
  update public.candidates set alternate_phone=v,updated_at=now() where id=p_id;
 elsif p_field='email' then
  if v is not null and (length(v) not between 3 and 254
   or lower(v) !~ '^[^@[:space:]]+@[^@[:space:].]+([.][^@[:space:].]+)+$') then
   raise exception 'LS: Enter a valid email address, such as name@company.com.'; end if;
  update public.candidates set email=lower(v),updated_at=now() where id=p_id;
 else
  raise exception 'LS: That field cannot be edited here.';
 end if;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 -- A profile's detail belongs to every role it sits on, so touching it makes
 -- those rows modified too. Without this, sorting a pipeline by what changed
 -- most recently missed the edit somebody had just typed into the grid.
 update public.role_candidates set updated_at=now() where candidate_id=p_id;
end $$;


create or replace function private.update_candidate_details(p_id uuid,p_full_name text,p_headline text,
 p_current_company text,p_current_designation text,p_location text,p_total_experience_years numeric,
 p_phone text,p_alternate_phone text,p_email text)
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
 if p_phone is not null and trim(p_phone) !~ '^[0-9]{10}$' then
  raise exception 'LS: Enter a 10 digit mobile number.'; end if;
 if p_alternate_phone is not null and trim(p_alternate_phone) !~ '^[0-9]{10}$' then
  raise exception 'LS: Enter a 10 digit alternate mobile number.'; end if;
 if p_email is not null and (length(trim(p_email)) not between 3 and 254
  or lower(trim(p_email)) !~ '^[^@[:space:]]+@[^@[:space:].]+([.][^@[:space:].]+)+$') then
  raise exception 'LS: Enter a valid email address, such as name@company.com.'; end if;
 update public.candidates set full_name=trim(p_full_name),headline=coalesce(p_headline,''),
  current_company=coalesce(p_current_company,''),current_designation=coalesce(p_current_designation,''),
  location=coalesce(p_location,''),total_experience_years=p_total_experience_years,
  phone=nullif(trim(p_phone),''),alternate_phone=nullif(trim(p_alternate_phone),''),
  email=nullif(lower(trim(p_email)),''),updated_at=now()
  where id=p_id;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 -- A profile's detail belongs to every role it sits on, so touching it makes
 -- those rows modified too. Without this, sorting a pipeline by what changed
 -- most recently missed the edit somebody had just typed into the grid.
 update public.role_candidates set updated_at=now() where candidate_id=p_id;
end $$;


commit;
