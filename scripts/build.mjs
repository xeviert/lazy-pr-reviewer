import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Some bundled dependencies are CommonJS and call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "none",
});
