# X-Ray search and mobile number waterfall

Google X-Ray is available under Actions in a Role's All Profiles view. It supports
a title, keyword, location, company and exclusion query builder, an editable Boolean
query, five result pages, saved result previews and selective imports. Imported
profiles enter All Profiles with a blank role rating. Existing LinkedIn identities
are reused, and global/client blocklists are enforced again during import.
These are Google-indexed titles and snippets, not a complete LinkedIn scrape.

Mobile lookups start only from the Start lookup button. Open the dialog through
Actions, a phone cell, or Find mobiles after selecting up to 200 profiles.
The order is Our Database, SignalHire, Apollo, BetterContact. The default stops at
the first source that returns mobiles, retaining all of its mobile numbers.
Check every source also collects additional mobiles from subsequent providers.
Apollo's email and phone waterfalls are explicitly disabled.

BetterContact requests mobile enrichment only. Email enrichment, profile
enrichment and catch-all email verification are explicitly disabled. Apollo
requests phones with personal-email reveal and both Apollo waterfalls disabled.
These flags do not remove bundled provider charges: [Apollo's current API
billing](https://docs.apollo.io/docs/api-pricing) includes a demographic/email
credit when qualifying data is returned, in addition to mobile credits.
[SignalHire bills each successfully matched profile](https://docs.signalhire.com/faq),
not only profiles with mobiles. Its documented Person API has no phone-only
selection. A strict mobile-only spending policy therefore cannot use these two
adapters without a separately verified phone-only billing arrangement.

The persistent Postgres queue is processed by `leadscope-mobile-worker`, independent
of the browser. Provider IDs, leases, callbacks and progress are committed between
steps. Missing keys or credits hold the current step until configuration is fixed.
SignalHire uses its asynchronous API with a per-job HMAC callback. Apollo and
BetterContact use saved request IDs for polling. BetterContact `on_hold` waits for
a credit top-up and is never mistaken for a completed empty response.

Only explicitly typed mobile numbers are accepted from SignalHire/Apollo; the
BetterContact mobile-enrichment field is used. HQ, work-direct, untyped and invalid
numbers are excluded. Database phone cells are eligible only when they have the
Indian mobile prefix and ten-digit format. Existing data is never overwritten;
empty Mobile and Alternate cells receive the first distinct Indian mobile numbers.
Additional and international mobiles remain available in the results sheet and
cache. Existing phone-cell validation still accepts Indian ten-digit numbers.

An ambiguous non-idempotent POST is marked for review rather than automatically
submitted twice. The recruiter can check the provider account and explicitly
retry. Cancel stops future work; it cannot refund a request already accepted by a
provider. Profile identity changes and archived roles prevent stale results from
being applied. Provider calls are prohibited under the normal test environment.

## Server configuration

Add the keys to `/opt/leadscope/deploy/.env` on the VPS. Do not put them in a
`NEXT_PUBLIC_` variable, source control, or a chat message.

```dotenv
SERPER_API_KEY=your-key
SERPER_LIVE_ENABLED=true
SIGNALHIRE_API_KEY=your-key
APOLLO_API_KEY=your-key
BETTERCONTACT_API_KEY=your-key
MOBILE_WORKER_SECRET=at-least-32-random-characters
```

`MOBILE_WORKER_SECRET` must match in the app and worker. Deployment generates it
once when missing. Preserve it so pending SignalHire callbacks remain valid.
Apollo needs People Enrichment and Webhook Result API permissions. BetterContact
requires its phone add-on. SignalHire must allow Person API access. Setup badges
indicate key presence, not a verified provider subscription or available credits.

After adding or updating keys, recreate both services to load the environment:

```sh
docker compose -f /opt/leadscope/deploy/docker-compose.yml up -d --no-build --force-recreate leadscope mobile-worker
```

Verify the worker is running and the dialog shows it online. The worker checks the
queue while idle without submitting provider requests. A pending setup step retries
within five minutes after the services load the keys. UI polling stops when the
dialog closes; server processing continues. Paid-provider verification remains
pending until keys are supplied and an explicit lookup is submitted.

## Release recovery

The migration is additive. Take a public/private schema data backup and tag the
previous application image before applying it. Roll back the application image if
needed; stop the worker as well. Keep the new tables and migration so no accepted
provider request, number or progress record is lost. Fix database defects forward.
Do not reapply a committed migration or drop the queue to roll back a UI release.
