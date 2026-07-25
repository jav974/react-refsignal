import { defineConfig } from "tsup";

export default defineConfig({
    entry: { index: "src/index.ts", devtools: "src/devtools/index.ts", broadcast: "src/broadcast/index.ts", persist: "src/persist/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
});