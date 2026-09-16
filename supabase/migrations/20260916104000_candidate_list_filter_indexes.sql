-- The standard role/stage index covers the default newest-first list. These
-- indexes cover the two optional controls that otherwise sort or filter a
-- large stage after it has been found.
create index if not exists role_candidates_role_stage_source_entered
  on public.role_candidates(role_id,stage,source,stage_entered_at desc,id);

create index if not exists role_candidates_role_stage_rating_ascending
  on public.role_candidates(role_id,stage,rating asc nulls last,id);

create index if not exists role_candidates_role_stage_rating_descending
  on public.role_candidates(role_id,stage,rating desc nulls last,id);
