import { WEAVIATE_COLLECTION_NAME } from "../src/constants";
import {
  formatWeaviateInspection,
  inspectWeaviateClient,
  type InspectWeaviateClient,
} from "../src/langsmith/inspectWeaviate";

function makeMockClient(
  overrides: Partial<InspectWeaviateClient> = {},
): InspectWeaviateClient {
  const defaultCollection = {
    length: jest.fn().mockResolvedValue(0),
    query: {
      fetchObjects: jest.fn().mockResolvedValue({ objects: [] }),
    },
  };

  return {
    isLive: jest.fn().mockResolvedValue(true),
    isReady: jest.fn().mockResolvedValue(true),
    getWeaviateVersion: jest.fn().mockResolvedValue({ show: () => "1.27.0" }),
    collections: {
      listAll: jest.fn().mockResolvedValue([]),
      exists: jest.fn().mockResolvedValue(false),
      get: jest.fn().mockReturnValue(defaultCollection),
    },
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("inspectWeaviateClient", () => {
  it("reports health, sorted collections, and skips count when the opinion collection is missing", async () => {
    const client = makeMockClient({
      collections: {
        listAll: jest
          .fn()
          .mockResolvedValue([
            { name: "SupremeCourtOpinions" },
            { name: "Other" },
          ]),
        exists: jest.fn().mockResolvedValue(false),
        get: jest.fn(),
      },
    });

    const result = await inspectWeaviateClient(client);

    expect(result).toEqual({
      isLive: true,
      isReady: true,
      version: "1.27.0",
      collections: ["Other", "SupremeCourtOpinions"],
      opinionCollection: { exists: false },
    });
    expect(client.collections.exists).toHaveBeenCalledWith(
      WEAVIATE_COLLECTION_NAME,
    );
    expect(client.collections.get).not.toHaveBeenCalled();
  });

  it("reports object count but no sample when the opinion collection is empty", async () => {
    const collection = {
      length: jest.fn().mockResolvedValue(0),
      query: {
        fetchObjects: jest.fn(),
      },
    };

    const client = makeMockClient({
      collections: {
        listAll: jest
          .fn()
          .mockResolvedValue([{ name: WEAVIATE_COLLECTION_NAME }]),
        exists: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockReturnValue(collection),
      },
    });

    const result = await inspectWeaviateClient(client);

    expect(result.opinionCollection).toEqual({
      exists: true,
      objectCount: 0,
    });
    expect(collection.query.fetchObjects).not.toHaveBeenCalled();
  });

  it("fetches one sample object when the opinion collection has rows", async () => {
    const sample = {
      uuid: "abc-123",
      properties: { docket: "23-719", chunkIndex: 0 },
    };
    const collection = {
      length: jest.fn().mockResolvedValue(42),
      query: {
        fetchObjects: jest.fn().mockResolvedValue({ objects: [sample] }),
      },
    };

    const client = makeMockClient({
      collections: {
        listAll: jest
          .fn()
          .mockResolvedValue([{ name: WEAVIATE_COLLECTION_NAME }]),
        exists: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockReturnValue(collection),
      },
    });

    const result = await inspectWeaviateClient(client);

    expect(result.opinionCollection).toEqual({
      exists: true,
      objectCount: 42,
      sample,
    });
    expect(collection.query.fetchObjects).toHaveBeenCalledWith({ limit: 1 });
  });

  it("leaves sample unset when fetchObjects returns no rows despite a positive count", async () => {
    const collection = {
      length: jest.fn().mockResolvedValue(3),
      query: {
        fetchObjects: jest.fn().mockResolvedValue({ objects: [] }),
      },
    };

    const client = makeMockClient({
      collections: {
        listAll: jest
          .fn()
          .mockResolvedValue([{ name: WEAVIATE_COLLECTION_NAME }]),
        exists: jest.fn().mockResolvedValue(true),
        get: jest.fn().mockReturnValue(collection),
      },
    });

    const result = await inspectWeaviateClient(client);

    expect(result.opinionCollection).toEqual({
      exists: true,
      objectCount: 3,
    });
  });
});

describe("formatWeaviateInspection", () => {
  it("prints health, collections, count, and sample as documented", () => {
    const output = formatWeaviateInspection({
      isLive: true,
      isReady: true,
      version: "1.27.0",
      collections: ["Other", WEAVIATE_COLLECTION_NAME],
      opinionCollection: {
        exists: true,
        objectCount: 2,
        sample: {
          uuid: "obj-1",
          properties: { docket: "23-719" },
        },
      },
    });

    expect(output).toContain("Weaviate:");
    expect(output).toContain("  isLive:  true");
    expect(output).toContain("  isReady: true");
    expect(output).toContain("  version: 1.27.0");
    expect(output).toContain(
      `Collections (2): Other, ${WEAVIATE_COLLECTION_NAME}`,
    );
    expect(output).toContain(`"${WEAVIATE_COLLECTION_NAME}" exists: true`);
    expect(output).toContain("  object count: 2");
    expect(output).toContain("Sample object:");
    expect(output).toContain("  uuid: obj-1");
    expect(output).toContain('  properties: {"docket":"23-719"}');
  });

  it("shows (none) and omits count/sample when the opinion collection is absent", () => {
    const output = formatWeaviateInspection({
      isLive: false,
      isReady: false,
      version: "unknown",
      collections: [],
      opinionCollection: { exists: false },
    });

    expect(output).toContain("Collections (0): (none)");
    expect(output).toContain(`"${WEAVIATE_COLLECTION_NAME}" exists: false`);
    expect(output).not.toContain("object count:");
    expect(output).not.toContain("Sample object:");
  });

  it("notes when no sample row is returned", () => {
    const output = formatWeaviateInspection({
      isLive: true,
      isReady: true,
      version: "1.27.0",
      collections: [WEAVIATE_COLLECTION_NAME],
      opinionCollection: {
        exists: true,
        objectCount: 5,
      },
    });

    expect(output).toContain("Sample object:");
    expect(output).toContain("  (no rows returned)");
  });
});
