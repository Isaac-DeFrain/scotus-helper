import {
  buildQueryStats,
  costFromOpenAIUsage,
  costFromRerank,
  formatCost,
  formatDuration,
} from "./queryCost";

describe("costFromOpenAIUsage", () => {
  it("computes gpt-4o-mini cost from token usage", () => {
    const cost = costFromOpenAIUsage("gpt-4o-mini", {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      total_tokens: 2_000_000,
    });

    expect(cost).toBeCloseTo(0.75);
  });

  it("computes gpt-4o cost from token usage", () => {
    const cost = costFromOpenAIUsage("gpt-4o", {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      total_tokens: 2_000_000,
    });

    expect(cost).toBeCloseTo(12.5);
  });

  it("returns zero when usage is missing", () => {
    expect(costFromOpenAIUsage("gpt-4o", undefined)).toBe(0);
  });
});

describe("costFromRerank", () => {
  it("uses per-search-unit pricing", () => {
    expect(costFromRerank(1)).toBeCloseTo(0.002);
  });

  it("scales cost by billed search units", () => {
    expect(costFromRerank(3)).toBeCloseTo(0.006);
  });
});

describe("buildQueryStats", () => {
  it("sums step costs and durations into totals", () => {
    const stats = buildQueryStats([
      {
        step: "selector",
        label: "Selector",
        description: "Selector step",
        costUsd: 0.0001,
        durationMs: 300,
      },
      {
        step: "chat",
        label: "Chat",
        description: "Chat step",
        costUsd: 0.008,
        durationMs: 4200,
      },
    ]);

    expect(stats.costUsd).toBeCloseTo(0.0081);
    expect(stats.durationMs).toBe(4500);
    expect(stats.breakdown).toHaveLength(2);
  });
});

describe("formatCost", () => {
  it("formats larger costs to three decimals", () => {
    expect(formatCost(0.0123)).toBe("$0.012");
  });

  it("formats tiny costs to five decimals", () => {
    expect(formatCost(0.00012)).toBe("$0.00012");
  });
});

describe("formatDuration", () => {
  it("formats sub-minute durations", () => {
    expect(formatDuration(4200)).toBe("4.2s");
  });

  it("formats minute-plus durations", () => {
    expect(formatDuration(64_000)).toBe("1m 04s");
  });
});
