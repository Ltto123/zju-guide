// =============================================================================
// global-setup.ts — run before all tests to prepare the test PostgreSQL database
// =============================================================================

import { execSync } from "node:child_process";

export function setup(): void {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://msewiki:msewiki@localhost:5432/msewiki_test";

  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to reset non-test database '${databaseName}'`,
    );
  }

  execSync("pnpm exec prisma db push --force-reset --skip-generate", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
}

export function teardown(): void {}
