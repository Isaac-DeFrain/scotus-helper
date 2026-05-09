# scotus-opinion-helper

Scrapes US Supreme Court slip opinions from two listing pages (merits, orders), extracts full text from PDFs, and stores rows in SQLite. Chunking, OpenAI embeddings, and Weaviate upload happen in a separate step.

## How it works

1. `npm run scrape-opinions` — fetches the listing pages, downloads each PDF, extracts text, and writes opinion rows to SQLite (`data/opinions.db`). Metadata-only JSON backups are written to `data/opinions/{opinionType}/{termYear}/`.

2. `npm run upload-opinions` — reads every opinion from SQLite, chunks text in memory, calls OpenAI to embed chunks, and upserts vectors into Weaviate. Chunks are not persisted in SQLite. The collection must define a self-provided named vector `default` (the script creates this automatically). If you previously created an empty `SupremeCourtOpinions` collection without vectors, delete it (or wipe the Weaviate Docker volume) before uploading again.

3. `npm run inspect-weaviate` — prints Weaviate health (live/ready/version), lists collections, checks whether `SupremeCourtOpinions` exists, and if so prints its object count plus a sample object's UUID and properties.

## Setup

With [Nix](https://nixos.org/), enter a shell that includes Node.js and npm (see `flake.nix`):

```shell
nix develop
```

Install dependencies

```shell
npm i
```

Set up environment variables in `.env` (see `.env.example`).

Make sure the docker daemon is running and then start Weaviate

```shell
docker compose up -d weaviate
```

## Usage

```shell
npm run scrape-opinions                 # scrape current term
npm run scrape-opinions -- --all        # scrape all terms: 2018-2025
npm run scrape-opinions -- --term 24    # scrape October Term 2024
npm run upload-opinions                 # push vectors to Weaviate
npm run inspect-weaviate                # print Weaviate health, collection counts, sample row
```

## Web UI

After you've scraped and uploaded opinion chunks to Weaviate, you can run a small Next.js UI that streams answers from OpenAI using retrieved SCOTUS opinion excerpts as context.

Set environment variables in `.env` (see `.env.example`).

Run the app locally:

```shell
npm run dev
```

Or run the full stack with Docker (see [Docker](#docker) below).

Then open `http://localhost:3000`.

## Docker

The repo includes a multi-stage `Dockerfile` and a `docker-compose.yml` that bring up the Next.js web app and Weaviate together.

### Running the full stack

```shell
cp .env.example .env   # fill in OPENAI_API_KEY
docker compose up --build
```

The app will be available at `http://localhost:3000`. Weaviate data is persisted in a named Docker volume (`weaviate_data`).

### Automatic daily sync (cron)

The `cron` service runs `scrape-opinions` followed by `upload-opinions` every day at **08:00 UTC**. It starts automatically with `docker compose up`.

View its output:

```shell
docker compose logs -f cron
```

To change the schedule, edit the `RUN echo "0 8 * * * …"` line in `Dockerfile.cron` using standard cron syntax, then rebuild:

```shell
docker compose build cron
docker compose up -d cron
```

### Running scripts against the Dockerized stack

```shell
# scrape opinions and store in SQLite
docker compose run --rm app npm run scrape-opinions

# upload opinion chunks to Weaviate
docker compose run --rm app npm run upload-opinions

# inspect Weaviate health and collection counts
docker compose run --rm app npm run inspect-weaviate
```

## Test

Run all tests

```shell
npm test
```

## Tech stack

- **Web framework**: Next.js 15 (React 19, App Router)
- **Scraping**: axios + cheerio
- **PDF extraction**: pdf-parse
- **Database**: SQLite via better-sqlite3 + Kysely (type-safe query builder)
- **Embeddings & chat**: OpenAI (`text-embedding-3-small`, `gpt-4o`)
- **Vector store**: Weaviate (local, via Docker)
- **Validation**: Zod
- **Observability**: LangSmith (optional tracing)

## Data sources

- Merits: `https://www.supremecourt.gov/opinions/slipopinion`
- Orders: `https://www.supremecourt.gov/opinions/relatingtoorders`
