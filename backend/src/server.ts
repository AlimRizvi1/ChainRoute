import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

type DependencyState = "up" | "down";
type HealthResponse = {
  status: "ok" | "degraded";
  dependencies: {
    aiEngine: DependencyState;
    blockchain: DependencyState;
    database: DependencyState;
  };
};

const port = Number(process.env.PORT ?? "8080");
const aiEngineUrl = process.env.AI_ENGINE_URL ?? "http://ai-engine:8000";
const chainRpcUrl = process.env.CHAIN_RPC_URL ?? "http://blockchain:8545";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://chainroute:chainroute@database:5432/chainroute";
const contractPath = process.env.CONTRACT_FILE ?? "/shared/contract.json";
const dependencyTimeoutMs = Number(
  process.env.DEPENDENCY_TIMEOUT_MS ?? "5000",
);

const database = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: dependencyTimeoutMs,
  statement_timeout: dependencyTimeoutMs,
  max: 2,
});
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

database.on("error", (error) => {
  app.log.warn({ err: error }, "Idle database client failed");
});

async function isReachable(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch (error) {
    app.log.debug({ err: error }, "Dependency health check failed");
    return false;
  }
}

async function checkHttp(url: string): Promise<boolean> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(dependencyTimeoutMs),
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
    signal: AbortSignal.timeout(dependencyTimeoutMs),
  });
  if (!response.ok) {
    return false;
  }
  const result: unknown = await response.json();
  return (
    typeof result === "object" &&
    result !== null &&
    "result" in result &&
    typeof result.result === "string" &&
    /^0x[0-9a-f]+$/i.test(result.result)
  );
}

async function checkDatabase(): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      database.query("SELECT 1 AS healthy"),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database health check timed out")),
          dependencyTimeoutMs,
        );
      }),
    ]);
    return result.rows[0]?.healthy === 1;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function health(): Promise<HealthResponse> {
  const [aiEngine, blockchain, databaseStatus] = await Promise.all([
    isReachable(() => checkHttp(`${aiEngineUrl}/health`)),
    isReachable(checkBlockchain),
    isReachable(checkDatabase),
  ]);

  const dependencies = {
    aiEngine: aiEngine ? "up" : "down",
    blockchain: blockchain ? "up" : "down",
    database: databaseStatus ? "up" : "down",
  } satisfies HealthResponse["dependencies"];

  return {
    status: Object.values(dependencies).every((state) => state === "up")
      ? "ok"
      : "degraded",
    dependencies,
  };
}

app.get("/health", async (_request, reply) => {
  const result = await health();
  return reply.code(200).send(result);
});

app.get("/blockchain/contract", async (_request, reply) => {
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
});

app.addHook("onClose", async () => {
  await database.end();
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ host: "0.0.0.0", port });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
};

void start();
