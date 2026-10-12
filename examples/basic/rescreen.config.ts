// Конфигурация для ручной проверки tracer bullet'а.
// В реальном проекте: import { defineConfig } from "rescreen".
export default {
  baseUrl: "http://localhost:4890",
  // Глобальная маска: cookie-баннер скрыт на всех Page
  mask: [".cookie-banner"],
  pages: [
    {
      name: "home",
      path: "/",
      // Per-page маска: живые часы меняются каждый прогон — скрываем их на своей Page
      mask: [".live-clock"],
    },
    { name: "features", path: "/features.html" },
  ],
};
