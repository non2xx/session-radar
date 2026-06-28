const esbuild = require("esbuild");
const watch = process.argv.includes("--watch");
esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  outfile: "out/extension.js",
  sourcemap: true,
}).then(() => { if (!watch) process.exit(0); });
