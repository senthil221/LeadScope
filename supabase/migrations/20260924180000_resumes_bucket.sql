-- The bucket resumes have always been uploaded to.
--
-- Nothing ever created it. The upload route has always addressed a bucket
-- named "resumes" through the service-role client, and on this installation
-- storage.buckets was empty, so every upload came back StorageApiError and the
-- grid said "Could not upload the resume. Try again." — which it did, forever.
--
-- Private, and deliberately without policies: no RLS policy grants anon or
-- authenticated any access to this bucket at all. Reads and writes go through
-- the service role in the route, which checks the operator first and hands the
-- browser a signed URL that expires in a minute. The size and type limits
-- mirror the ones the route enforces, so a bad upload is refused by storage
-- even if it ever reached it another way.
begin;

do $$
begin
 -- The test harness runs these migrations against a bare Postgres with no
 -- storage schema, and an installation that has one should not need a
 -- different migration from one that does not.
 if to_regclass('storage.buckets') is null then return; end if;

 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('resumes','resumes',false,10485760,array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 ])
 on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
end $$;

commit;
