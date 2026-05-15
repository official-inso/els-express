import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { ELSClient, createELSExpressLogger, createELSErrorHandler } from "../src/index";

function mkResponse(status = 201) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null } as any,
    json: async () => ({ id: "mock" }),
    text: async () => "{}",
  };
}

describe("Express middleware", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let client: ELSClient;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(mkResponse());
    vi.stubGlobal("fetch", fetchMock);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    client = new ELSClient({
      endpoint: "https://example.test",
      apiKey: "test-key",
      appSlug: "test-app",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockRestore();
  });

  it("adds req.log and req.id, sets x-request-id header", async () => {
    const app = express();
    app.use(createELSExpressLogger({ client, autoLogRequests: false }));
    app.get("/", (req, res) => {
      res.json({ id: req.id, hasLog: typeof req.log?.info === "function" });
    });
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.hasLog).toBe(true);
    expect(res.body.id).toBeTruthy();
    expect(res.headers["x-request-id"]).toBe(res.body.id);
  });

  it("uses incoming x-request-id header if present", async () => {
    const app = express();
    app.use(createELSExpressLogger({ client, autoLogRequests: false }));
    app.get("/", (req, res) => res.json({ id: req.id }));
    const res = await request(app).get("/").set("x-request-id", "from-client-123");
    expect(res.body.id).toBe("from-client-123");
  });

  it("autoLogRequests sends log on finish", async () => {
    const app = express();
    app.use(createELSExpressLogger({ client, autoLogRequests: true }));
    app.get("/users/42", (_req, res) => res.json({ ok: true }));
    await request(app).get("/users/42");
    await new Promise((r) => setTimeout(r, 30));
    const calls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/errors"),
    );
    expect(calls.length).toBeGreaterThan(0);
    const body = JSON.parse((calls[0][1] as any).body);
    expect(body.level).toBe("info");
    expect(body.requestId).toBeTruthy();
    expect(body.message).toContain("GET");
    expect(body.message).toContain("200");
  });

  it("error handler catches throws and sends to client", async () => {
    const app = express();
    app.use(createELSExpressLogger({ client, autoLogRequests: false }));
    app.get("/bad", (_req, _res) => {
      throw new Error("kaboom");
    });
    app.use(createELSErrorHandler(client));
    const res = await request(app).get("/bad");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal Server Error");
    await new Promise((r) => setTimeout(r, 30));
    const calls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).endsWith("/errors"),
    );
    const errorCall = calls.find((c) => {
      const body = JSON.parse((c[1] as any).body);
      return body.level === "error";
    });
    expect(errorCall).toBeDefined();
  });

  it("ignorePaths skips middleware", async () => {
    const app = express();
    app.use(
      createELSExpressLogger({
        client,
        autoLogRequests: true,
        ignorePaths: ["/health"],
      }),
    );
    app.get("/health", (req, res) => {
      res.json({ hasLog: typeof req.log === "object" });
    });
    const res = await request(app).get("/health");
    expect(res.body.hasLog).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
