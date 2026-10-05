# Open Desk

Personal job desk for entry-level roles Madeline would actually want. The first screen is still the local sample. **Run search** checks live Greenhouse, Ashby, Lever, and YC Work at a Startup boards, plus company career pages, then uses the same normalize, dedupe, hard-filter, and scoring pipeline. LinkedIn is not scraped.

A role reaches the main feed only if it is in New York City, Chicago, Boston, Miami, or Austin, is on-site or hybrid (unclear is kept when the office is in one of those cities), and is genuinely about 0–1 years. Roles that prefer about 2 years go to Stretch. Remote-only roles and harder experience bars are stored and excluded.

Each role has two scores. Opportunity fit (0–100) is how much the work resembles the kind of work she wants. Qualification risk (low, medium, high) is how much of a stretch applying would be. Risk never replaces fit.

## Run locally

Requires Node.js 22 or newer. No API keys and no Supabase project.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:41731](http://127.0.0.1:41731).

The first load creates a local Postgres database with PGlite under `.data/pglite` and seeds the sample. **Run search** fetches live postings. Sample roles stay on the desk until a live role passes the filters, then they step aside. Delete `.data/` to start over.

A live search can take a few minutes. One board timing out does not cancel the rest. The summary under the header reports companies checked, postings fetched, duplicates removed, exclusions, main-feed and stretch counts, and new roles.

## Test

```bash
npm test
```

That runs the location, experience (required vs preferred, main vs stretch vs reject), dedup canonical URL, and local database tests.

## Database

Schema lives in `db/migrations`. It is ordinary Postgres (`TEXT`, `INTEGER`, `BOOLEAN`, `TIMESTAMPTZ`) and can be applied to Supabase Postgres without a rewrite. The app uses embedded PGlite so it runs without cloud credentials. Point it at Supabase later by running those SQL files there and swapping the PGlite client for a Postgres connection.

## Not in this milestone

No LinkedIn client and no scheduled runs. LinkedIn stays out until there is a stable, compliant source.
