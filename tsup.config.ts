import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts", "src/devtools.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    target: "es2020",
});