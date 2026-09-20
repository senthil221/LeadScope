-- Sheet-style candidate editing. Adds the two detail columns the recruiting
-- brief asks interns to fill (current CTC, highest qualification) and a
-- single-field save so a grid cell can persist on its own rather than
-- round-tripping every candidate column through update_candidate_details.
begin;

-- CTC is stored as text on purpose: recruiters record "18 LPA", "$120k" and
-- "not disclosed" interchangeably, and forcing a numeric here would lose the
-- unit the number only means something with.
alter table public.candidates
 add column current_ctc text not null default '' check(length(current_ctc)<=80),
 add column highest_qualification text not null default '' check(length(highest_qualification)<=200);

-- One cell, one save. The field name is checked against a fixed whitelist and
-- dispatched through explicit branches, so no caller-supplied text ever
-- reaches a column reference.
create function private.save_candidate_field(p_id uuid,p_field text,p_value text)
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
  if v is not null and v !~ '^\+[1-9][0-9]{7,14}$' then
   raise exception 'LS: Choose a country code and enter a valid phone number.'; end if;
  update public.candidates set phone=v,updated_at=now() where id=p_id;
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

create function public.save_candidate_field(p_id uuid,p_field text,p_value text)
returns void language sql security invoker set search_path='' as $$
 select private.save_candidate_field(p_id,p_field,p_value);
$$;

revoke all on function private.save_candidate_field(uuid,text,text) from public,anon,authenticated;
revoke all on function public.save_candidate_field(uuid,text,text) from public,anon,authenticated;
grant execute on function private.save_candidate_field(uuid,text,text) to authenticated;
grant execute on function public.save_candidate_field(uuid,text,text) to authenticated;

commit;
