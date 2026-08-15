import {
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HybridService } from "./hybrid.service";
import { HybridHttpClient } from "./hybrid-http.client";
import { PrismaService } from "@/common/prisma/prisma.service";

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
    prisma.organization.findUnique.mockResolvedValue({ slug: "davean" });

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
});
