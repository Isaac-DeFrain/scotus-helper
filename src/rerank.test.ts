import { splitSourceDocuments } from "./chat/chat";
import { selectRerankedDocuments } from "./rerank";

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
    expect(splitSourceDocuments(context)[1]).toContain(
      '"case_name": "Alpha v. Beta"',
    );
  });
});

describe("selectRerankedDocuments", () => {
  it("keeps a single document regardless of score", () => {
    expect(
      selectRerankedDocuments([{ document: "only source", score: 0.1 }]),
    ).toEqual([{ document: "only source", score: 0.1 }]);
  });

  it("drops low-scoring documents when multiple candidates exist", () => {
    const results = [
      { document: "strong", score: 0.92 },
      { document: "weak", score: 0.31 },
      { document: "borderline", score: 0.5 },
    ];

    expect(selectRerankedDocuments(results)).toEqual([
      { document: "strong", score: 0.92 },
      { document: "borderline", score: 0.5 },
    ]);
  });

  it("keeps the top document when every score is below the threshold", () => {
    const results = [
      { document: "best of bad", score: 0.2 },
      { document: "worse", score: 0.1 },
    ];

    expect(selectRerankedDocuments(results)).toEqual([
      { document: "best of bad", score: 0.2 },
    ]);
  });
});
