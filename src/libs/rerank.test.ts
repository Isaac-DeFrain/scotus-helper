import { splitSourceDocuments } from "./chat";

describe("splitSourceDocuments", () => {
  it("splits vector source blocks", () => {
    const context = `<SOURCE_1>
Case A | Chunk 1/2

First chunk.
</SOURCE_1>

<SOURCE_2>
Case B | Chunk 1/1

Second chunk.
</SOURCE_2>`;

    expect(splitSourceDocuments(context)).toEqual([
      `<SOURCE_1>
Case A | Chunk 1/2

First chunk.
</SOURCE_1>`,
      `<SOURCE_2>
Case B | Chunk 1/1

Second chunk.
</SOURCE_2>`,
    ]);
  });

  it("expands SQL_RESULTS arrays into one document per row", () => {
    const context = `<SQL_RESULTS>
[
  {
    "case_name": "Alpha v. Beta",
    "docket": "23-100"
  },
  {
    "case_name": "Gamma v. Delta",
    "docket": "23-200"
  }
]
</SQL_RESULTS>`;

    expect(splitSourceDocuments(context)).toEqual([
      `<SQL_RESULTS>
{
  "case_name": "Alpha v. Beta",
  "docket": "23-100"
}
</SQL_RESULTS>`,
      `<SQL_RESULTS>
{
  "case_name": "Gamma v. Delta",
  "docket": "23-200"
}
</SQL_RESULTS>`,
    ]);
  });

  it("keeps mixed vector and SQL blocks in order", () => {
    const context = `<SOURCE_1>
Case A

Chunk text.
</SOURCE_1>

<SQL_RESULTS>
[
  {
    "case_name": "Alpha v. Beta"
  }
]
</SQL_RESULTS>`;

    expect(splitSourceDocuments(context)).toHaveLength(2);
    expect(splitSourceDocuments(context)[0]).toContain("<SOURCE_1>");
    expect(splitSourceDocuments(context)[1]).toContain('"case_name": "Alpha v. Beta"');
  });
});
