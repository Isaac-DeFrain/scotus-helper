import {
  applyCaseSummariesToSqlRows,
  extractCaseSummaryInputs,
} from "./caseSummarizer";
import { summaryStepCost } from "./queryCost";

describe("extractCaseSummaryInputs", () => {
  it("returns case names and text from SQL rows", () => {
    const cases = [
      { case_name: "A v. B", text: "Opinion A" },
      { case_name: "C v. D", text: "Opinion B" },
    ];
    expect(extractCaseSummaryInputs(cases)).toEqual(
      cases.map((c) => ({ caseName: c.case_name, text: c.text })),
    );
  });

  it("skips rows without text", () => {
    expect(
      extractCaseSummaryInputs([{ case_name: "A v. B", docket: "24-1" }]),
    ).toEqual([]);
  });
});

describe("applyCaseSummariesToSqlRows", () => {
  it("replaces text with summary while preserving metadata", () => {
    expect(
      applyCaseSummariesToSqlRows(
        [
          { case_name: "A v. B", docket: "24-1", text: "Full opinion" },
          { case_name: "C v. D", docket: "24-2", text: "Another opinion" },
        ],
        [
          { caseName: "A v. B", summary: "Summary A", usage: undefined },
          { caseName: "C v. D", summary: "Summary B", usage: undefined },
        ],
      ),
    ).toEqual([
      { case_name: "A v. B", docket: "24-1", summary: "Summary A" },
      { case_name: "C v. D", docket: "24-2", summary: "Summary B" },
    ]);
  });
});

describe("summaryStepCost", () => {
  it("aggregates parallel summary usage into one step", () => {
    const durationMs = 1200;
    const step = summaryStepCost(
      [
        {
          prompt_tokens: 1_000,
          completion_tokens: 200,
          total_tokens: 1_200,
        },
        {
          prompt_tokens: 800,
          completion_tokens: 150,
          total_tokens: 950,
        },
      ],
      durationMs,
    );

    expect(step.step).toBe("summary");
    expect(step.durationMs).toBe(1200);
    expect(step.inputTokens).toBe(1800);
    expect(step.outputTokens).toBe(350);
    expect(step.costUsd).toBeGreaterThan(0);
  });
});
