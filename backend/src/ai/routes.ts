import type { FastifyInstance } from "fastify";

export function registerAiDemonstrations(app: FastifyInstance, aiEngineUrl: string): void {
  async function upstream(path: string, method: string, body?: unknown) {
    const response = await fetch(`${aiEngineUrl.replace(/\/$/, "")}${path}`, {
      method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("AI demonstration is unavailable");
    return response.json();
  }
  app.get("/ai/demonstrations/evaluation", { config: { permission: "artifact.read" } }, async (_request, reply) => {
    try { return await upstream("/demo/evidence.json", "GET"); }
    catch { return reply.code(503).send({ error: { code: "AI_UNAVAILABLE", message: "The ML evaluation is unavailable. Check the AI service and retry." } }); }
  });
  app.post("/ai/demonstrations/run", {
    config: { permission: "artifact.read", auditAction: "ai.demonstration", auditResourceType: "synthetic_run" },
    schema: { body: { type: "object", additionalProperties: false, required: ["kind"], properties: {
      kind: { type: "string", enum: ["cp-sat", "ml"] },
      cargo: { type: "string", enum: ["grain", "coal", "steel"] },
      slackRatio: { type: "number", enum: [0, 0.25, 0.5] },
    } } },
  }, async (request, reply) => {
    try { return await upstream("/v1/demonstrations", "POST", request.body); }
    catch { return reply.code(503).send({ error: { code: "AI_UNAVAILABLE", message: "The live demonstration could not run. Check the AI service and retry." } }); }
  });
}
