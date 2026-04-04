import { defineConfig } from "tsup";

export default defineConfig({
    entry: { index: "src/index.ts", devtools: "src/devtools.ts", broadcast: "src/broadcast/index.ts", persist: "src/persist/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    target: "es2020",
});