-- Mobile numbers are ten digits, and there are two of them.
--
-- The country-code machinery was built for a database of candidates that does
-- not exist here: every number on file is Indian, and making an intern pick a
-- country from a list of twenty-eight to type ten digits was a tax on the
-- common case. A number is now ten digits, stored as ten digits.
--
-- This is not a worldwide rule — China is eleven, Singapore eight, the UAE
-- nine — so a number from outside India cannot be recorded until this is
-- revisited. That is a deliberate trade for the pipeline this runs.
--
-- Candidates also give a second number more often than not, and until now the
-- alternate went into a note or overwrote the first. It gets its own column.
begin;

alter table public.candidates
 add column alternate_phone text check(length(alternate_phone) between 1 and 40);

create or replace function private.validate_candidate_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if (tg_op='INSERT' or new.phone is distinct from old.phone)
  and new.phone is not null and new.phone !~ '^[0-9]{10}$' then
  raise exception 'LS: Enter a 10 digit mobile number.';
 end if;
 if (tg_op='INSERT' or new.alternate_phone is distinct from old.alternate_phone)
  and new.alternate_phone is not null and new.alternate_phone !~ '^[0-9]{10}$' then
  raise exception 'LS: Enter a 10 digit alternate mobile number.';
 end if;
 -- The same number twice is a typo, not a second way to reach somebody.
 if new.alternate_phone is not null and new.alternate_phone=new.phone then
  raise exception 'LS: The alternate mobile is the same as the primary one.';
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

drop trigger candidates_validate_contacts on public.candidates;
create trigger candidates_validate_contacts
 before insert or update of phone,alternate_phone,email on public.candidates
 for each row execute function private.validate_candidate_contacts();

-- Only now, with the rule above in place. Run before it and the old trigger
-- refuses the very update that takes the country code off, which is exactly
-- what it did the first time this was deployed.
--
-- Every number on file is +91 followed by the ten digits we now keep on their
-- own. Anything else is left exactly as it is: two legacy rows predate any
-- validation, and the trigger only judges a value when it changes, so nothing
-- is lost and nobody is locked out of an unrelated edit.
update public.candidates set phone=substring(phone from 4)
 where phone ~ '^\+91[0-9]{10}$';
update public.candidate_identities set normalized_value=substring(normalized_value from 4)
 where kind='phone' and normalized_value ~ '^\+91[0-9]{10}$';

-- One cell, one save: the grid's two mobile columns both come through here.
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
end $$;

drop function if exists public.update_candidate_details(uuid,text,text,text,text,text,numeric,text,text);
drop function if exists private.update_candidate_details(uuid,text,text,text,text,text,numeric,text,text);

create function private.update_candidate_details(p_id uuid,p_full_name text,p_headline text,
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
end $$;

create function public.update_candidate_details(p_id uuid,p_full_name text,p_headline text,
 p_current_company text,p_current_designation text,p_location text,p_total_experience_years numeric,
 p_phone text,p_alternate_phone text,p_email text)
returns void language sql security invoker set search_path='' as $$
 select private.update_candidate_details(p_id,p_full_name,p_headline,p_current_company,
  p_current_designation,p_location,p_total_experience_years,p_phone,p_alternate_phone,p_email);
$$;

do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
   and p.proname in ('update_candidate_details','save_candidate_field') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
