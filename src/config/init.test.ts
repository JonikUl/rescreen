import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { initProject } from "./init.js";
import { loadConfig } from "./loader.js";

describe("initProject", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rescreen-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("создаёт rescreen.config.ts с рабочим примером и директорию .rescreen/", async () => {
    const result = await initProject(dir);

    expect(result.configCreated).toBe(true);
    expect(result.configPath).toBe(join(dir, "rescreen.config.ts"));
    expect(result.storageDir).toBe(join(dir, ".rescreen"));

    const config = await readFile(result.configPath, "utf8");
    expect(config).toContain('from "rescreen"');
    expect(config).toContain("defineConfig");
    expect(config).toContain("baseUrl");

    const gitignore = await readFile(join(result.storageDir, ".gitignore"), "utf8");
    expect(gitignore).toContain("*");
  });

  it("повторный init не затирает существующий конфиг", async () => {
    await initProject(dir);
    const custom = `export default { baseUrl: "https://my-site.example", pages: [{ name: "home", path: "/" }] };`;
    await writeFile(join(dir, "rescreen.config.ts"), custom);

    const result = await initProject(dir);

    expect(result.configCreated).toBe(false);
    expect(await readFile(join(dir, "rescreen.config.ts"), "utf8")).toBe(custom);
  });

  it("сгенерированный конфиг проходит loadConfig", async () => {
    // Заглушка пакета "rescreen", чтобы jiti разрешил импорт defineConfig из шаблона
    await mkdir(join(dir, "node_modules", "rescreen"), { recursive: true });
    await writeFile(
      join(dir, "node_modules", "rescreen", "package.json"),
      JSON.stringify({ name: "rescreen", type: "module", main: "./index.js" }),
    );
    await writeFile(
      join(dir, "node_modules", "rescreen", "index.js"),
      "export function defineConfig(config) { return config; }",
    );

    await initProject(dir);

    const config = await loadConfig(dir);
    expect(config.pages.length).toBeGreaterThan(0);
  });
});
