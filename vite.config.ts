import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
  pack: {
    entry: ["src/index.ts", "src/cli.ts"],
    dts: true,
    format: ["esm"],
    sourcemap: true,
  },
});
