import { UnauthorizedException } from "@nestjs/common";
import { InternalAuthGuard } from "../../common/guards/internal-auth.guard";
import { FiscalKnowledgeController } from "./fiscal-knowledge.controller";
import { FiscalKnowledgeService } from "./fiscal-knowledge.service";
import {
  FiscalKnowledgeSearchQueryDto,
  FiscalKnowledgeSearchResponseDto,
} from "./fiscal-knowledge.dto";
import type { RankedFiscalHit } from "./fiscal-search-rerank";

// Evita cargar FiscalKnowledgeService real (que importa alias @/ no
// resueltos por jest). El controller se prueba con un fake inyectado.
jest.mock("./fiscal-knowledge.service", () => ({
  FiscalKnowledgeService: class {},
}));
// OrganizationGuard tira de PrismaService → tenant-isolation.extension que
// usa alias @/ no resueltos por jest. El controller sólo lo referencia en
// @UseGuards (metadata), no invoca su lógica en estos tests unitarios.
jest.mock("../../common/guards/organization.guard", () => ({
  OrganizationGuard: class {},
}));

function buildHit(over: Partial<RankedFiscalHit> = {}): RankedFiscalHit {
  return {
    ley: "LIR",
    leyLabel: "Ley de Impuesto sobre la Renta",
    articulo: 7,
    chunkIndex: 0,
    titulo: "Art. 7",
    content: "Contenido del artículo 7...",
    metadata: { source: "internal" },
    similarity: 0.81,
    rerankScore: 0.97,
    ...over,
  } as RankedFiscalHit;
}

describe("FiscalKnowledgeController", () => {
  it("mapea el resultado del servicio al DTO estable {hits, confident}", async () => {
    const hits = [buildHit(), buildHit({ articulo: 12, rerankScore: 0.6 })];
    const searchSemantic = jest.fn().mockResolvedValue({
      hits,
      parsed: {
        originalQuery: "q",
        embeddingQuery: "q",
        ley: null,
        articulo: null,
      },
      confident: true,
    });
    const service = { searchSemantic } as unknown as FiscalKnowledgeService;
    const controller = new FiscalKnowledgeController(service);

    const query: FiscalKnowledgeSearchQueryDto = {
      q: "retención IVA",
      limit: 5,
    };
    const result = await controller.search(query);

    expect(searchSemantic).toHaveBeenCalledTimes(1);
    expect(searchSemantic).toHaveBeenCalledWith("retención IVA", { limit: 5 });
    const expected: FiscalKnowledgeSearchResponseDto = {
      hits: [
        {
          ley: "LIR",
          leyLabel: "Ley de Impuesto sobre la Renta",
          articulo: 7,
          titulo: "Art. 7",
          content: "Contenido del artículo 7...",
          similarity: 0.81,
          rerankScore: 0.97,
        },
        {
          ley: "LIR",
          leyLabel: "Ley de Impuesto sobre la Renta",
          articulo: 12,
          titulo: "Art. 7",
          content: "Contenido del artículo 7...",
          similarity: 0.81,
          rerankScore: 0.6,
        },
      ],
      confident: true,
    };
    expect(result).toEqual(expected);
  });

  it("no expone chunkIndex ni metadata en la respuesta", async () => {
    const hits = [buildHit({ chunkIndex: 42, metadata: { secret: "x" } })];
    const searchSemantic = jest.fn().mockResolvedValue({
      hits,
      parsed: {
        originalQuery: "q",
        embeddingQuery: "q",
        ley: null,
        articulo: null,
      },
      confident: false,
    });
    const service = { searchSemantic } as unknown as FiscalKnowledgeService;
    const controller = new FiscalKnowledgeController(service);

    const result = await controller.search({ q: "x" });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("chunkIndex");
    expect(serialized).not.toContain("chunk_index");
    expect(serialized).not.toContain("metadata");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("parsed");
    expect(result.confident).toBe(false);
  });

  it("propaga confident=false cuando el servicio no está seguro", async () => {
    const searchSemantic = jest.fn().mockResolvedValue({
      hits: [],
      parsed: {
        originalQuery: "x",
        embeddingQuery: "x",
        ley: null,
        articulo: null,
      },
      confident: false,
    });
    const service = { searchSemantic } as unknown as FiscalKnowledgeService;
    const controller = new FiscalKnowledgeController(service);

    const result = await controller.search({ q: "x" });
    expect(result.confident).toBe(false);
    expect(result.hits).toEqual([]);
  });

  it("pasa limit undefined al servicio cuando no se indica", async () => {
    const searchSemantic = jest.fn().mockResolvedValue({
      hits: [],
      parsed: {
        originalQuery: "q",
        embeddingQuery: "q",
        ley: null,
        articulo: null,
      },
      confident: false,
    });
    const service = { searchSemantic } as unknown as FiscalKnowledgeService;
    const controller = new FiscalKnowledgeController(service);

    await controller.search({ q: "x" });
    expect(searchSemantic).toHaveBeenCalledWith("x", { limit: undefined });
  });

  it("el guard InternalAuthGuard rechaza 401 si falta el secret", () => {
    const guard = new InternalAuthGuard();
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as never;
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("el guard InternalAuthGuard deja pasar con secret válido + org_id", () => {
    process.env.AGENT_SECRET = "test-agent-secret";
    try {
      const guard = new InternalAuthGuard();
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              "x-internal-secret": "test-agent-secret",
              "x-organization-id": "1",
              "x-user-id": "5",
            },
          }),
        }),
      } as never;
      expect(guard.canActivate(ctx)).toBe(true);
    } finally {
      delete process.env.AGENT_SECRET;
    }
  });
});
