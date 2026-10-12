import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 4890);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const relative = pathname === "/" ? "index.html" : normalize(pathname).replace(/^\/+/, "");
  const file = join(root, relative);
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("не найдено");
  }
}).listen(port, () => {
  console.log(`Тестовый сервер: http://localhost:${port} (корень: ${root})`);
});
