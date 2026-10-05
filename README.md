# Open Desk

Personal job desk for entry-level roles Madeline would actually want. Milestone 1 loads a local sample, normalizes it, drops duplicates, applies hard filters, and scores what remains. It does not crawl LinkedIn, Greenhouse, or company sites.

A role reaches the main feed only if it is in New York City, Chicago, Boston, Miami, or Austin, is on-site or hybrid (unclear is kept when the office is in one of those cities), and is genuinely about 0–1 years. Roles that prefer about 2 years go to Stretch. Remote-only roles and harder experience bars are stored and excluded.

Each role has two scores. Opportunity fit (0–100) is how much the work resembles the kind of work she wants. Qualification risk (low, medium, high) is how much of a stretch applying would be. Risk never replaces fit.

## Run locally

Requires Node.js 22 or newer. No API keys and no Supabase project.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:41731](http://127.0.0.1:41731).

The first load creates a local Postgres database with PGlite under `.data/pglite` and seeds the sample. **Run search** reprocesses the sample, including two roles held back from the first load, and flags only those as new.

Delete `.data/` to start over.

## Test

```bash
npm test
```

That runs the location, experience (required vs preferred, main vs stretch vs reject), dedup canonical URL, and local database tests.

## Database

Schema lives in `db/migrations/0001_init.sql`. It is ordinary Postgres (`TEXT`, `INTEGER`, `BOOLEAN`, `TIMESTAMPTZ`) and can be applied to Supabase Postgres without a rewrite. Milestone 1 uses embedded PGlite because this environment has no Postgres server and the app must run without cloud credentials. Point the app at Supabase later by running that SQL there and swapping the PGlite client for a Postgres connection. Table names stay `companies`, `jobs`, `job_sources`, and `feedback`.

## Not in this milestone

No Greenhouse, Ashby, Lever, YC, or LinkedIn clients. No career-page crawler. No scheduled runs. Those are later phases. The architecture is in the project docs.
