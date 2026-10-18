import { resolve } from "node:path";

export function loadWorkspaceEnv(): void {
  try {
    process.loadEnvFile(resolve(process.cwd(), "../.env"));
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}
