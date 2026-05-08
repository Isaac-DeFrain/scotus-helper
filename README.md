# scotus-opinion-helper

Scrapes US Supreme Court slip opinions from two listing pages (merits, orders), extracts full text from PDFs, generates embeddings, and loads everything into a local Weaviate vector store for semantic search.

## How it works

1. `npm run scrape-opinions` — fetches the listing pages, downloads each PDF, extracts text, chunks it, generates OpenAI embeddings, and writes everything to SQLite (`data/opinions.db`). Metadata-only JSON backups are written to `data/opinions/{opinionType}/{year}/`.

2. `npm run upload-opinions` — reads pre-computed chunks and vectors from SQLite and upserts them into Weaviate. No re-embedding.

## Setup

With [Nix](https://nixos.org/), enter a shell that includes Node.js and npm (see `flake.nix`):

```shell
nix develop
```

Install dependencies

```shell
npm i
```

Set up environment variables in `.env`

```shell
OPENAI_API_KEY=your-openai-api-key
WEAVIATE_URL=http://localhost:8080
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
