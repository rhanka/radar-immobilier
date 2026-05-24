import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    host: process.env.POSTGRES_HOST ?? "postgres",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? "radar",
    password: process.env.POSTGRES_PASSWORD ?? "changeme-dev-only",
    database: process.env.POSTGRES_DB ?? "radar",
    ssl: false,
  },
});
