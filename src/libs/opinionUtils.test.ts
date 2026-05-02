import { buildFilename, type OpinionMetaData } from "./opinionUtils";

const BASE: OpinionMetaData = {
    opinionType: "merits",
    termYear: 23,
    date: "2024-06-15",
    docket: "22-1234",
    caseName: "Foo v. Bar",
    justice: "Roberts",
    citation: "600 U.S. 1",
    pdfUrl: "https://example.com/opinion.pdf",
};

describe("buildFilename", () => {
    describe("merits opinions (have opinionNumber)", () => {
        it("zero-pads single-digit opinion numbers to 4 digits", () => {
            expect(buildFilename({ ...BASE, opinionNumber: 1 })).toBe("0001-22-1234.json");
        });

        it("zero-pads two-digit opinion numbers to 4 digits", () => {
            expect(buildFilename({ ...BASE, opinionNumber: 42 })).toBe("0042-22-1234.json");
        });

        it("does not pad opinion numbers that are already 4 digits", () => {
            expect(buildFilename({ ...BASE, opinionNumber: 1234 })).toBe("1234-22-1234.json");
        });
    });

    describe("orders opinions (no opinionNumber)", () => {
        const orders: OpinionMetaData = {
            ...BASE,
            opinionType: "orders",
            opinionNumber: undefined,
        };

        it("omits the numeric prefix entirely", () => {
            expect(buildFilename(orders)).toBe("22-1234.json");
        });
    });

    describe("docket sanitization", () => {
        it("replaces forward slashes with hyphens", () => {
            expect(buildFilename({ ...BASE, opinionType: "orders", docket: "24A123/456" })).toBe(
                "24A123-456.json",
            );
        });

        it("replaces multiple slashes", () => {
            expect(buildFilename({ ...BASE, opinionType: "orders", docket: "a/b/c" })).toBe(
                "a-b-c.json",
            );
        });

        it("leaves dockets without slashes unchanged", () => {
            expect(buildFilename({ ...BASE, opinionType: "orders", docket: "24A123" })).toBe(
                "24A123.json",
            );
        });
    });
});
