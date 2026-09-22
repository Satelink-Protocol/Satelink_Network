// Phase 4 gate: CRUD + publish + rollback + truth-hook enforcement.
// Runs against a real Postgres (satelink_cms_dev) after the isolated install:
//   cd apps/cms && npm install && DATABASE_URI=... npx vitest run test
// Not part of the shared workspace vitest projects (apps/cms is isolated).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPayload, type Payload } from "payload";
import config from "../src/payload.config";

let payload: Payload;

beforeAll(async () => {
  payload = await getPayload({ config });
});

afterAll(async () => {
  // Payload's Postgres pool closes with the process.
});

describe("CMS lifecycle", () => {
  it("CRUD: create → read → update → delete a Page", async () => {
    const created = await payload.create({
      collection: "pages",
      data: { title: "Test Page", slug: "test-page", site: "satelink", status: "draft" },
    });
    expect(created.id).toBeTruthy();

    const read = await payload.findByID({ collection: "pages", id: created.id });
    expect(read.title).toBe("Test Page");

    const updated = await payload.update({ collection: "pages", id: created.id, data: { title: "Renamed" } });
    expect(updated.title).toBe("Renamed");

    await payload.delete({ collection: "pages", id: created.id });
  });

  it("publish: draft → published stamps publishedAt and creates a version", async () => {
    const doc = await payload.create({ collection: "pages", data: { title: "Pub", slug: "pub", site: "satelink", status: "draft" } });
    const published = await payload.update({ collection: "pages", id: doc.id, data: { status: "published" } });
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeTruthy();
    const versions = await payload.findVersions({ collection: "pages", where: { parent: { equals: doc.id } } });
    expect(versions.docs.length).toBeGreaterThan(0);
    await payload.delete({ collection: "pages", id: doc.id });
  });

  it("rollback: restore a prior version", async () => {
    const doc = await payload.create({ collection: "pages", data: { title: "V1", slug: "roll", site: "satelink", status: "draft" } });
    await payload.update({ collection: "pages", id: doc.id, data: { title: "V2" } });
    const versions = await payload.findVersions({ collection: "pages", where: { parent: { equals: doc.id } }, sort: "-createdAt" });
    const v1 = versions.docs.find((v) => v.version?.title === "V1");
    expect(v1).toBeTruthy();
    const restored = await payload.restoreVersion({ collection: "pages", id: v1!.id });
    expect(restored.title).toBe("V1");
    await payload.delete({ collection: "pages", id: doc.id });
  });

  it("truth hook: blocks a banned phrase", async () => {
    await expect(
      payload.create({ collection: "pages", data: { title: "guaranteed returns", slug: "bad", site: "satelink", status: "draft" } })
    ).rejects.toThrow();
  });

  it("truth hook: blocks Dodo mention outside trading-intelligence", async () => {
    await expect(
      payload.create({ collection: "pages", data: { title: "Pay with Dodo here", slug: "dodo-bad", site: "satelink", status: "draft" } })
    ).rejects.toThrow();
  });
});
