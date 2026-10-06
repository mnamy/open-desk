# Open Desk

A job desk for early-career tech generalists interested in product, ops, strategy, growth, research, innovation, and founder or generalist roles in New York, Chicago, Boston, Miami, and Austin. The first screen is a local sample. **Run search** checks live Greenhouse, Ashby, Lever, and YC Work at a Startup boards, plus company career pages, then uses the same normalize, dedupe, hard-filter, and scoring pipeline. LinkedIn is not scraped.

A role reaches the main feed only if it is in one of those cities, is on-site or hybrid (unclear is kept when the office is in one of those cities), and is genuinely about 0–1 years. Roles that prefer about 2 years go to Stretch. Remote-only roles and harder experience bars are stored and excluded.

Each role has two scores. Opportunity fit (0–100) scores ownership, cross-functional work, strategy, experimentation, user exposure, and proximity to decisions. Product exposure helps, and it is one part of the score. Qualification risk (low, medium, high) is how much of a stretch applying would be. Risk never replaces fit.

## Run locally

Requires Node.js 22 or newer. Leave the Neon variables unset to use embedded PGlite. No API keys.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:41731](http://127.0.0.1:41731).

The first load creates a local Postgres database under `.data/pglite` and seeds the sample. **Run search** fetches live postings in short passes. Sample roles stay on the desk until a live role passes the filters, then they step aside. Delete `.data/` to start over.

A full live search can take a few minutes. One board timing out does not cancel the rest. The summary under the header reports companies checked, postings fetched, duplicates removed, exclusions, main-feed and stretch counts, and new roles.

## Production

Production uses Neon Postgres provisioned by the Vercel integration. The app reads `DATABASE_URL` for requests and `DATABASE_URL_UNPOOLED` for migrations. Legacy `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING` are used only when those are absent. With none of them set, the app uses PGlite.

Do not commit connection strings. Vercel injects them into the deployment. Migrations also run on startup, so a separate migrate step is optional:

```bash
npm run db:migrate
```

Run search calls `/api/search` once per pass so a single request stays within a one-minute serverless limit. Each pass saves its jobs before the next pass starts.

## Test

```bash
npm test
```

That runs the location, experience (required vs preferred, main vs stretch vs reject), dedup canonical URL, batched search, and local database tests.

## Database

Schema lives in `db/migrations`. It is ordinary Postgres (`TEXT`, `INTEGER`, `BOOLEAN`, `TIMESTAMPTZ`). Local development uses PGlite. Production uses the Neon connection from Vercel.

## Not in this milestone

No LinkedIn client and no scheduled runs. LinkedIn stays out until there is a stable, compliant source.
