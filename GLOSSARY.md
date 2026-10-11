# rescreen

Open-source CLI-инструмент для визуального регрессионного тестирования: снимает скриншоты заданных страниц сайта и сравнивает их с эталонными, показывая расхождения. Целевая аудитория — разработчики и тестировщики, проверяющие типовые страницы после выкатки изменений; отчёты должны быть понятны и нетехническим ролям (аналитики, маркетологи).

## Language

**Page**:
Конкретный URL сайта, за которым инструмент следит и который регулярно скриншотит.
_Avoid_: site, route, screen, target

**Snapshot**:
Скриншот одной Page, сделанный в ходе одного Run.
_Avoid_: screenshot, capture, image

**Baseline**:
Эталонный Snapshot, с которым сравниваются новые Snapshot'ы той же Page.
_Avoid_: reference, golden, expected

**Run**:
Один прогон инструмента: снятие Snapshot'ов со всех заданных Page и сравнение их с Baseline'ами.
_Avoid_: check, scan, pass

**Diff**:
Результат сравнения Snapshot'а с его Baseline'ом: есть ли расхождения и где именно они находятся.
_Avoid_: mismatch, regression (расхождение — не обязательно регрессия; регрессия — интерпретация Diff'а человеком)

**Approve**:
Подтверждение расхождения как ожидаемого: текущий Snapshot становится новым Baseline'ом для этой Page. Применяется выборочно — можно зааппрувить часть Page и переснять Snapshot'ы только для неаппрувнутых.
_Avoid_: accept, update baseline, overwrite

**Report**:
Итог Run'а в виде, понятном нетехнической аудитории: какие Page изменились, где именно, с визуальным сравнением.
_Avoid_: log, output, summary

**Mask**:
Область Page, заданная CSS-селектором и исключённая из сравнения Snapshot'а с Baseline'ом; в Report'е помечается как непроверяемая.
_Avoid_: ignore, hide, exclude

**Threshold**:
Доля отличающихся пикселей, при превышении которой расхождение считается Diff'ом; 0 — любое расхождение является Diff'ом.
_Avoid_: tolerance, sensitivity

**Element**:
Отдельный DOM-элемент Page, заданный CSS-селектором, который снимается собственным Snapshot'ом со своим Baseline'ом и своим Diff'ом.
_Avoid_: component, block, region

**Audit Log**:
Журнал операций Approve: что подтверждено, когда и какой Snapshot стал Baseline'ом.
_Avoid_: history, changelog
