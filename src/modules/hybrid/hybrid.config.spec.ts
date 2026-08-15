import {
  getHybridApiBaseUrlHost,
  getHybridApiTimeoutMs,
  getHybridAuthMode,
  getHybridDetailTimeoutMs,
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
    it("default 60000 (listados/catálogos)", () => {
      delete process.env.HYBRID_API_TIMEOUT_MS;
      expect(getHybridApiTimeoutMs()).toBe(HYBRID_TIMEOUT_DEFAULT_MS);
      expect(HYBRID_TIMEOUT_DEFAULT_MS).toBe(60_000);
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

  describe("getHybridDetailTimeoutMs", () => {
    it("siempre 180000 para detalle de ventas", () => {
      process.env.HYBRID_API_TIMEOUT_MS = "60000";
      expect(getHybridDetailTimeoutMs()).toBe(HYBRID_TIMEOUT_MAX_MS);
      expect(getHybridDetailTimeoutMs()).toBe(180_000);
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

  describe("getHybridApiBaseUrlHost", () => {
    it("devuelve hostname sin path", () => {
      process.env.HYBRID_API_BASE_URL = "https://db.marfyl.site/v1";
      expect(getHybridApiBaseUrlHost()).toBe("db.marfyl.site");
    });

    it("null si vacío o inválido", () => {
      delete process.env.HYBRID_API_BASE_URL;
      expect(getHybridApiBaseUrlHost()).toBeNull();
      process.env.HYBRID_API_BASE_URL = "not-a-url";
      expect(getHybridApiBaseUrlHost()).toBeNull();
    });
  });
});
