import type { Run } from "langsmith/schemas";

import { stepFromRun } from "./langsmithTrace";

function run(partial: Partial<Run> & Pick<Run, "id" | "name">): Run {
  return {
    run_type: "llm",
    inputs: {},
    ...partial,
  };
}

describe("stepFromRun", () => {
  it("reads the pipeline step from run metadata", () => {
    expect(
      stepFromRun(
        run({
          id: "1",
          name: "ChatOpenAI",
          extra: { metadata: { step: "selector", queryId: 42 } },
        }),
      ),
    ).toBe("selector");
  });

  it("falls back to the run name when it matches a pipeline step", () => {
    expect(
      stepFromRun(
        run({
          id: "2",
          name: "sql",
        }),
      ),
    ).toBe("sql");
  });

  it("returns null for unrelated runs", () => {
    expect(
      stepFromRun(
        run({
          id: "3",
          name: "ChatOpenAI",
        }),
      ),
    ).toBeNull();
  });
});
