-- Recruiter screening + candidate edit + resumes. Purely additive.
-- Advancing a screened candidate ("Suitable") reuses move_stage; rejecting
-- ("Not suitable") reuses reject_candidate — both already shipped in earlier
-- migrations. This migration adds only what neither of those already covers:
-- saving screening answers, editing reusable candidate details (folding in
-- the manual phone/email entry originally scoped as its own enrichment
-- phase), and recording where a resume was uploaded.
begin;

-- screening and internal_notes save together: one panel, one Save action.
-- internal_notes stays a distinct column from client_notes so a client
-- share link (a later migration) can expose one and never the other.
create function private.save_screening(p_client uuid,p_id uuid,p_screening jsonb,p_internal_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 if p_screening is null or jsonb_typeof(p_screening)<>'object' then
  raise exception 'LS: Invalid screening data.'; end if;
 if length(p_screening::text)>8000 then raise exception 'LS: Screening notes are too long.'; end if;
 if length(coalesce(p_internal_notes,''))>4000 then raise exception 'LS: Shorten the internal note before saving.'; end if;
 perform 1 from public.clients where id=p_client for update;
 update public.role_candidates set screening=p_screening,internal_notes=coalesce(p_internal_notes,''),updated_at=now()
  where id=p_id and client_id=p_client;
 if not found then raise exception 'LS: Candidate not found.'; end if;
 insert into public.role_candidate_events(client_id,role_candidate_id,kind,actor,detail)
  values(p_client,p_id,'screening',auth.uid(),p_screening);
end $$;

-- Candidates are agency-global with no client_id, matching upsert_candidate's
-- own permission model: any approved admin may correct a shared record.
-- Unlike upsert_candidate (which protects an import from blanking good data),
-- a direct edit here always writes exactly what was submitted, including a
-- deliberate clear.
create function private.update_candidate_details(p_id uuid,p_full_name text,p_headline text,
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
 if p_phone is not null and length(p_phone) not between 1 and 40 then
  raise exception 'LS: Enter a valid phone number.'; end if;
 if p_email is not null and (length(p_email) not between 3 and 320
  or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') then
  raise exception 'LS: Enter a valid email address.'; end if;
 update public.candidates set full_name=trim(p_full_name),headline=coalesce(p_headline,''),
  current_company=coalesce(p_current_company,''),current_designation=coalesce(p_current_designation,''),
  location=coalesce(p_location,''),total_experience_years=p_total_experience_years,
  phone=nullif(p_phone,''),email=nullif(p_email,''),updated_at=now()
  where id=p_id;
 if not found then raise exception 'LS: Candidate not found.'; end if;
end $$;

-- Records where a resume landed after the server uploads it with the
-- service-role key; this RPC only ever runs after that upload has already
-- succeeded, so it does not touch Storage itself.
create function private.save_resume_path(p_id uuid,p_resume_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 perform private.require_admin(auth.uid());
 if length(coalesce(p_resume_path,''))>400 then raise exception 'LS: Invalid resume reference.'; end if;
 update public.candidates set resume_path=nullif(p_resume_path,''),updated_at=now() where id=p_id;
 if not found then raise exception 'LS: Candidate not found.'; end if;
end $$;

create function public.save_screening(p_client uuid,p_id uuid,p_screening jsonb,p_internal_notes text)
returns void language sql security invoker set search_path='' as $$
 select private.save_screening(p_client,p_id,p_screening,p_internal_notes);
$$;
create function public.update_candidate_details(p_id uuid,p_full_name text,p_headline text,
 p_current_company text,p_current_designation text,p_location text,p_total_experience_years numeric,
 p_phone text,p_email text)
returns void language sql security invoker set search_path='' as $$
 select private.update_candidate_details(p_id,p_full_name,p_headline,p_current_company,
  p_current_designation,p_location,p_total_experience_years,p_phone,p_email);
$$;
create function public.save_resume_path(p_id uuid,p_resume_path text)
returns void language sql security invoker set search_path='' as $$
 select private.save_resume_path(p_id,p_resume_path);
$$;
do $$ declare f record; begin
 for f in select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in
   ('save_screening','update_candidate_details','save_resume_path') loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',f.schema,f.proname,f.args);
  execute format('grant execute on function %I.%I(%s) to authenticated',f.schema,f.proname,f.args);
 end loop;
end $$;

commit;
