# rescreen

Open-source CLI (MIT) для визуального регрессионного тестирования: снимает Snapshot'ы заданных страниц сайта, сравнивает их с Baseline'ами, показывает расхождения в самодостаточном HTML Report'е на русском языке и даёт workflow подтверждения изменений (Approve).

Статус: ранняя разработка. Команд пока нет — зафиксированы контракты модулей (`src/*/types.ts`).

## Требования

- Node.js >= 22.18
- pnpm (версия зафиксирована в `packageManager`, подтягивается через corepack)
- Chromium для съёмки Snapshot'ов — устанавливается явным шагом (postinstall-скриптов нет):

```bash
pnpm exec playwright install chromium
```

## Разработка

Тулчейн — [vite+](https://viteplus.dev) (`vp`): форматирование, линт, типизация, тесты и сборка одной dev-зависимостью. pnpm остаётся пакетным менеджером (`vp` делегирует ему).

```bash
pnpm install     # установка зависимостей
pnpm exec vp check   # oxfmt + oxlint + tsc одной командой
pnpm exec vp test    # тесты (Vitest)
pnpm exec vp pack    # сборка CLI (tsdown: bin + d.ts)
```

> **Риск: vite+ молод** (1.0 — сентябрь 2026). Риск принят осознанно: под капотом стандартные движки, поэтому откат дешёвый — заменить `vite-plus` на `vitest` + `oxlint` + `oxfmt` + `tsdown` по отдельности с почти тем же конфигом. При откате также удалить overrides из `pnpm-workspace.yaml`.
