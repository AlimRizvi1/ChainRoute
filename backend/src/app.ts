import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Writable } from "node:stream";
import type { Pool } from "pg";
import { registerAuthentication } from "./auth/plugin.js";
import { registerOrderRoutes } from "./orders/routes.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { registerContractRoutes } from "./contracts/routes.js";
import { registerContractPush } from "./contracts/push.js";
import { startContractSync } from "./contracts/sync.js";
import { registerAiDemonstrations } from "./ai/routes.js";
import { registerPlatformRoutes } from "./platform/routes.js";
import { registerBlockchainExplorer } from "./platform/blockchain.js";

type DependencyState = "up" | "down";
type HealthResponse = {
  status: "ok" | "degraded";
  dependencies: {
    aiEngine: DependencyState;
    blockchain: DependencyState;
    database: DependencyState;
  };
};

export type PlatformAppOptions = {
  database: Pool;
  tokenSecret: string;
  aiEngineUrl?: string;
  chainRpcUrl?: string;
  contractPath?: string;
  dependencyTimeoutMs?: number;
  optimizationTimeoutMs?: number;
  logLevel?: string;
  logger?: boolean;
  loggerStream?: Writable;
};

export async function createPlatformApp(options: PlatformAppOptions) {
  const aiEngineUrl = options.aiEngineUrl ?? "http://ai-engine:8000";
  const chainRpcUrl = options.chainRpcUrl ?? "http://blockchain:8545";
  const contractPath = options.contractPath ?? "/shared/contract.json";
  const timeoutMs = options.dependencyTimeoutMs ?? 5000;
  const app = Fastify({
    logger: options.logger === false
      ? false
      : {
          level: options.logLevel ?? "info",
          redact: {
            paths: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.invitationToken"],
            censor: "[REDACTED]",
          },
          ...(options.loggerStream ? { stream: options.loggerStream } : {}),
        },
    genReqId: () => randomUUID(),
  });
  const database = options.database;

  database.on("error", (error) => {
    app.log.warn({ err: error }, "Idle database client failed");
  });

  await registerAuthentication(app, database, options.tokenSecret);
  app.setErrorHandler((error, request, reply) => {
    const requestError = error as Error & { statusCode?: number; validation?: Array<{ dataPath?: string; instancePath?: string; message?: string; params?: { missingProperty?: string } }> };
    const validation = requestError.validation;
    if (validation) {
      const fields: Record<string, string> = {};
      for (const item of validation) {
        const path = item.instancePath ?? item.dataPath ?? "";
        const field = `${path}${item.params?.missingProperty ? `.${item.params.missingProperty}` : ""}`.replace(/^\./, "");
        fields[field || "request"] = item.message ?? "Invalid value.";
      }
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Request fields are invalid.", fields } });
    }
    if (requestError.statusCode && requestError.statusCode < 500) {
      return reply.code(requestError.statusCode).send({ error: {
        code: requestError.statusCode === 429 ? "RATE_LIMITED" : "REQUEST_REJECTED",
        message: requestError.statusCode === 429 ? "Too many requests. Try again shortly." : "The request could not be accepted.",
      } });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } });
  });
  await registerOrderRoutes(
    app,
    database,
    aiEngineUrl,
    options.optimizationTimeoutMs ?? 60_000,
  );
  await registerDashboardRoutes(app, database);
  registerAiDemonstrations(app, aiEngineUrl);
  registerPlatformRoutes(app, database, chainRpcUrl);
  registerBlockchainExplorer(app, chainRpcUrl, contractPath);
  const contractPush = registerContractPush(app, database);
  await registerContractRoutes(app, database, chainRpcUrl, contractPath);
  startContractSync(app, database, chainRpcUrl, contractPath, contractPush);

  app.get(
    "/health",
    { config: { public: true } },
    async (_request, reply) => reply.code(200).send(await health()),
  );

  app.get(
    "/blockchain/contract",
    { config: { permission: "artifact.read" } },
    async (_request, reply) => {
      try {
        const content = await readFile(contractPath, "utf8");
        return reply.code(200).type("application/json").send(content);
      } catch (error) {
        app.log.error({ err: error }, "Unable to read deployed contract artifact");
        return reply.code(503).send({
          error: {
            code: "CONTRACT_ARTIFACT_UNAVAILABLE",
            message: "The deployed contract artifact is unavailable.",
          },
        });
      }
    },
  );

  app.addHook("onClose", async () => {
    await database.end();
  });

  async function checkHttp(url: string): Promise<boolean> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  }

  async function checkBlockchain(): Promise<boolean> {
    const response = await fetch(chainRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return (
      typeof result === "object" &&
      result !== null &&
      "result" in result &&
      typeof result.result === "string" &&
      /^0x[0-9a-f]+$/i.test(result.result)
    );
  }

  async function health(): Promise<HealthResponse> {
    const checks = await Promise.all([
      isReachable(() => checkHttp(`${aiEngineUrl}/health`)),
      isReachable(checkBlockchain),
      isReachable(async () => {
        const result = await database.query("SELECT 1 AS healthy");
        return result.rows[0]?.healthy === 1;
      }),
    ]);
    const dependencies = {
      aiEngine: checks[0] ? "up" : "down",
      blockchain: checks[1] ? "up" : "down",
      database: checks[2] ? "up" : "down",
    } satisfies HealthResponse["dependencies"];
    return {
      status: Object.values(dependencies).every((state) => state === "up")
        ? "ok"
        : "degraded",
      dependencies,
    };
  }

  return app;
}

async function isReachable(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}
