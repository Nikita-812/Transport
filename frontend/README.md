# Дашборд прогноза пассажиропотока трамваев

Веб-интерфейс диспетчера поверх существующего сервиса прогнозов (`forecast_api.py`). Приложение на React 19 +
TypeScript собирается в **один самодостаточный файл** `static/index.html`, который сервис отдаёт по `/` без
изменений бекенда, Dockerfile и Compose. Спецификация — OpenSpec change
[`openspec/changes/build-dispatcher-dashboard`](../openspec/changes/build-dispatcher-dashboard/).

Все команды ниже выполняются из корня репозитория, если не сказано иное. Пути к Python — для Windows
(`.venv/Scripts/python.exe`); на macOS и Linux — `.venv/bin/python`.

## Требования

- Node 24 и npm (проверено: Node 24.18, npm 11.16);
- виртуальное окружение бекенда `.venv` с зависимостями `requirements-*`. Системный `python` без них даёт
  ложные ошибки тестов;
- архив датасета в `dataset/` — только для снимка разработки.

## 1. Снимок прогноза для разработки

Бекенду нужен снимок прогноза. Для разработки его строит `frontend/scripts/dev_snapshot.py`: обучает принятую
модель `pooled_route_blend` и пишет плоский снимок (`forecast.csv`, `metadata.json`, `reference_map.json`) в
папку, которая не попадает в git. Код бекенда скрипт не меняет. Снимок чужого происхождения (без метки скрипта
или с указателем `current`) он не перезаписывает.

Годовой снимок 2025-11-01…2026-10-31 в `artifacts/service` (основной для разработки):

```bash
.venv/Scripts/python.exe frontend/scripts/dev_snapshot.py
```

Двухмесячный снимок 2025-11-01…2025-12-31 — как у поставки submission. На нём проверяется, как интерфейс
обрезает горизонт «Год» и ведёт себя в режиме «Сейчас» вне покрытия:

```bash
.venv/Scripts/python.exe frontend/scripts/dev_snapshot.py --horizon submission --output-dir artifacts/service-diagnostic
```

**Если `data/processed/history.csv` не читается** (Access denied: файл создал другой агент или пользователь
песочницы), пересоберите историю в свою папку и передайте её через `--data-dir`. `data/processed` при этом не
меняется:

```bash
.venv/Scripts/python.exe -m pipeline prepare --archive dataset --output-dir <папка>/processed
```

```bash
.venv/Scripts/python.exe frontend/scripts/dev_snapshot.py --data-dir <папка>/processed
```

Флаги `--horizon` и `--output-dir` сочетаются с `--data-dir` так же, как выше.

## 2. Запуск бекенда

Bash (Git Bash, macOS, Linux):

```bash
FORECAST_DIR=artifacts/service .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000
```

PowerShell:

```powershell
$env:FORECAST_DIR='artifacts/service'; .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000
```

Для двухмесячного снимка укажите `FORECAST_DIR=artifacts/service-diagnostic`. Сервис читает снимок при старте,
поэтому после смены снимка его нужно перезапустить.

## 3. Фронтенд

Один раз после клонирования (из папки `frontend/`):

```bash
npm ci
```

Команды (из папки `frontend/`):

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер Vite на http://localhost:5173. Запросы `/health`, `/forecasts*` и `/reference-map` проксируются на бекенд `http://127.0.0.1:8000` (другой адрес — переменная `API_TARGET`). |
| `npm run dev:mock` | тот же dev-сервер без бекенда: mock-адаптер API с синтетическими данными (см. ниже). |
| `npm run typecheck` | проверка типов TypeScript (strict). |
| `npm run lint` | ESLint, предупреждения считаются ошибками. |
| `npm test` | Vitest: доменные функции, API-клиент, ошибки, mock, компоненты оболочки, скрипт проверки сборки. |
| `npm run build` | сборка одним файлом и публикация в `static/index.html` (см. ниже). |

### Mock-режим

`npm run dev:mock` запускает Vite в режиме `mock`: файл `.env.mock` задаёт `VITE_API_MOCK=1`, и клиент API
вместо сети обращается к `src/api/mock.ts`. Mock отдаёт те же формы ответов и те же ошибки, что сервис:

- годовое покрытие 2025-11-01…2026-10-31, версия `mock_synthetic:…`, режим «диагностический»;
- детерминированные почасовые значения 10 маршрутов: будни с пиками около 8 и 18 ч, выходные ровнее;
- мини-справочник остановок маршрутов 1, 5, 7, 11, 12 (несколько реальных остановок справочника, в том числе
  общие «Метро „Семёновская“» и «Улица Ибрагимова» у 11 и 12);
- ошибки 422 со строковым и списочным `detail`.

**Данные mock синтетические — это не прогноз модели.** Ссылки на CSV-выгрузки сервиса в mock-режиме не
работают: их отдаёт только настоящий бекенд.

### Сборка и поставка

`npm run build`:

1. проверяет типы (`tsc -b`);
2. собирает `frontend/dist/index.html` через `vite-plugin-singlefile`: весь JS и CSS встроены в страницу;
3. проверяет результат `scripts/verify_single_file.mjs`;
4. копирует его в `static/index.html` (`scripts/publish_static.mjs`) и проверяет ещё раз.

`verify_single_file.mjs` падает, если страница:

- ссылается на локальные файлы (`src`, `href`, `srcset`, `url()` на относительные пути) — сервис их не раздаёт;
- подключает внешние скрипты, стили или картинки. Абсолютные `http(s)` допустимы только в `<a href>`;
- больше 3,5 МБ;
- содержит маркер mock-режима `__TRAM_API_MOCK__`;
- потеряла `<html lang="ru">`, заголовок или `meta viewport`.

Проверить файл отдельно: `node scripts/verify_single_file.mjs [путь]` (по умолчанию `../static/index.html`).

После сборки перезапустите бекенд и откройте http://127.0.0.1:8000/. Страница обращается только к эндпоинтам
того же сервиса по относительным адресам.

> **Правило:** `static/index.html` — артефакт сборки. Он коммитится, но руками не редактируется и меняется
> только командой `npm run build`.

## Устройство

```
src/
  main.tsx, App.tsx       вход, подключение mock, оболочка: загрузка → ошибка → дашборд
  AppProviders.tsx        TanStack Query, Mantine (тема, светлая по умолчанию), DatesProvider (ru), уведомления
  theme.ts                тема Mantine и хранение выбора светлой/тёмной темы
  api/                    types.ts (контракт и проверка ответов), client.ts, errors.ts (русские сообщения), mock.ts
  domain/                 чистые функции: даты, форматирование ru-RU
  state/                  store.ts (Zustand), persist.ts (безопасный localStorage)
  hooks/                  useHealth.ts
  components/             layout/ (шапка, панель, вкладки), common/ (загрузка, недоступность сервиса)
scripts/
  dev_snapshot.py         снимок прогноза для разработки
  verify_single_file.mjs  проверка однофайловой сборки
  publish_static.mjs      копирование сборки в static/index.html
```

Клиент API (`src/api/client.ts`):

- `health()`, `forecastRaw(route, start, end)` — почасовой прогноз одного маршрута, `referenceMap()`;
- `forecastAggregate()` — серверный агрегат, только для сверки;
- построители ссылок `exportCsvUrl(query)` (`/forecasts/export.csv`) и `submissionCsvUrl()` (`/forecasts.csv`).

Ответы проверяются по контракту: расхождение даёт ошибку «Неожиданный ответ сервиса», а не `NaN` в графиках.
Ошибки переводит `src/api/errors.ts`:

- известные строки `detail`, списочный `detail` FastAPI, сеть, 5xx;
- сырой текст исключения виден только в раскрываемых «Технических подробностях».
