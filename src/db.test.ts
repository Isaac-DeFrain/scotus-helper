import { openDb, queryOpinions, AppDatabase, OpinionTextRow } from "./db";
import { Kysely } from "kysely";

const MERITS_OPINIONS = [
    {
        opinion_number: 1,
        opinion_type: "merits" as const,
        term_year: 2024,
        date: "2024-06-15",
        docket: "22-1234",
        case_name: "Roe v. Wade",
        justice: "Roberts",
        citation: "600 U.S. 1",
        pdf_url: "https://example.com/1.pdf",
        text: "Opinion text for Roe v. Wade.",
    },
    {
        opinion_number: 2,
        opinion_type: "merits" as const,
        term_year: 2023,
        date: "2024-05-01",
        docket: "22-5678",
        case_name: "Marbury v. Madison",
        justice: "Thomas",
        citation: "600 U.S. 50",
        pdf_url: "https://example.com/2.pdf",
        text: "Opinion text for Marbury v. Madison.",
    },
];

const ORDERS_OPINIONS = [
    {
        opinion_number: null,
        opinion_type: "orders" as const,
        term_year: 2022,
        date: "2023-10-03",
        docket: "21-9999",
        case_name: "Smith v. Jones",
        justice: "Kagan",
        citation: "",
        pdf_url: "https://example.com/3.pdf",
        text: "Order text for Smith v. Jones.",
    },
];

const SEED_OPINIONS = [...MERITS_OPINIONS, ...ORDERS_OPINIONS];

let db: Kysely<AppDatabase>;

// Set up the database with seed opinions before each test
beforeEach(async () => {
    db = openDb(":memory:");
    await db.insertInto("opinions").values(SEED_OPINIONS).execute();
});

// Clean up the database after each test
afterEach(async () => {
    await db.destroy();
});

describe("queryOpinions", () => {
    it("returns all opinions when no filter is applied", async () => {
        const rows = await queryOpinions(db);
        expect(rows).toHaveLength(SEED_OPINIONS.length);
    });

    it("orders results by date descending", async () => {
        const rows = await queryOpinions(db);
        const dates = rows.map((r: OpinionTextRow) => r.date);
        expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
    });

    it("filters by opinionType", async () => {
        const opinionType = "orders";
        const rows = await queryOpinions(db, { opinionType });
        expect(rows).toHaveLength(ORDERS_OPINIONS.length);
    });

    it("filters by termYear", async () => {
        const termYear = 2023;
        const rows = await queryOpinions(db, { termYear });
        expect(rows).toHaveLength(SEED_OPINIONS.filter((r) => r.term_year === termYear).length);
    });

    it("filters by docket", async () => {
        const docket = "22-1234";
        const rows = await queryOpinions(db, { docket });
        expect(rows).toHaveLength(SEED_OPINIONS.filter((r) => r.docket === docket).length);
    });

    it("combines opinionType and termYear filters", async () => {
        const opinionType = "merits";
        const termYear = 2024;
        const rows = await queryOpinions(db, {
            opinionType,
            termYear,
        });
        expect(rows).toHaveLength(
            SEED_OPINIONS.filter((r) => r.opinion_type === opinionType && r.term_year === termYear)
                .length,
        );
    });

    it("returns empty array when no opinions match the filter", async () => {
        const rows = await queryOpinions(db, { termYear: 1990 });
        expect(rows).toEqual([]);
    });
});
