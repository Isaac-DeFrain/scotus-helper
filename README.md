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

Set up environment variables in `.env` (`OPENAI_API_KEY` is needed for upload only):

```shell
OPENAI_API_KEY=your-openai-api-key
```

Make sure the docker daemon is running and then start Weaviate

```shell
docker compose up -d
```

## Usage

```shell
npm run scrape-opinions                 # scrape current term
npm run scrape-opinions -- --term 24    # scrape October Term 2024
npm run upload-opinions                 # push vectors to Weaviate
npm run inspect-weaviate                # print Weaviate health, collection counts, sample row
```

### Dockerized scripts

The repo includes a `Dockerfile` so you can run the scripts in a container while keeping Weaviate in Docker.

Start Weaviate:

```shell
docker compose up -d weaviate
```

Run a script:

```shell
docker compose run --rm app npm run <SCRIPT>
```

## Test

Run all tests

```shell
npm test
```

## Tech stack

- **Scraping**: axios + cheerio
- **PDF extraction**: pdf-parse
- **Database**: SQLite via better-sqlite3 + Kysely (type-safe query builder)
- **Embeddings**: OpenAI `text-embedding-3-small`
- **Vector store**: Weaviate (local, via Docker)

## Data sources

- Merits: `https://www.supremecourt.gov/opinions/slipopinion`
- Orders: `https://www.supremecourt.gov/opinions/relatingtoorders`
