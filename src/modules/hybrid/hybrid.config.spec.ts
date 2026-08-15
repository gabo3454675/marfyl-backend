import {
  getHybridApiTimeoutMs,
  getHybridAuthMode,
  isConfigured,
  HYBRID_TIMEOUT_DEFAULT_MS,
  HYBRID_TIMEOUT_MAX_MS,
  HYBRID_TIMEOUT_MIN_MS,
} from "./hybrid.config";

describe("hybrid.config", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  describe("isConfigured", () => {
    it("false si falta BASE_URL o TOKEN", () => {
      process.env.HYBRID_API_BASE_URL = "";
      process.env.HYBRID_API_TOKEN = "tok";
      expect(isConfigured()).toBe(false);

      process.env.HYBRID_API_BASE_URL = "https://hybrid.example";
      process.env.HYBRID_API_TOKEN = "";
      expect(isConfigured()).toBe(false);

      delete process.env.HYBRID_API_BASE_URL;
      delete process.env.HYBRID_API_TOKEN;
      expect(isConfigured()).toBe(false);
    });

    it("true solo con ambos definidos", () => {
      process.env.HYBRID_API_BASE_URL = "https://hybrid.example";
      process.env.HYBRID_API_TOKEN = "secret-token";
      expect(isConfigured()).toBe(true);
    });
  });

  describe("getHybridApiTimeoutMs", () => {
    it("default 120000", () => {
      delete process.env.HYBRID_API_TIMEOUT_MS;
      expect(getHybridApiTimeoutMs()).toBe(HYBRID_TIMEOUT_DEFAULT_MS);
    });

    it("clampa por debajo de 60000", () => {
      process.env.HYBRID_API_TIMEOUT_MS = "1000";
      expect(getHybridApiTimeoutMs()).toBe(HYBRID_TIMEOUT_MIN_MS);
    });

    it("clampa por encima de 180000", () => {
      process.env.HYBRID_API_TIMEOUT_MS = "999999";
      expect(getHybridApiTimeoutMs()).toBe(HYBRID_TIMEOUT_MAX_MS);
    });

    it("acepta valor dentro del rango", () => {
      process.env.HYBRID_API_TIMEOUT_MS = "90000";
      expect(getHybridApiTimeoutMs()).toBe(90_000);
    });
  });

  describe("getHybridAuthMode", () => {
    it("bearer por defecto", () => {
      delete process.env.HYBRID_AUTH_HEADER;
      expect(getHybridAuthMode()).toBe("bearer");
    });

    it("x-api-key cuando corresponde", () => {
      process.env.HYBRID_AUTH_HEADER = "x-api-key";
      expect(getHybridAuthMode()).toBe("x-api-key");
      process.env.HYBRID_AUTH_HEADER = "apikey";
      expect(getHybridAuthMode()).toBe("x-api-key");
    });
  });
});
