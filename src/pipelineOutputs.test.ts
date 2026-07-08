import {
  buildSqlStepOutput,
  parseStepOutput,
  sanitizeSqlRows,
  serializeStepOutput,
} from "./pipelineOutputs";

describe("sanitizeSqlRows", () => {
  it("truncates large text fields", () => {
    const rows = sanitizeSqlRows([
      {
        case_name: "Roe v. Wade",
        text: "x".repeat(3_000),
      },
    ]);

    expect(rows[0]?.text).toHaveLength(2_001);
    expect(String(rows[0]?.text).endsWith("…")).toBe(true);
  });

  it("preserves short fields and metadata", () => {
    const rows = sanitizeSqlRows([
      {
        case_name: "Roe v. Wade",
        docket: "22-1234",
        text: "Short opinion text.",
      },
    ]);

    expect(rows[0]).toEqual({
      case_name: "Roe v. Wade",
      docket: "22-1234",
      text: "Short opinion text.",
    });
  });
});

describe("buildSqlStepOutput", () => {
  it("includes generated SQL, reason, and sanitized rows", () => {
    const output = buildSqlStepOutput(
      {
        sqlQuery: "SELECT case_name FROM opinions",
        reason: "Need case names",
      },
      [{ case_name: "Roe v. Wade", text: "y".repeat(3_000) }],
    );

    expect(output.rowCount).toBe(1);
    expect(output.sqlQuery).toContain("SELECT");
    expect(String(output.rows[0]?.text).endsWith("…")).toBe(true);
  });
});

describe("serializeStepOutput", () => {
  it("round-trips JSON values", () => {
    const value = { normalizedQuery: "test", queryType: "sql" as const };
    expect(parseStepOutput(serializeStepOutput(value))).toEqual(value);
  });
});
