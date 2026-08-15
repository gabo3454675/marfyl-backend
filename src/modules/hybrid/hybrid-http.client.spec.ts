import {
  BadGatewayException,
  GatewayTimeoutException,
} from "@nestjs/common";
import { HybridHttpClient } from "./hybrid-http.client";

describe("HybridHttpClient", () => {
  const originalEnv = { ...process.env };
  let client: HybridHttpClient;

  beforeEach(() => {
    process.env.HYBRID_API_BASE_URL = "https://hybrid.example/";
    process.env.HYBRID_API_TOKEN = "tok-secret-value";
    process.env.HYBRID_API_TIMEOUT_MS = "60000";
    process.env.HYBRID_AUTH_HEADER = "bearer";
    client = new HybridHttpClient();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("solo usa method GET con Bearer y query allowlisted", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await client.get("/inventario", {
      q: "aceite",
      limit: "20",
    });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://hybrid.example/inventario");
    expect(url).toContain("q=aceite");
    expect(url).toContain("limit=20");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-secret-value");
    expect(headers).not.toHaveProperty("Cookie");
  });

  it("usa X-API-Key cuando HYBRID_AUTH_HEADER=x-api-key", async () => {
    process.env.HYBRID_AUTH_HEADER = "x-api-key";
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      text: async () => "{}",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await client.get("/health");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("tok-secret-value");
    expect(headers.Authorization).toBeUndefined();
  });

  it("mapea AbortError a 504 sin filtrar el token", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    global.fetch = jest.fn().mockRejectedValue(abortErr) as unknown as typeof fetch;

    await expect(client.get("/health")).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );

    try {
      await client.get("/health");
    } catch (e) {
      const msg = String(e);
      expect(msg).not.toContain("tok-secret-value");
    }
  });

  it("mapea errores de red a 502 sin filtrar el token", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED tok-secret-value")) as unknown as typeof fetch;

    try {
      await client.get("/health");
      fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BadGatewayException);
      const response = (e as BadGatewayException).getResponse();
      const text = typeof response === "string" ? response : JSON.stringify(response);
      expect(text).not.toContain("tok-secret-value");
    }
  });

  it("no expone método distinto de GET en la API pública", () => {
    expect(typeof client.get).toBe("function");
    expect((client as unknown as Record<string, unknown>).post).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).put).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).patch).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).delete).toBeUndefined();
  });
});
