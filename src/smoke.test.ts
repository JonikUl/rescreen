import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_THRESHOLD, DEFAULT_VIEWPORT, defineConfig } from "./index.js";

describe("каркас контрактов", () => {
  it("defineConfig возвращает конфиг как есть", () => {
    const config = defineConfig({
      baseUrl: "https://example.com",
      pages: [{ name: "home", path: "/" }],
    });

    expect(config.pages).toHaveLength(1);
  });

  it("значения по умолчанию: desktop 1440×900, threshold 0", () => {
    expect(DEFAULT_VIEWPORT).toEqual({ width: 1440, height: 900 });
    expect(DEFAULT_THRESHOLD).toBe(0);
  });
});
