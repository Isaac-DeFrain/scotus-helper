# scotus-opinion-helper

A RAG-powered chat app for exploring [U.S. Supreme Court slip opinions](https://www.supremecourt.gov/opinions/opinions.aspx). On first launch it scrapes [merits](https://www.supremecourt.gov/opinions/slipopinion) and [orders](https://www.supremecourt.gov/opinions/relatingtoorders) listings, extracts full text from PDFs, chunks and embeds the content with OpenAI, and loads the vectors into [Weaviate](https://github.com/weaviate/weaviate) — then starts a Next.js chat UI backed by [`gpt-4o-mini`](https://developers.openai.com/api/docs/models/gpt-4o-mini) that lets you ask questions across all indexed opinions. A daily cron job keeps the corpus current.

## Setup

Use [Docker](#docker) or follow these steps:

1. Install dependencies

    ```shell
    npm i
    ```

2. Set up environment variables in `.env` (see `.env.example`).

3. Scrape opinions

    ```shell
    npm run scrape-opinions -- --all
    ```

4. Start Weaviate

    ```shell
    docker compose up -d weaviate
    ```

5. Upload opinions

    ```shell
    npm run upload-opinions
    ```

6. Run the chat app locally

    ```shell
    npm run dev
    ```

7. Then open `http://localhost:3000` and start asking questions!

## Docker

The repo includes a multi-stage `Dockerfile` and a `docker-compose.yml` that bring up the Next.js web app and Weaviate together. A `Makefile` wraps every `docker compose` command and automatically injects your host `UID`/`GID` as build args so files written into the `./data` volume are owned by you, not root.

### Running the full stack

```shell
cp .env.example .env   # fill in OPENAI_API_KEY
make up
```

The app will be available at `http://localhost:3000`. Weaviate data is persisted in a named Docker volume (`weaviate_data`).

### Automatic daily sync (cron)

The `cron` service runs `scrape-opinions` followed by `upload-opinions` every day at **08:00 UTC**. It starts automatically with `make up`.

View its output:

```shell
make logs SERVICE=cron
```

To change the schedule, edit the `RUN echo "0 8 * * * …"` line in `Dockerfile.cron` using standard cron syntax, then rebuild:

```shell
make build
docker compose up -d cron
```

### Running scripts against the Dockerized stack

```shell
make scrape   # scrape opinions and store in SQLite
make upload   # upload opinion chunks to Weaviate
make inspect  # inspect Weaviate health and collection counts
```

## Scripts

1. `npm run scrape-opinions` — fetches the merits and orders listing pages, downloads each PDF, extracts full text, and upserts opinion rows into SQLite (`data/opinions.db`). Lightweight JSON metadata backups are written to `data/opinions/{opinionType}/{termYear}/`. Defaults to the current term.

    | Flag | Behaviour |
    | ---- | --------- |
    | _(none)_ | current term only |
    | `-- --all` | all terms from 2018 to present |
    | `-- --term 24` | October Term 2024 only |

2. `npm run upload-opinions` — for each opinion in SQLite, chunks the text and calls OpenAI (`text-embedding-3-small`) to generate embeddings, caching results in an `opinion_chunks` table so re-runs skip already-embedded opinions. Then batch-upserts all chunks as vectors into Weaviate (`SupremeCourtOpinions` collection, created automatically if absent).

3. `npm run inspect-weaviate` — prints Weaviate health (live/ready/version), lists all collections, and for `SupremeCourtOpinions` shows the object count and a sample object.

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
- **Embeddings & chat**: OpenAI (`text-embedding-3-small`, `gpt-4o-mini`)
- **Vector store**: Weaviate (local, via Docker)
- **Validation**: Zod
- **Observability**: LangSmith (optional tracing)

## Data sources

- Merits: `https://www.supremecourt.gov/opinions/slipopinion`
- Orders: `https://www.supremecourt.gov/opinions/relatingtoorders`
