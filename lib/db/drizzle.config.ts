import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Relative path with forward slashes — drizzle-kit's path matcher on
  // Windows misinterprets backslashes from `path.join(__dirname, ...)`.
  // Relative paths resolve from the config file's directory.
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
