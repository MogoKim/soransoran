# Public view count: real exposure design

Status: implementation-ready design, not current policy authority  
Owner: D100 master  
As of: 2026-10-16 KST

This document turns the founder decision in the D100 canon into an implementation
contract. Until the implementation is merged and the authority documents are
updated, the current Production behavior remains the source of truth.

## 1. Purpose

The customer UI keeps one familiar number: `조회수`. The number should make real
activity visible without fabricating activity.

Public view count may include both:

- a community post card that a real browser actually kept in view; and
- a community post detail page that a real browser actually opened.

The two sources are stored separately for diagnosis and summed into the existing
`Post.viewCount` display counter. The system never derives views from comment
count, a random multiplier, a minimum floor, Persona activity or operator work.

## 2. AS-IS

- `Post.viewCount` is a single cumulative integer.
- `PostViewBeacon` calls `POST /api/view/[postId]` after detail hydration.
- The route suppresses a repeat in the same tab and uses one per-post cookie for
  a 30-minute browser window before incrementing `Post.viewCount`.
- Home, board, best and next-to-read list exposure is not measured.
- Admin, Persona and operator sessions are not resolved at the write boundary.
- The existing counter cannot explain how much came from detail opens versus
  list exposure.
- Home popularity and best admission do not use `viewCount`. The explicit
  board `조회순` sort does use it.

## 3. Product contract

### 3.1 Countable events

`DETAIL_OPEN`

- The detail page hydrated in a visible browser tab.
- One viewer contributes at most one event per post in a rolling-equivalent
  30-minute bucket.

`LIST_EXPOSURE`

- A post card is at least 50% visible for at least 1,000 continuous milliseconds.
- The tab must be visible for that dwell time.
- Home, community board, best and next-to-read are countable surfaces.
- One viewer contributes at most one list exposure per post across all list
  surfaces in a 30-minute bucket. Moving from home to a board does not add a
  second list exposure in that window.

Detail and list are distinct events. A person can therefore contribute one list
exposure and one detail open to the same post in the same window. Both are real
customer contacts, and the internal split remains auditable.

### 3.2 Excluded actors and requests

The write boundary excludes:

- a signed-in admin;
- a User connected to a Persona;
- a User connected to an OperatorWriter;
- an explicitly marked internal automation request (`x-bot-type`);
- Next.js/browser prefetch requests; and
- requests that did not originate from the hydrated visibility tracker.

Search crawlers normally do not execute the visibility tracker. The endpoint is
also `noindex` and outside the sitemap. User-Agent matching is only a secondary
known-bot guard, never the primary proof that a person saw a card.

### 3.3 Public display and ranking

- Existing screens continue to show only the eye icon and one integer.
- `Post.viewCount` remains the cumulative public total. Historical values are
  preserved; no backfill invents a source for old counts.
- New event rows identify `DETAIL_OPEN` or `LIST_EXPOSURE` and surface.
- Home popularity, best admission and North Star do not use views.
- The user-selected board `조회순` may continue to sort by the displayed total.
- Deleted, hidden or non-community-visible posts never receive a new event.

## 4. Identity, privacy and retention

- Signed-in eligible members use an HMAC of `member:<User.id>` as the dedupe key.
- Anonymous browsers receive one opaque, random, HTTP-only, same-site visitor
  cookie. The database stores only an HMAC of that token.
- The HMAC secret stays server-side. No IP address, raw cookie, User.id, title,
  body or referrer is stored in the exposure ledger.
- The cookie is only an anti-duplication identifier, not an advertising ID.
- Exposure rows are retained for 30 days, then removed by a bounded cleanup job.
  The cumulative `Post.viewCount` is not decremented when old ledger rows expire.
- The privacy notice must be checked before Production activation. If legal text
  needs a change, that change is a separate, explicit prerequisite.

## 5. Data contract

Add a small append-only ledger, for example `PostExposureEvent`:

| Field | Meaning |
|---|---|
| `id` | opaque primary key |
| `postId` | visible community post |
| `kind` | `DETAIL_OPEN` or `LIST_EXPOSURE` |
| `surface` | `DETAIL`, `HOME`, `BOARD`, `BEST`, `NEXT_TO_READ` |
| `viewerKeyHash` | server HMAC; never raw identity |
| `windowStart` | canonical 30-minute UTC bucket |
| `createdAt` | accepted event time |

Required uniqueness:

`(postId, kind, viewerKeyHash, windowStart)`

`surface` is evidence about where the first accepted event happened and is not
part of uniqueness. This prevents two list surfaces from double-counting.

The accepted-event transaction is:

1. resolve actor and exclusions;
2. verify the post with `COMMUNITY_VISIBLE_WHERE`;
3. create the unique ledger row;
4. only if creation succeeds, increment `Post.viewCount` by one;
5. on a uniqueness collision, return the same success response with no update.

Prisma APIs are used throughout. Raw SQL is not introduced. A batch endpoint may
accept at most 20 list events, but each event keeps the same transaction contract.

## 6. Client and endpoint contract

- Replace the per-post server cookie with the single anonymous visitor cookie
  and ledger uniqueness. Keep `sessionStorage` as a cheap client-side short cut.
- Detail uses the existing hydration-time beacon through the shared acceptance
  function.
- List links use an `IntersectionObserver` tracker with threshold 0.5 and a
  one-second dwell timer. Leaving the viewport or hiding the tab cancels the timer.
- Accepted candidates are sent in batches of at most 20. Flush every two seconds
  and on `pagehide`; use `sendBeacon` with keepalive fetch fallback.
- Tracking failure is failure-open for reading: cards and posts remain usable and
  the counter simply does not rise.
- Endpoints always return an indistinguishable success for accepted, duplicate,
  excluded and absent targets so they do not become an existence oracle.
- Apply per-client and per-route request limits. Oversized or malformed batches
  are rejected before DB work.

## 7. Legacy removal

The implementation PR removes these obsolete paths in the same change:

1. one HTTP cookie per viewed post;
2. direct `Post.viewCount` increment without a source ledger;
3. duplicated detail/list exclusion logic; and
4. any test that treats a raw API POST as proof of a human view.

The shared server acceptance function is the only place allowed to decide actor
eligibility, post visibility, dedupe and counter increment.

## 8. Acceptance tests

Pure and route tests:

1. detail hydration: one event and `viewCount +1`;
2. same detail viewer in the same bucket: zero additional events and increments;
3. same viewer after the next bucket: one additional detail event;
4. home then board in the same bucket: one list event total;
5. list then detail in the same bucket: two source rows and public total +2;
6. visibility below 50%, dwell below one second, hidden tab: zero calls;
7. admin, Persona, OperatorWriter and `x-bot-type`: zero rows and increments;
8. invisible, deleted and absent posts: zero rows and increments;
9. concurrent identical requests: exactly one row and one increment;
10. malformed or over-limit batch: zero writes;
11. source split totals equal accepted rows while public total keeps its historical
    baseline plus accepted rows;
12. home popularity, best admission and North Star fixtures are byte/behavior
    unchanged;
13. board `조회순` still uses the displayed total;
14. cleanup deletes expired ledger rows without changing public counts.

Mutation tests must catch removal of actor exclusion, post visibility, uniqueness,
the one-second dwell, hidden-tab cancellation and the ranking non-effect guard.

## 9. Rollout and rollback

### Phase V0: design and privacy check

- Confirm this contract and whether the existing privacy notice covers the
  anonymous anti-duplication cookie and 30-day pseudonymous event ledger.
- No Production behavior changes.

### Phase V1: schema and shared acceptance path

- Add migration, shared server logic and isolated DB tests.
- Keep list tracking off; migrate detail tracking to the ledger.
- Verify historical public counts do not reset.

### Phase V2: list exposure canary

- Enable only the home surface for a bounded canary.
- Compare browser tracker calls, accepted ledger rows and public increments.
- PASS requires duplicate, excluded-actor and hidden-post increments all equal 0.

### Phase V3: all list surfaces

- Add board, best and next-to-read.
- Production sample-check source split and request volume.

Rollback disables list tracking first. If needed, revert the web deployment. The
ledger table can remain unused; accepted historical increments are real events and
are not subtracted. Migration removal is a later cleanup, never an emergency step.

## 10. Execution schedule and ownership

- 2026-10-16: design and AS-IS audit complete locally.
- 2026-10-17: privacy decision, implementation ownership and targeted fixtures.
- 2026-10-18: schema/shared path/list tracker implementation and one exact-head CI.
- 2026-10-19: Production canary target, provided Dn/runtime file ownership does
  not overlap and the migration is independently reviewed.
- After one clean natural day: expand to every list surface.

This lane is independent of D5/D10 proof and must not delay a natural stage run.
Schema, web components and exposure tests belong to one writer. D100 runtime,
Persona activation, comments and stage-controller files remain untouched.

## 11. Completion definition

The feature is not complete at code merge. Completion requires:

- code/static PASS;
- migration and Production deployment PASS;
- a real-browser sample where list and detail events reconcile with the public
  integer;
- excluded actor and duplicate samples equal zero;
- no change to home/best/North Star decisions; and
- rollback path verified without deleting accepted evidence.
