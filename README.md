# scotus-helper

[![CI](https://github.com/Isaac-DeFrain/scotus-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/Isaac-DeFrain/scotus-helper/actions/workflows/ci.yml)
[![Release](https://github.com/Isaac-DeFrain/scotus-helper/actions/workflows/release.yml/badge.svg)](https://github.com/Isaac-DeFrain/scotus-helper/actions/workflows/release.yml)
[![Deploy](https://github.com/Isaac-DeFrain/scotus-helper/actions/workflows/deploy.yml/badge.svg)](https://github.com/Isaac-DeFrain/scotus-helper/actions/workflows/deploy.yml)

A RAG-powered chat app for exploring [U.S. Supreme Court slip opinions](https://www.supremecourt.gov/opinions/opinions.aspx). Ask questions across indexed merits and orders opinions; get answers streamed from `gpt-4o` with source citations linked to the original PDFs. A daily cron job keeps the corpus current.

## Architecture

### Ingestion

Opinions are scraped from the SCOTUS website, extracted from PDFs, and stored in SQLite (`opinions`). `upload-opinions` chunks each opinion, embeds via OpenAI, caches chunks and vectors in SQLite (`opinion_chunks`), then upserts them into Weaviate. This runs once on setup and daily via cron.

```mermaid
flowchart LR
    A[SCOTUS website] --> B[scrape-opinions]
    B --> OP[(SQLite: opinions)]

    subgraph upload [upload-opinions]
        CH[chunk text]
        EM[OpenAI embeddings]
        CH --> EM
        EM --> OC[(SQLite: opinion_chunks)]
        OC --> WV[(Weaviate)]
    end

    OP --> CH
```

### Chat query flow

Each user query passes through several stages before a response is streamed:

```mermaid
flowchart LR
    U[User query] --> S[Selector<br/>gpt-4o-mini]
    S -->|off-topic| ERR[400 error]
    S -->|on-topic| R{Retrieval strategy}

    R -->|vector / both| V[Embed query]
    V --> WV[(Weaviate)]
    WV --> CTX[Context]

    R -->|sql / both| SQ[SQL generator<br/>gpt-4o]
    SQ --> OP[(SQLite: opinions)]
    OP --> CTX
    SQ -.->|fallback chunks| OC[(SQLite: opinion_chunks)]
    OC --> CTX

    CTX --> SUM["Case summaries<br/>gpt-4o-mini when isSummary"]
    SUM --> RR[Cohere rerank]
    RR --> GPT[gpt-4o stream]
    GPT --> OUT[Response + stream metadata]
```

1. **Selector** (`gpt-4o-mini`) — normalizes the query, checks whether it is on-topic, sets `isSummary` when the user is asking for a case summary, and picks a retrieval strategy: `sql`, `vector`, `both`, or `none`. Off-topic queries are rejected with `400`.
2. **Retrieval** — runs as needed based on the selector's decision:
   - **Vector**: embeds the query (`text-embedding-3-small`) and searches Weaviate for the most similar opinion chunks.
   - **SQL**: generates and executes a read-only `SELECT` against SQLite (`gpt-4o`). When there are no vector chunks, the query is not a summary, and the SQL rows lack a `text` column, matching rows are loaded from `opinion_chunks` by case name (for citation links).
3. **Case summarization** (`gpt-4o-mini`) — when `isSummary` is true and SQL rows include opinion text, produces a per-case summary before reranking.
4. **Reranking** (Cohere `rerank-v3.5`) — scores and reorders the combined retrieval results to surface the most relevant context.
5. **Generation** (`gpt-4o`) — streams an answer grounded in the reranked context. Source citations and query stats are appended to the response body as an HTML-comment suffix containing base64-encoded JSON (`<!--SCOTUS_QUERY_META:…-->`).

Exchanges are persisted server-side after each chat; see [Chat history](#chat-history).

### Chat history

Chat exchanges (question, answer, sources, cost/duration stats, per-step pipeline outputs, and optional LangSmith trace id) are persisted server-side in SQLite (`data/chat.db`, or `CHAT_DB_PATH`). The browser keeps only an anonymous `userId` in `localStorage` so the history sidebar and `/history/:id` can scope analytics requests to that client.

```mermaid
flowchart LR
    UI["Browser"] -->|"POST /api/chat {query, userId}"| CHAT["/api/chat"]
    CHAT -->|"persist"| CDB[("chat.db")]
    CHAT -->|"stream + X-LangSmith-Trace-Id"| UI
    Hist["History sidebar<br/>/history/:id"] -->|"GET /api/analytics/... ?userId="| AN["/api/analytics"]
    AN --> CDB
    Hist -->|"GET .../queries/[id]/trace"| LS_API["LangSmith proxy"]
```

The chat page shows a collapsible **History** panel on the left (overlay drawer on narrow screens) with truncated previews and time/cost stats. Click an item to open `/history/:id`, which shows the full question, answer, per-step timing/cost and stored step outputs (each LLM step links to its LangSmith run when tracing is enabled), and the LangSmith trace tree. Use **Ctrl+↑** / **Ctrl+↓** to move between exchanges in the history list.

| Endpoint | Description |
| -------- | ----------- |
| `GET /api/analytics/queries` | Paginated exchange list (`userId`, `limit`, `offset`, optional time bounds) |
| `GET /api/analytics/queries/[id]` | Full exchange detail, including step costs and outputs |
| `GET /api/analytics/queries/[id]/trace` | LangSmith trace tree plus per-step run URLs (requires `LANGSMITH_API_KEY`) |
| `GET /api/analytics/summary` | Aggregate cost/duration stats for the scoped user |

`POST /api/chat` accepts `{ "query": "...", "userId": "..." }`.

## Setup

Follow these steps or see [Docker](#docker):

1. Install dependencies

    ```shell
    npm install
    ```

    Optional: enable the pre-commit hook so each commit runs the same checks as CI (`npm ci`, audit, lint, typecheck, test):

    ```shell
    make install-githooks
    ```

    Run those checks manually with `make ci`. Disable the hook with `make uninstall-githooks`. Skip it once with `git commit --no-verify`. Set `CI_LOCAL_DOCKER=1` before `make ci` to also run the Release workflow Docker build.

2. Set up environment variables in `.env` (see [`.env.example`](./.env.example)).

3. Scrape opinions

    ```shell
    npm run scrape-opinions
    ```

4. Start Weaviate locally via Docker

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

The repo includes a multi-stage `Dockerfile` and a `docker-compose.yml` that bring up the Next.js web app and Weaviate together. A `Makefile` wraps every `docker compose` command and automatically injects your host `UID`/`GID` as build args and runtime user IDs so files written into the `./data` volume are owned by you, not root.

All data-writing services run as `${UID}:${GID}`: `scrape`, `upload`, and `app` (the app entrypoint drops privileges on startup). The `cron` container stays root (required by `crond`), but its scheduled sync job runs as the same UID/GID via a user crontab in `Dockerfile.cron`. On a VPS without `make`, set `UID` and `GID` in your shell or `.env` if your deploy user is not `1000:1000`.

### Production releases

On every merge to `main`, CI runs, then the [Release workflow](.github/workflows/release.yml) builds the app image, pushes it to [GitHub Container Registry](https://github.com/Isaac-DeFrain/scotus-helper/pkgs/container/scotus-helper), and creates a GitHub release tagged `sha-<commit>`. The [Deploy workflow](.github/workflows/deploy.yml) then pulls that image on the VPS.

```shell
docker pull ghcr.io/isaac-defrain/scotus-helper:latest
docker pull ghcr.io/isaac-defrain/scotus-helper:sha-<commit>
```

### Running the full stack

```shell
cp .env.example .env   # fill in OPENAI_API_KEY, COHERE_API_KEY
make up dev
```

The app will be available at `http://localhost:3000`. Weaviate data is persisted in a named Docker volume (`weaviate_data`); the app mounts `./data` read-only for `opinions.db`. Chat history is written to a named volume (`chat_data`) at `CHAT_DB_PATH` (`/app/chat-data/chat.db`).

To reclaim disk space from stopped containers, unused networks, and dangling images:

```shell
make prune
```

### Automatic daily sync (cron)

The `cron` service runs `scrape-opinions` followed by `upload-opinions` every day at **08:00 UTC**. It starts automatically with `make up dev`.

View its output:

```shell
make logs cron
make logs follow cron   # tail -f
make logs not weaviate  # all services except weaviate
```

To change the schedule, edit the `RUN echo "0 8 * * * …"` line in `Dockerfile.cron` using standard cron syntax, then rebuild:

```shell
make build
docker compose up -d cron
```

### Running scripts against the Dockerized stack

Use the [Makefile](./Makefile)

```shell
make scrape         # scrape opinions and store in SQLite
make upload         # upload opinion chunks to Weaviate
make inspect dev    # inspect Weaviate health and collection counts
```

## Scripts

1. `npm run scrape-opinions`

    Fetches the merits and orders listing pages, downloads each PDF, extracts text, and upserts opinion rows into SQLite (`data/opinions.db`). If a listing link includes `#page=N`, only pages from that start through the next opinion in the same file (or the end of the PDF) are stored; otherwise the whole PDF is used. Rows that share the same file batch one download. Defaults to the current term.

    | Flag | Behaviour |
    | ---- | --------- |
    | _(none)_ | current term only |
    | `-- --all` | all terms from 2018 to present |
    | `-- --term 24` or `-- --term 2024` | October Term 2024 only |

2. `npm run upload-opinions`

    For each opinion in SQLite, chunks the text and calls OpenAI (`text-embedding-3-small`) to generate embeddings, caching results in an `opinion_chunks` table so re-runs skip already-embedded opinions. Then batch-upserts all chunks as vectors into Weaviate (`SupremeCourtOpinions` collection, created automatically if absent).

3. `npm run inspect-weaviate`

    Prints Weaviate health (live/ready/version), lists all collections, and for `SupremeCourtOpinions` shows the object count and a sample object.

## Test

Run all tests

```shell
npm test
```

## API

### `POST /api/selector`

Normalizes the query, checks whether it is on-topic for U.S. Supreme Court opinions, detects summary requests, and picks a retrieval strategy. Uses `gpt-4o-mini` (LangSmith-wrapped).

Request shape:

```ts
{ query: string }
```

Response shape:

```ts
{
  normalizedQuery: string;
  isOnTopic: boolean;
  isSummary: boolean;
  queryType: "sql" | "vector" | "both" | "none";
  reason: string;
}
```

### `POST /api/sql-query-generator`

Takes a normalized user query (from the [selector](./src/api/selector.ts)) and returns a read-only `SELECT` for the [SQLite schema](./src/db/db.ts) (`gpt-4o`, LangSmith-wrapped). Used by the chat flow when structured retrieval is needed.

Request shape:

```ts
{ normalizedQuery: string }
```

Response shape:

```ts
{
  sqlQuery: string;
  reason: string;
}
```

### `POST /api/chat`

Runs the selector in-process, retrieves context via vector search and/or SQL as needed, optionally summarizes cases (`gpt-4o-mini` when `isSummary`), reranks with Cohere, then streams a `gpt-4o` response. Off-topic queries are rejected with `400`. Sources and query stats are appended as an HTML-comment suffix with base64-encoded JSON (`<!--SCOTUS_QUERY_META:…-->`). Successful, failed, and interrupted exchanges are persisted to `chat.db`. When LangSmith tracing is enabled, the root trace id is returned in `X-LangSmith-Trace-Id` and stored on the exchange; the history detail page loads the tree via `GET /api/analytics/queries/[id]/trace`. See the [Architecture](#architecture) section for the full flow.

Request shape:

```ts
{ query: string; userId?: string | null }
```

Response shape:

```ts
// Streaming text/plain body; trailing suffix:
// <!--SCOTUS_QUERY_META:<base64 JSON>-->
// Decoded payload: { stats: QueryStats; sources?: Source[] }
// (sources omitted when empty; legacy payloads may be QueryStats alone)
//
// response headers:
// - X-LangSmith-Trace-Id: root LangSmith trace id (when tracing is enabled)

type Source = {
  caseName: string;
  docket?: string;
  pdfUrl: string;
};
```

Analytics exchange objects include `langsmithTraceId` when tracing was active for that request.

## Tech stack

- **Web framework**: Next.js 15 (React 19, App Router)
- **Scraping**: axios + cheerio
- **PDF extraction**: pdf-parse
- **Database**: SQLite via better-sqlite3 + Kysely — `opinions.db` (corpus) and `chat.db` (history / analytics)
- **Embeddings**: OpenAI `text-embedding-3-small`
- **Query routing**: OpenAI `gpt-4o-mini` (selector: normalize + topic filter + `isSummary` + sql/vector/both/none)
- **Case summaries**: OpenAI `gpt-4o-mini` (when selector marks `isSummary`)
- **Chat**: OpenAI `gpt-4o`
- **Reranking**: Cohere `rerank-v3.5`
- **Vector store**: Weaviate (local, via Docker)
- **Validation**: Zod
- **Observability**: LangSmith (optional tracing)

## Data sources

- Merits: <https://www.supremecourt.gov/opinions/slipopinion>
- Orders: <https://www.supremecourt.gov/opinions/relatingtoorders>

## Demo video

<https://cap.link/sw50negmy1wkct6>

---

### AI co-authors

- [Claude Sonnet 4.6](https://www.anthropic.com/claude/sonnet)
- [Cursor Composer 2](https://cursor.com/blog/composer-2)
- [Cursor Composer 2.5](https://cursor.com/blog/composer-2-5)
