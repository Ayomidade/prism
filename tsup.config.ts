import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/cli/index.ts",
    "src/ingestion/ast-parse.ts",
    "src/ingestion/graph-load.ts",
    "src/ingestion/db-write.ts",
    "src/ingestion/github-fetch.ts",
  ],
  format: "esm",
  target: "es2022",
  clean: true,
});
