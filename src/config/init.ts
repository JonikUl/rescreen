import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { CONFIG_FILES } from "./loader.js";

const CONFIG_TEMPLATE = `import { defineConfig } from "rescreen";

export default defineConfig({
  // Базовый URL сайта; полный адрес Page = baseUrl + path
  baseUrl: "https://example.com",

  // Глобальные Mask'и (CSS-селекторы): скрываются на всех Page — cookie-баннеры, виджеты консультанта
  mask: [".cookie-banner"],

  // Page — страницы, за которыми следит rescreen
  pages: [
    {
      name: "home", // slug: буквы, цифры, "-", "_" — попадает в имена файлов хранилища
      path: "/",
      // Element'ы со своими Snapshot'ами и Baseline'ами
      elements: ["header"],
    },
  ],
});
`;

/** Результат команды init: что создано и что уже существовало. */
export interface InitResult {
  /** Абсолютный путь к файлу конфигурации. */
  readonly configPath: string;
  /** true, если конфиг создан этим вызовом; false — уже существовал и не изменён. */
  readonly configCreated: boolean;
  /** Абсолютный путь к директории хранилища (`.rescreen/`). */
  readonly storageDir: string;
}

/**
 * Создаёт готовый `rescreen.config.ts` с рабочим примером и директорию `.rescreen/`.
 *
 * Постусловие: в `cwd` существует файл конфигурации, проходящий {@link loadConfig},
 * и директория `.rescreen/` с `.gitignore` (Baseline'ы — вне git по умолчанию, spec story 32).
 *
 * Инвариант: идемпотентен и неразрушающ — существующий конфиг (любой из
 * {@link CONFIG_FILES}) и существующий `.rescreen/.gitignore` никогда не затираются.
 */
export async function initProject(cwd: string = process.cwd()): Promise<InitResult> {
  const dir = resolve(cwd);
  const storageDir = join(dir, ".rescreen");

  let configCreated = false;
  const configPath = join(dir, CONFIG_FILES[0]);
  if (!(await configExists(dir))) {
    await writeFile(configPath, CONFIG_TEMPLATE);
    configCreated = true;
  }

  await mkdir(storageDir, { recursive: true });
  const gitignorePath = join(storageDir, ".gitignore");
  if (!(await exists(gitignorePath))) {
    await writeFile(gitignorePath, "*\n");
  }

  return { configPath, configCreated, storageDir };
}

async function configExists(dir: string): Promise<boolean> {
  for (const file of CONFIG_FILES) {
    if (await exists(join(dir, file))) return true;
  }
  return false;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}
