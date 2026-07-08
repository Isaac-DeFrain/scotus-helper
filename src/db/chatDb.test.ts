import { Kysely, sql } from "kysely";

import {
  getAnalyticsSummary,
  getChatExchange,
  insertChatQuery,
  insertChatResponse,
  listChatExchanges,
  openChatDb,
  updateChatQueryLangsmithTraceId,
  type ChatDatabase,
} from "./chatDb";
import { buildQueryStats, selectorStepCost } from "../queryCost";

let db: Kysely<ChatDatabase>;

const BASE_TIME = 1_700_000_000;
const USER_A = "user-a";
const USER_B = "user-b";

beforeEach(async () => {
  db = openChatDb(":memory:");
});

afterEach(async () => {
  await db.destroy();
});

async function seedSuccessExchange(
  queryContent: string,
  responseContent: string,
  options?: { userId?: string | null; createdAt?: number },
) {
  const queryId = await insertChatQuery(db, {
    userId: options?.userId,
    content: queryContent,
    normalizedQuery: queryContent.toLowerCase(),
  });

  if (options?.createdAt !== undefined) {
    await sql`UPDATE chat_queries SET created_at = ${options.createdAt} WHERE id = ${queryId}`.execute(
      db,
    );
  }

  const stats = buildQueryStats([
    selectorStepCost(
      { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      100,
    ),
  ]);

  const responseId = await insertChatResponse(db, {
    queryId,
    content: responseContent,
    stats,
    status: "success",
    sources: [
      {
        caseName: "Roe v. Wade",
        docket: "22-1234",
        pdfUrl: "https://example.com/1.pdf",
      },
    ],
  });

  return { queryId, responseId };
}

describe("insertChatQuery and insertChatResponse", () => {
  it("persists a success exchange with step costs", async () => {
    const { responseId } = await seedSuccessExchange(
      "What is substantive due process?",
      "Substantive due process limits government action.",
      { userId: USER_A },
    );

    const exchange = await getChatExchange(db, responseId, USER_A);
    expect(exchange).not.toBeNull();
    expect(exchange?.userId).toBe(USER_A);
    expect(exchange?.queryContent).toBe("What is substantive due process?");
    expect(exchange?.responseContent).toContain("Substantive due process");
    expect(exchange?.sources).toHaveLength(1);
    expect(exchange?.stats.breakdown).toHaveLength(1);
    expect(exchange?.stats.costUsd).toBeGreaterThan(0);
  });

  it("persists per-step LLM outputs alongside step costs", async () => {
    const queryId = await insertChatQuery(db, {
      userId: USER_A,
      content: "What did the Court say about liberty?",
    });

    const selector = selectorStepCost(
      { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      100,
    );
    const chat = {
      step: "chat" as const,
      label: "Chat",
      description: "Chat step",
      costUsd: 0.001,
      durationMs: 200,
      inputTokens: 20,
      outputTokens: 10,
    };
    const stats = buildQueryStats([selector, chat]);

    const responseId = await insertChatResponse(db, {
      queryId,
      content: "The Court discussed liberty in several cases.",
      stats,
      status: "success",
      stepOutputs: {
        selector: {
          normalizedQuery: "What did the Court say about liberty?",
          isOnTopic: true,
          isSummary: false,
          queryType: "vector",
          reason: "Semantic search",
        },
        chat: {
          model: "gpt-4o",
          userPrompt: "What did the Court say about liberty?",
          response: "The Court discussed liberty in several cases.",
        },
      },
    });

    const exchange = await getChatExchange(db, responseId, USER_A);
    const selectorStep = exchange?.stats.breakdown.find(
      (step) => step.step === "selector",
    );
    const chatStep = exchange?.stats.breakdown.find(
      (step) => step.step === "chat",
    );

    expect(selectorStep?.output).toMatchObject({ queryType: "vector" });
    expect(chatStep?.output).toMatchObject({
      model: "gpt-4o",
      response: "The Court discussed liberty in several cases.",
    });
  });

  it("persists an error response", async () => {
    const queryId = await insertChatQuery(db, {
      userId: USER_A,
      content: "Off-topic question",
    });
    const responseId = await insertChatResponse(db, {
      queryId,
      content: "",
      status: "error",
      errorMessage: "Query is not on topic",
      stats: buildQueryStats([
        selectorStepCost(
          { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
          50,
        ),
      ]),
    });

    const exchange = await getChatExchange(db, responseId, USER_A);
    expect(exchange?.status).toBe("error");
    expect(exchange?.errorMessage).toBe("Query is not on topic");
  });

  it("persists a LangSmith trace id on the query row", async () => {
    const queryId = await insertChatQuery(db, {
      userId: USER_A,
      content: "Trace test",
    });

    await updateChatQueryLangsmithTraceId(
      db,
      queryId,
      "0195abcd-0000-7000-8000-000000000001",
      USER_A,
    );

    const responseId = await insertChatResponse(db, {
      queryId,
      content: "Trace response",
      status: "success",
    });

    const exchange = await getChatExchange(db, responseId, USER_A);
    expect(exchange?.langsmithTraceId).toBe(
      "0195abcd-0000-7000-8000-000000000001",
    );
  });

  it("does not return another user's exchange", async () => {
    const { responseId } = await seedSuccessExchange(
      "Private question",
      "Private answer",
      { userId: USER_A },
    );

    expect(await getChatExchange(db, responseId, USER_B)).toBeNull();
    expect(await getChatExchange(db, responseId, USER_A)).not.toBeNull();
  });

  it("stores null userId when omitted", async () => {
    const { responseId } = await seedSuccessExchange(
      "Unscoped question",
      "Unscoped answer",
    );

    const exchange = await getChatExchange(db, responseId);
    expect(exchange?.userId).toBeNull();
  });

  it("scopes reads to userId only when provided", async () => {
    const { responseId: scopedId } = await seedSuccessExchange(
      "Scoped question",
      "Scoped answer",
      { userId: USER_A },
    );
    const { responseId: unscopedId } = await seedSuccessExchange(
      "Legacy question",
      "Legacy answer",
    );

    expect(await getChatExchange(db, scopedId, USER_A)).not.toBeNull();
    expect(await getChatExchange(db, scopedId, USER_B)).toBeNull();
    expect(await getChatExchange(db, unscopedId, USER_A)).toBeNull();
    expect(await getChatExchange(db, unscopedId)).not.toBeNull();

    const scopedList = await listChatExchanges(db, {
      userId: USER_A,
      limit: 50,
      offset: 0,
    });
    expect(scopedList.total).toBe(1);
    expect(scopedList.items[0]?.id).toBe(scopedId);

    const unfilteredList = await listChatExchanges(db, {
      limit: 50,
      offset: 0,
    });
    expect(unfilteredList.total).toBe(2);
  });
});

describe("getAnalyticsSummary", () => {
  it("aggregates totals and groups step costs for one user", async () => {
    await seedSuccessExchange("First question", "First answer", {
      userId: USER_A,
    });
    await seedSuccessExchange("Second question", "Second answer", {
      userId: USER_A,
    });
    await seedSuccessExchange("Other user question", "Other answer", {
      userId: USER_B,
    });

    const summary = await getAnalyticsSummary(db, { userId: USER_A });
    expect(summary.queryCount).toBe(2);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(summary.totalDurationMs).toBe(200);
    expect(summary.avgCostUsd).toBeCloseTo(summary.totalCostUsd / 2);
    expect(summary.stepBreakdown).toHaveLength(1);
    expect(summary.stepBreakdown[0]?.step).toBe("selector");
  });
});

describe("listChatExchanges", () => {
  it("returns exchanges newest first with pagination for one user", async () => {
    await seedSuccessExchange("Older question", "Older answer", {
      userId: USER_A,
      createdAt: BASE_TIME,
    });
    await seedSuccessExchange("Newer question", "Newer answer", {
      userId: USER_A,
      createdAt: BASE_TIME + 3600,
    });
    await seedSuccessExchange("Other user", "Other answer", {
      userId: USER_B,
      createdAt: BASE_TIME + 7200,
    });

    const page = await listChatExchanges(db, {
      userId: USER_A,
      limit: 1,
      offset: 0,
    });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.queryContent).toBe("Newer question");

    const secondPage = await listChatExchanges(db, {
      userId: USER_A,
      limit: 1,
      offset: 1,
    });
    expect(secondPage.items[0]?.queryContent).toBe("Older question");
  });

  it("filters by created_at range", async () => {
    await seedSuccessExchange("Before range", "Answer", {
      userId: USER_A,
      createdAt: BASE_TIME,
    });
    await seedSuccessExchange("In range", "Answer", {
      userId: USER_A,
      createdAt: BASE_TIME + 1800,
    });
    await seedSuccessExchange("After range", "Answer", {
      userId: USER_A,
      createdAt: BASE_TIME + 7200,
    });

    const result = await listChatExchanges(db, {
      userId: USER_A,
      limit: 50,
      offset: 0,
      since: BASE_TIME + 900,
      until: BASE_TIME + 3600,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.queryContent).toBe("In range");
  });
});
