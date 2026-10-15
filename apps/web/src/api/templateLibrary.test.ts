import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

describe("user template API", () => {
  it("uses revision guards for every mutation and includes deleted assets only on request", async () => {
    vi.stubGlobal("window", globalThis);
    try {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "user_saved" }), { status: 200 }));
      const client = new ApiClient("http://local.invalid", fetcher);
      await client.renameNodeTemplate("user_saved", "Renamed", "Description", 3);
      await client.deleteNodeTemplate("user_saved", 4);
      await client.restoreNodeTemplate("user_saved", 5);
      await client.listNodeTemplates(true);
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ name: "Renamed", description: "Description", expected_revision: 3 });
      expect(fetcher.mock.calls[0][1]?.method).toBe("PATCH");
      expect(fetcher.mock.calls[1][0]).toBe("http://local.invalid/api/node-templates/user_saved?expected_revision=4");
      expect(fetcher.mock.calls[1][1]?.method).toBe("DELETE");
      expect(fetcher.mock.calls[2][0]).toBe("http://local.invalid/api/node-templates/user_saved/restore?expected_revision=5");
      expect(fetcher.mock.calls[3][0]).toBe("http://local.invalid/api/node-templates?include_deleted=true");
    } finally { vi.unstubAllGlobals(); }
  });
  it("sends a JSON object using the shared request contract", async () => {
    vi.stubGlobal("window", globalThis);
    try {
      const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "user_saved" }), { status: 201 }));
      const client = new ApiClient("http://local.invalid", fetcher);
      const draft = { kind: "node" as const, name: "Mine", node: { id: "n", type: "manual.trigger", position: { x: 0, y: 0 }, config: {} } };
      expect(await client.createNodeTemplate(draft)).toEqual({ id: "user_saved" });
      const [url, request] = fetcher.mock.calls[0];
      expect(url).toBe("http://local.invalid/api/node-templates");
      expect(new Headers(request?.headers).get("Content-Type")).toBe("application/json");
      expect(JSON.parse(String(request?.body))).toEqual(draft);
    } finally { vi.unstubAllGlobals(); }
  });
});
