import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("dodo environment resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves test_mode when set", async () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "test_mode";
    const { getDodoEnvironment } = await import("./environment");
    expect(getDodoEnvironment()).toBe("test_mode");
  });

  it("resolves live_mode when explicitly set", async () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "live_mode";
    const { getDodoEnvironment } = await import("./environment");
    expect(getDodoEnvironment()).toBe("live_mode");
  });

  it("throws in production when unset — never silently defaults to the SDK's live_mode default", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.DODO_PAYMENTS_ENVIRONMENT;
    const { getDodoEnvironment } = await import("./environment");
    expect(() => getDodoEnvironment()).toThrow(/DODO_PAYMENTS_ENVIRONMENT/);
  });

  it("throws in production for a garbage value", async () => {
    process.env.NODE_ENV = "production";
    process.env.DODO_PAYMENTS_ENVIRONMENT = "prod";
    const { getDodoEnvironment } = await import("./environment");
    expect(() => getDodoEnvironment()).toThrow();
  });

  it("defaults to test_mode (never live) outside production when unset", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DODO_PAYMENTS_ENVIRONMENT;
    const { getDodoEnvironment } = await import("./environment");
    expect(getDodoEnvironment()).toBe("test_mode");
  });

  it("getDodoClientConfig throws when DODO_PAYMENTS_API_KEY is unset", async () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "test_mode";
    delete process.env.DODO_PAYMENTS_API_KEY;
    const { getDodoClientConfig } = await import("./environment");
    expect(() => getDodoClientConfig()).toThrow(/DODO_PAYMENTS_API_KEY/);
  });

  it("getDodoClientConfig returns bearerToken + environment when both set", async () => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "test_mode";
    process.env.DODO_PAYMENTS_API_KEY = "key_abc";
    const { getDodoClientConfig } = await import("./environment");
    expect(getDodoClientConfig()).toEqual({ bearerToken: "key_abc", environment: "test_mode" });
  });
});
