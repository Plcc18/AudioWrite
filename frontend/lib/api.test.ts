import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
    },
  }),
}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
});

describe("lib/api", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listProjects envia Authorization: Bearer <token> e GET /projects", async () => {
    const { listProjects } = await import("./api");
    const projects = [{ id: "1", filename: "a.mp3", status: "done", final_text: "x", error: null, created_at: "now" }];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => projects,
    });

    const result = await listProjects();

    expect(result).toEqual(projects);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.example.com/projects");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("lança ApiError com o status e a mensagem do campo detail quando a API retorna erro", async () => {
    const { listProjects, ApiError } = await import("./api");
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ detail: "Project not found" }),
    });

    await expect(listProjects()).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Project not found",
    });
    await expect(listProjects()).rejects.toBeInstanceOf(ApiError);
  });

  it("resolveSegment envia PATCH com o body correto", async () => {
    const { resolveSegment } = await import("./api");
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "seg-1", status: "resolved" }),
    });

    await resolveSegment("proj-1", "seg-1", { action: "accept_alternative", alternative_index: 0 });

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.example.com/projects/proj-1/segments/seg-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ action: "accept_alternative", alternative_index: 0 });
  });

  it("propaga falha de rede como ApiError de status 0", async () => {
    const { listProjects } = await import("./api");
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    await expect(listProjects()).rejects.toMatchObject({ status: 0 });
  });
});
