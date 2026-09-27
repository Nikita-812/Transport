# Журнал передачи разделов

Записи добавляются в конец файла, по одной на раздел или ревью.

**Формат записи:**

```
## Раздел N — <название> (<дата>, <агент>)
- Сделано: …
- Отклонения от design/specs и причины: …
- Как проверить: команды и шаги в браузере
- Результаты проверок: typecheck / lint / test / build / unittest, размер static/index.html
- Открытые вопросы и риски для следующего раздела: …
```

## Раздел 0 — подготовка (2026-09-27, Claude Code)

**Сделано:**
- созданы ветка `feat/frontend-dashboard`, change `build-dispatcher-dashboard` (proposal, design, specs, tasks, prompts) и скрипт `frontend/scripts/dev_snapshot.py`;
- собран снимок разработки: `pooled_route_blend:1ad02854ca82`, покрытие 2025-11-01…2026-10-31, 87 600 строк, справочная карта маршрутов 1, 5, 7, 11, 12. Лежит в `artifacts/service` (в git не попадает).

**Особенность этой машины.** Файлы `data/processed/*` не читаются из сессии Claude Code: Access denied, их создал пользователь песочницы Codex. История была пересобрана без изменения `data/processed`:

```
.venv/Scripts/python.exe -m pipeline prepare --archive dataset --output-dir <scratch>/processed
.venv/Scripts/python.exe frontend/scripts/dev_snapshot.py --data-dir <scratch>/processed
```

**Снимок пересобран плоско (20:18).** Первая версия лежала в `.snapshots/<gen>` с доступом только для владельца, и Codex не смог бы запустить на ней бекенд. Теперь `forecast.csv`, `metadata.json` и `reference_map.json` лежат прямо в `artifacts/service` и наследуют права рабочей папки. Проверено: у `CodexSandboxUsers` есть доступ на чтение. Версия не изменилась: `pooled_route_blend:1ad02854ca82`.

**Базовая линия тестов бекенда** до начала работ: `.venv/Scripts/python.exe -m unittest discover` — 70 тестов, OK (12 с). Системный `python` на этой машине даёт 12 ошибок из-за отсутствующих зависимостей. Это не регрессия, всегда используйте `.venv`.

**Проверено:**
- на годовом снимке API отвечает на все эндпоинты;
- сырой год одного маршрута — 0,51–0,65 МБ за 40–60 мс;
- форматы ошибок `detail` (строка или список) совпадают с design;
- в OSM есть все 10 маршрутов (20 relation PTv2);
- зеркало Overpass `maps.mail.ru` работает, `overpass-api.de` отвечал 504;
- тайлы OSM и CARTO доступны из РФ;
- остановки справочника совпадают с OSM: медиана 9 м, p90 20 м;
- при кластеризации до 60 м найдены общие остановки: 11 и 12 — 27, 7 и 50 — 17, 11, 17 и 25 — 7.

**Как проверить:**

```
FORECAST_DIR=artifacts/service .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000
curl http://127.0.0.1:8000/health
```

## Раздел 1 — Каркас, сборка в static/index.html и доступ к API (2026-09-27, Claude Code, Opus 5.5)

Файлы раздела 0 (change и `frontend/scripts/dev_snapshot.py`) не были закоммичены, поэтому вошли в коммит раздела 1 без изменений, кроме чекбоксов и этой записи.

**Сделано:**
- **1.1.** Проект `frontend/` создан вручную, без `npm create vite`; `scripts/dev_snapshot.py` не тронут.
  - Скрипты: `dev`, `dev:mock` (`vite --mode mock` + `.env.mock`), `typecheck`, `lint`, `test`, `test:watch`, `build`.
  - Строгий TS: `strict`, `noUncheckedIndexedAccess`. ESLint с типовыми правилами.
  - Зависимости D1 установлены **все сразу**, включая ECharts и MapLibre: разделы 2, 6 и 7 у Codex идут без сети.
- **1.2.** `npm run build` выполняет по порядку:
  1. `tsc -b`, затем `vite build` с `vite-plugin-singlefile`;
  2. `verify_single_file.mjs` проверяет `dist/index.html`;
  3. `publish_static.mjs` копирует его в `static/index.html`;
  4. `verify_single_file.mjs` проверяет `static/index.html`.

  Скрипт проверки падает, если:
  - есть относительные `src`/`href`/`srcset`/`url()`;
  - подключены внешние ресурсы (кроме `<a href>` http(s));
  - в JS есть ссылки на невстроенные чанки `assets/…`;
  - размер больше 3,5 МБ;
  - есть маркер `__TRAM_API_MOCK__`;
  - нет `lang="ru"`, `<title>` или `meta viewport`.
- **1.3.** Прокси Vite: `/health`, `/forecasts` (покрывает `/forecasts/export.csv` и `/forecasts.csv`), `/reference-map` → `http://127.0.0.1:8000`; адрес меняется переменной `API_TARGET`.
  - `src/api/mock.ts` подменяет транспорт клиента. Порядок проверок и тексты ошибок — как в `forecast_api.py`: строковые `detail` и списки FastAPI `missing`, `int_parsing`, `date_from_datetime_parsing`.
  - Данные: годовое покрытие, будни с пиками около 8 и 18 ч, выходные ровнее, сезонность, детерминированный шум.
  - Мини-справочник: 23 реальные остановки справочника для маршрутов 1, 5, 7, 11, 12, среди них «Метро "Комсомольская"», «Метро "Семёновская"», «Улица Ибрагимова», «Усадьба Останкино».
  - Версия mock — `mock_synthetic:000000000000`. Это неизвестная модель, поэтому вкладка «О модели» не покажет для неё метрики.
- **1.4.** `src/api/types.ts` описывает контракт и проверяет ответы во время работы: расхождение даёт `ApiError('contract')` вместо `NaN`.
  - `src/api/client.ts`: `health`, `forecastRaw(route, start, end, signal)`, `referenceMap`; ссылки `exportCsvUrl(query)` и `submissionCsvUrl()`.
  - Дополнительно — `forecastAggregate` для теста согласованности в разделе 2 и `setApiTransport` для mock и тестов.
  - `src/api/errors.ts`: `ApiError`, `describeError(error, {coverage})` → `{title, message, details, retryable, unavailable}`, `KNOWN_DETAILS`, `describeValidationIssues`.
- **1.5.** Оболочка: `App` проходит состояния «загрузка → недоступен (с кнопкой «Повторить») → дашборд». Ответ `ready: false` тоже ведёт на экран недоступности.
  - Шапка: покрытие с числом дней, версия, нейтральный серый бейдж «Диагностический снимок» / «Рабочий снимок». Раскрытие бейджа поясняет порог 0,95 против 0,88 у жюри и ведёт на вкладку «О модели».
  - Тема: светлая по умолчанию, тёмная; выбор хранится в `localStorage` через `state/persist.ts` (все обращения в try/catch). Inline-скрипт в `index.html` применяет тему до загрузки, без мигания.
  - Левая панель: заготовка, ниже 1024 px выдвижная.
  - Вкладки «Обзор / Карта / Таблица / Выпуск и расписание / О модели» с заглушками; стрелки на клавиатуре работают.
  - `DatesProvider`: `ru`, неделя с понедельника.
- **1.6.** `frontend/README.md`: снимок разработки (год, `--horizon submission`, обход недоступного `data/processed`), запуск бекенда в Bash и PowerShell, команды npm, mock-режим, сборка и правило про `static/index.html`, устройство кода.

**Отклонения от design/specs и причины:**
- **Mantine 9.6 вместо Mantine 8** (D1). Mantine 8 не обновлялся с 17.03.2026, 9.x — текущая стабильная ветка (D1: «версии — последние стабильные»). Требует React ≥ 19.2 — у нас 19.3. API проверять по типам в `node_modules/@mantine/*/lib`.
- **TypeScript 6.0.3, а не последний 7.0.2.** `typescript-eslint` 8.70 поддерживает только TS < 6.1.
- **MapLibre 6.11, ECharts 6.1.** В D1 мажорные версии не указаны. MapLibre 5.x имеет критическую уязвимость GHSA-jrc7-96c5-q579; `npm audit` — 0 уязвимостей.
- **Пакеты сверх D1** — ставлю сейчас, потому что у Codex в следующих разделах нет сети:
  - `@mantine/notifications` — уведомления о некорректных параметрах URL (D11);
  - `@tabler/icons-react` — иконки, в сборку попадают только используемые;
  - `postcss-preset-mantine` и `postcss-simple-vars` — рекомендуемая Mantine настройка CSS-модулей.
- **Дополнения к сборке:**
  - встроенная иконка `data:` в `index.html`: сервис не раздаёт `/favicon.ico`, без неё браузер получил бы 404;
  - build проверяет файл дважды (до и после копирования) и дополнительно заголовок, язык и viewport;
  - добавлен `scripts/publish_static.mjs` (в D15 его нет).
- **На телефоне (< 480 px)** бейдж статуса — только значок, а покрытие и версия — в его раскрытии: иначе заголовок обрезался. От 480 до 992 px покрытие показывается под заголовком, от 992 px — справа вместе с версией.
- **Двухмесячный снимок разработки** в README пишется в `artifacts/service-diagnostic`: папка уже в корневом `.gitignore`, а корневой `.gitignore` по D16 менять нельзя.
- **`domain/dates.ts` и `domain/format.ts` созданы заранее**, с минимумом для шапки: `isoToUtcMs`, `daysInclusive`, `formatInteger`, `formatDecimal`, `formatIsoDate`, `pluralRu`, `formatDays`. Раздел 2 дополняет `dates.ts` горизонтами и московским «сейчас».

**Как проверить:**

```
cd frontend
npm ci
npm run typecheck
npm run lint
npm test
npm run build
cd ..
.venv/Scripts/python.exe -m unittest discover
FORECAST_DIR=artifacts/service .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000
```

В браузере на http://127.0.0.1:8000/:
- в шапке «Покрытие: 01.11.2025 — 31.10.2026 · 365 дней» и версия;
- бейдж раскрывается;
- тема переключается и переживает перезагрузку;
- при 375 px открывается выдвижная панель и нет горизонтальной прокрутки;
- в сетевой панели только `/` и `/health`, оба 200.

Недоступность: остановить бекенд, `npm run dev`, открыть http://localhost:5173 — экран «Сервис прогнозов недоступен» (прокси отвечает 502). Затем запустить бекенд, нажать «Повторить» — открывается дашборд. `npm run dev:mock` работает без бекенда: в консоли сообщение mock, запросов к `/health` нет.

**Результаты проверок:**
- `npm ci`, typecheck, lint — OK;
- `npm test` — 7 файлов, 96 тестов, OK;
- `npm run build` — OK;
- `unittest discover` — 70 тестов, OK;
- `static/index.html` — 748,5 КБ (766 462 байта), sha256 `962989cd333f…`; бюджет 3,5 МБ.

В браузере проверено:
- на годовом снимке (порт 8000): 1024 px и 375 px, обе темы, раскрытие бейджа, выдвижная панель;
- на двухмесячном снимке `artifacts/service-diagnostic` (порт 8001, `pooled_route_blend:1669da06529d`): «61 день»;
- dev-прокси всех эндпоинтов: `/forecasts`, `/forecasts/export.csv`, `/forecasts.csv`, `/reference-map` — 200;
- сценарий недоступности и повтора, mock-режим.

Команды README выполнены как написаны. Исключение — годовой снимок без `--data-dir`: из сессии Claude `data/processed` не читается (см. раздел 0), поэтому проверен вариант с `--data-dir` и `--horizon submission`.

**Открытые вопросы и риски для следующего раздела:**
- **Ширина, с которой панель становится выдвижной.** Спека dashboard-shell: ниже 1024 px (реализовано: `breakpoint: '64em'` в `Dashboard.tsx` и медиазапрос бургера в `layout.module.css`). tasks 8.1: «768–1279 px с выдвижной панелью». Решить к разделу 8 и поправить одно из двух.
- **Состояние.** Вкладка и выдвижная панель — в Zustand (`state/store.ts`: `tab`, `panelOpen`). Вкладка пока не в URL: синхронизация D11 — раздел 2.
- **Покрытие внутри дашборда** брать через `useReadyHealth()` (`hooks/useHealth.ts`): вне готового дашборда хук бросает исключение.
- **Заглушки** левой панели — `components/layout/SidePanel.tsx`, вкладок — `components/layout/DashboardTabs.tsx`: заменить реальными компонентами.
- **Ошибки.** Для 422 передавайте покрытие в `describeError(error, { coverage })`: тогда сообщение называет допустимый диапазон.
- **StrictMode в dev** даёт двойной `/health`: первый отменяется (`ERR_ABORTED`), второй — 200. В сборке этого нет.
- **Бюджет размера.** Сейчас 748 КБ: React, Mantine и их CSS примерно 260 КБ. MapLibre (около 1 МБ) и ECharts с модульным импортом уложатся в 3,5 МБ, но размер проверять после каждого раздела.
- **Mock-справочник** содержит 23 реальные остановки из справочника организаторов (имена и координаты); это подмножество того, что сервис и так отдаёт по `/reference-map`.
