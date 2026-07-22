import { ConfigService } from "@nestjs/config";
import { ServiceUnavailableException } from "@nestjs/common";
import { AgentProxyService } from "./agent-proxy.service";

function mockConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

describe("AgentProxyService", () => {
  const context = {
    organizationId: 7,
    userId: 3,
    orgName: "Acme",
    userRole: "ADMIN",
    authorization: "Bearer test-jwt",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("isEnabled / isFallbackEnabled", () => {
    it("habilita proxy solo con true|1", () => {
      expect(
        new AgentProxyService(mockConfig({ USE_PYTHON_AGENT: "true" })).isEnabled(),
      ).toBe(true);
      expect(
        new AgentProxyService(mockConfig({ USE_PYTHON_AGENT: "1" })).isEnabled(),
      ).toBe(true);
      expect(
        new AgentProxyService(mockConfig({ USE_PYTHON_AGENT: "false" })).isEnabled(),
      ).toBe(false);
      expect(new AgentProxyService(mockConfig({})).isEnabled()).toBe(false);
    });

    it("habilita fallback solo con true|1", () => {
      expect(
        new AgentProxyService(
          mockConfig({ PYTHON_AGENT_FALLBACK: "true" }),
        ).isFallbackEnabled(),
      ).toBe(true);
      expect(
        new AgentProxyService(
          mockConfig({ PYTHON_AGENT_FALLBACK: "false" }),
        ).isFallbackEnabled(),
      ).toBe(false);
    });
  });

  describe("parseSseDataLine", () => {
    const proxy = new AgentProxyService(mockConfig({}));

    it("parsea delta / tool_round / done / error", () => {
      expect(proxy.parseSseDataLine('data: {"type":"delta","text":"hola"}')).toEqual({
        type: "delta",
        text: "hola",
      });
      expect(proxy.parseSseDataLine('data: {"type":"tool_round"}')).toEqual({
        type: "tool_round",
      });
      expect(
        proxy.parseSseDataLine('data: {"type":"done","reply":"ok","model":"m"}'),
      ).toEqual({ type: "done", reply: "ok", model: "m" });
      expect(
        proxy.parseSseDataLine('data: {"type":"error","message":"boom"}'),
      ).toEqual({ type: "error", message: "boom" });
    });

    it("ignora frames sin data o JSON inválido", () => {
      expect(proxy.parseSseDataLine("event: ping")).toBeNull();
      expect(proxy.parseSseDataLine("data: not-json")).toBeNull();
    });
  });

  describe("chat", () => {
    it("rechaza organizationId inválido (no hardcodea 0)", async () => {
      const proxy = new AgentProxyService(
        mockConfig({
          USE_PYTHON_AGENT: "true",
          AGENT_SECRET: "sec",
          PYTHON_AGENT_URL: "http://localhost:8000",
        }),
      );
      await expect(
        proxy.chat(
          { message: "hola" },
          { organizationId: 0, userId: 1 },
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it("POST /chat con headers y body alineados al FastAPI", async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reply: "respuesta",
          model: "test-model",
          tools_used: [],
          thread_id: "t1",
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const proxy = new AgentProxyService(
        mockConfig({
          AGENT_SECRET: "super-secret",
          PYTHON_AGENT_URL: "http://localhost:8000/",
        }),
      );

      const result = await proxy.chat(
        {
          message: "¿ventas?",
          history: [{ role: "user", content: "prev" }],
          context: "dashboard",
        },
        context,
      );

      expect(result).toEqual({ reply: "respuesta", model: "test-model" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:8000/chat");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Internal-Secret"]).toBe("super-secret");
      expect(headers["X-Organization-Id"]).toBe("7");
      expect(headers["X-User-Id"]).toBe("3");
      expect(headers.Authorization).toBe("Bearer test-jwt");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.message).toBe("[Contexto: dashboard]\n¿ventas?");
      expect(body.organization_id).toBe(7);
      expect(body.user_id).toBe(3);
      expect(body.org_name).toBe("Acme");
      expect(body.user_role).toBe("ADMIN");
      expect(body.history).toEqual([{ role: "user", content: "prev" }]);
    });

    it("error HTTP claro sin silent success", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        text: async () => "down",
      }) as unknown as typeof fetch;

      const proxy = new AgentProxyService(
        mockConfig({ AGENT_SECRET: "sec", PYTHON_AGENT_URL: "http://localhost:8000" }),
      );

      await expect(
        proxy.chat({ message: "hola" }, context),
      ).rejects.toThrow(/Agent Python no disponible/);
    });
  });

  describe("chatStream", () => {
    it("parsea SSE y yields eventos tipados", async () => {
      const sse =
        'data: {"type":"delta","text":"Hola"}\n\n' +
        'data: {"type":"done","reply":"Hola","model":"py"}\n\n';
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sse));
          controller.close();
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: stream,
      }) as unknown as typeof fetch;

      const proxy = new AgentProxyService(
        mockConfig({
          AGENT_SECRET: "sec",
          PYTHON_AGENT_URL: "http://localhost:8000",
        }),
      );

      const events = [];
      for await (const ev of proxy.chatStream({ message: "hola" }, context)) {
        events.push(ev);
      }

      expect(events).toEqual([
        { type: "delta", text: "Hola" },
        { type: "done", reply: "Hola", model: "py" },
      ]);
      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toBe("http://localhost:8000/chat/stream");
    });
  });
});
