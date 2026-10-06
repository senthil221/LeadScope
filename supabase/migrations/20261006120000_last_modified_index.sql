-- An index for "Last modified" on All profiles.
--
-- Every other sort has one: added order and newest first per role and per
-- stage, rating both ways, stage entry. Last modified had one only per stage,
-- so on All profiles - which spans every stage - it sorted the whole role in
-- memory each time. Small today; the largest role is already four hundred.
create index if not exists role_candidates_role_updated
 on public.role_candidates(role_id, updated_at desc, id);
