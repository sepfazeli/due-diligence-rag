import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 configuration.
// - The datasource connection URL now lives here (not in schema.prisma).
// - .env is NOT auto-loaded by the Prisma CLI, hence `import "dotenv/config"`.
// - Use Neon's DIRECT (unpooled) connection string for DATABASE_URL so that
//   migrations work reliably (Prisma 7 removed `directUrl`).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
