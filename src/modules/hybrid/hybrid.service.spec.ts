import {
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HybridService } from "./hybrid.service";
import { HybridHttpClient } from "./hybrid-http.client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { HYBRID_TIMEOUT_MAX_MS } from "./hybrid.config";

describe("HybridService gate order", () => {
  const originalEnv = { ...process.env };

  let prisma: { organization: { findUnique: jest.Mock } };
  let http: { get: jest.Mock };
  let service: HybridService;

  beforeEach(() => {
    prisma = {
      organization: {
        findUnique: jest.fn(),
      },
    };
    http = { get: jest.fn() };
    service = new HybridService(
      prisma as unknown as PrismaService,
      http as unknown as HybridHttpClient,
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function configureHybridEnv() {
    process.env.HYBRID_API_BASE_URL = "https://hybrid.example";
    process.env.HYBRID_API_TOKEN = "tok";
  }

  function clearHybridEnv() {
    delete process.env.HYBRID_API_BASE_URL;
    delete process.env.HYBRID_API_TOKEN;
  }

  it("1→2: org distinta a monddy → NotFound y no llama al client (aunque config exista)", async () => {
    configureHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "unknown-org" });

    await expect(service.getHealth(1)).rejects.toBeInstanceOf(NotFoundException);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("org no encontrada → NotFound y no llama al client", async () => {
    configureHybridEnv();
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.getHealth(99)).rejects.toBeInstanceOf(NotFoundException);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("2→3: monddy sin config → 503 y no llama al client", async () => {
    clearHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });

    await expect(service.getHealth(1)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http.get).not.toHaveBeenCalled();
  });

  it("orden: org inválida gana sobre config ausente (404 antes de 503)", async () => {
    clearHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "otra" });

    await expect(service.getHealth(1)).rejects.toBeInstanceOf(NotFoundException);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("3→4: monddy + config → llama GET y retorna body", async () => {
    configureHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });
    http.get.mockResolvedValue({ status: 200, body: { status: "ok" } });

    await expect(service.getHealth(7)).resolves.toEqual({ status: "ok" });
    expect(http.get).toHaveBeenCalledWith("/health", undefined);
  });

  it("pasa status/body Hybrid en errores upstream", async () => {
    configureHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });
    http.get.mockResolvedValue({
      status: 404,
      body: { detail: "no encontrado" },
    });

    try {
      await service.getInventarioByCodigo(7, "X1");
      fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(404);
      expect((e as HttpException).getResponse()).toEqual({
        detail: "no encontrado",
      });
    }
  });

  it("inventario aplica allowlist de query", async () => {
    configureHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });
    http.get.mockResolvedValue({ status: 200, body: [] });

    await service.getInventario(7, {
      q: "a",
      limit: "5",
      offset: "0",
      secret: "drop-me",
    });

    expect(http.get).toHaveBeenCalledWith("/inventario", {
      q: "a",
      limit: "5",
      offset: "0",
    });
  });

  it("catalogos y monedas proxifican sin query", async () => {
    configureHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });
    http.get.mockResolvedValue({ status: 200, body: { ok: true } });

    await service.getCatalogos(7);
    expect(http.get).toHaveBeenCalledWith("/catalogos", undefined);

    http.get.mockClear();
    await service.getCatalogoByGrupo(7, "tipos_venta");
    expect(http.get).toHaveBeenCalledWith("/catalogos/tipos_venta", undefined);

    http.get.mockClear();
    await service.getMonedas(7);
    expect(http.get).toHaveBeenCalledWith("/monedas", undefined);
  });

  it("gate order también en catalogos (404 antes de 503)", async () => {
    clearHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "otra" });

    await expect(service.getCatalogos(1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(http.get).not.toHaveBeenCalled();
  });

  it("ventas reenvía caja/serie; detalle usa timeout 180s", async () => {
    configureHybridEnv();
    prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });
    http.get.mockResolvedValue({ status: 200, body: { items: [] } });

    await service.getVentas(7, {
      caja: "CAJA01",
      serie: "FISCAL01",
      secret: "no",
    });
    expect(http.get).toHaveBeenCalledWith("/ventas", {
      caja: "CAJA01",
      serie: "FISCAL01",
    });

    http.get.mockClear();
    http.get.mockResolvedValue({ status: 200, body: { documento: "1" } });
    await service.getVentaByDocumento(7, "00010923", { limit: "10" });
    expect(http.get).toHaveBeenCalledWith(
      "/ventas/00010923",
      { limit: "10" },
      { timeoutMs: HYBRID_TIMEOUT_MAX_MS },
    );
  });

  describe("getConnectionStatus (SA diagnostic, solo Monddy)", () => {
    it("org distinta a monddy → NotFound y no llama http", async () => {
      configureHybridEnv();
      prisma.organization.findUnique.mockResolvedValue({ slug: "unknown-org" });

      await expect(service.getConnectionStatus(1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(http.get).not.toHaveBeenCalled();
    });

    it("rancho → NotFound y no llama http", async () => {
      configureHybridEnv();
      prisma.organization.findUnique.mockResolvedValue({
        slug: "unknown-org",
      });

      await expect(service.getConnectionStatus(2)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(http.get).not.toHaveBeenCalled();
    });

    it("monddy sin config: configured false y no llama http", async () => {
      clearHybridEnv();
      prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });
      const status = await service.getConnectionStatus(7);
      expect(status.configured).toBe(false);
      expect(status.reachable).toBe(false);
      expect(status.health).toBeNull();
      expect(status.latencyMs).toBeNull();
      expect(status.error).toMatch(/HYBRID_API_BASE_URL/);
      expect(http.get).not.toHaveBeenCalled();
      expect(status).not.toHaveProperty("token");
      expect(JSON.stringify(status)).not.toMatch(/Bearer\s/i);
    });

    it("monddy + config + health ok: reachable y host, sin token", async () => {
      process.env.HYBRID_API_BASE_URL = "https://db.marfyl.site";
      process.env.HYBRID_API_TOKEN = "tok-secret-value";
      prisma.organization.findUnique.mockResolvedValue({ slug: "monddy" });
      http.get.mockResolvedValue({
        status: 200,
        body: { ok: true, tablas: 128, solo_lectura: true },
      });

      const status = await service.getConnectionStatus(7);
      expect(status.configured).toBe(true);
      expect(status.reachable).toBe(true);
      expect(status.baseUrlHost).toBe("db.marfyl.site");
      expect(status.health).toEqual({
        ok: true,
        tablas: 128,
        solo_lectura: true,
      });
      expect(typeof status.latencyMs).toBe("number");
      expect(http.get).toHaveBeenCalledWith("/health");
      expect(status).not.toHaveProperty("token");
      expect(JSON.stringify(status)).not.toContain("tok-secret-value");
      expect(JSON.stringify(status)).not.toMatch(/Bearer\s/i);
    });
  });
});
