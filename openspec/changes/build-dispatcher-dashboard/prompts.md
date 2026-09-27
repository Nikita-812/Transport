# Пак промптов: дашборд диспетчера

## Как пользоваться

- Разделы идут строго по порядку. На каждый раздел — новый чат, в него вставляется промпт целиком. Работа — в ветке `feat/frontend-dashboard`, коммиты локальные, без пуша.
- 2026-09-27 объём сокращён: разделы 3–8 заменены разделами 3–6. Подробности — в design, «D0. Сокращение объёма».
- Раздел 1 выполнен. Раздел 2 выполняется по прежнему промпту. Если его сессия прервётся — используйте «Промпт продолжения».

| Раздел | Кому | Уровень рассуждений | Время |
|---|---|---|---|
| 3. Графики, таблица, CSV | Opus 5.5 | high | ~40 мин |
| 4. Сценарные коэффициенты | GPT-6 Astra | high | ~30 мин |
| 5. Карта (OSM + MapLibre) | Opus 5.5 | high | ~60 мин, нужна сеть |
| 6. Выпуск, «О модели», сдача | Opus 5.5 | high | ~40 мин, нужен Docker |

Ревью по желанию — один раз в конце, в другом агенте. Уровень max — только если агент дважды не смог починить одну и ту же ошибку.

---

## Раздел 3. Графики, таблица и выгрузка

```text
Репозиторий хакатонного проекта «Прогноз пассажиропотока московских трамваев», ветка feat/frontend-dashboard.
Спека — openspec/changes/build-dispatcher-dashboard/. Прочитай proposal.md, design.md (сначала раздел D0 «Сокращение объёма»), specs/*/spec.md, tasks.md и handoff.md.

ЗАДАЧА: выполни раздел 3 tasks.md «Графики, таблица и выгрузка» — только его и не больше, чем написано в пунктах.

ПРАВИЛА
- Если разделы 1–2 не отмечены в tasks.md — остановись и сообщи.
- Бекенд не трогать: корневые *.py, requirements-*, Dockerfile, compose.yaml, .dockerignore, Python-тесты. static/index.html — только через npm run build. Не коммитить data/, dataset/, artifacts/, node_modules/, dist/.
- Интерфейс на русском, числа ru-RU, никаких выдуманных данных. Отклонения от design — одной строкой в handoff.md.
- Бекенд: FORECAST_DIR=artifacts/service .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000 (PowerShell: $env:FORECAST_DIR='artifacts/service').
- В конце должны быть зелёными:
  - в frontend/: npm run typecheck, npm run lint, npm test, npm run build;
  - в корне: .venv/Scripts/python.exe -m unittest discover.
  Затем быстрая проверка в браузере на странице бекенда, отметить чекбоксы, короткая запись в handoff.md, один коммит «feat(frontend): раздел 3 — графики, таблица, выгрузка».

ПОДСКАЗКИ
- ECharts только модульно: echarts/core + LineChart, BarChart, HeatmapChart + GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkAreaComponent (или MarkLineComponent), VisualMapComponent + CanvasRenderer. Для больших рядов: showSymbol: false, sampling: 'lttb'.
- data/calendar.ts: скопируй даты из calendar_2025.json и calendar_2026.json (корень репозитория) вместе с sources. Названия по ТК РФ ст. 112:
  - 1–6 и 8 января — Новогодние каникулы;
  - 7 января — Рождество Христово;
  - 23 февраля — День защитника Отечества;
  - 8 марта — Международный женский день;
  - 1 мая — Праздник Весны и Труда;
  - 9 мая — День Победы;
  - 12 июня — День России;
  - 4 ноября — День народного единства.
  Перенесённые выходные — «Перенесённый выходной».
- Агрегаты бери из domain/aggregate.ts (раздел 2), не считай заново.
- CSV: префикс '﻿', разделитель ';', прогнозы с 3 знаками после точки, коэффициент с 4. Имя файла: tram-forecast_<горизонт>_<start>_<end>.csv. Колонка coefficient пока равна 1: сценарий появится в разделе 4.
```

---

## Раздел 4. Сценарные коэффициенты

```text
Репозиторий хакатонного проекта «Прогноз пассажиропотока московских трамваев», ветка feat/frontend-dashboard.
Спека — openspec/changes/build-dispatcher-dashboard/. Прочитай proposal.md, design.md (сначала D0, затем D7), specs/*/spec.md (особенно scenario-coefficients), tasks.md и handoff.md.

ЗАДАЧА: выполни раздел 4 tasks.md «Сценарные коэффициенты» — только его и не больше, чем написано в пунктах.

ПРАВИЛА
- Если разделы 1–3 не отмечены в tasks.md — остановись и сообщи.
- Бекенд не трогать: корневые *.py, requirements-*, Dockerfile, compose.yaml, .dockerignore, Python-тесты. static/index.html — только через npm run build. Не коммитить data/, dataset/, artifacts/, node_modules/, dist/.
- Интерфейс на русском, числа ru-RU. Коэффициенты подписаны как допущения: модель на погоде не обучена.
- Бекенд: FORECAST_DIR=artifacts/service .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000.
- В конце зелёные: npm run typecheck / lint / test / build и .venv/Scripts/python.exe -m unittest discover. Затем быстрая проверка в браузере, отметить чекбоксы, короткая запись в handoff.md, один коммит «feat(frontend): раздел 4 — сценарные коэффициенты».

ПОДСКАЗКИ
- Одна точка применения: applyScenario(series, scenario) → скорректированные Float64Array и коэффициенты. Всё остальное читает только результат через один хук (например, useScenarioSeries). Раздел 5 (карта) и раздел 6 (выпуск) возьмут этот же хук.
- Сезоны: декабрь–февраль — зима, март–май — весна, июнь–август — лето, сентябрь–ноябрь — осень.
- Пресеты погоды — ровно из design D7. Хранить сценарий между перезагрузками не нужно (D0).
- Базовый прогноз не теряется: на графике база сплошной линией, сценарий пунктиром; KPI показывают сценарий, базу и Δ%; в CSV — base_prediction, coefficient, prediction.
```

---

## Раздел 5. Карта нагрузки

```text
Репозиторий хакатонного проекта «Прогноз пассажиропотока московских трамваев», ветка feat/frontend-dashboard.
Спека — openspec/changes/build-dispatcher-dashboard/. Прочитай proposal.md, design.md (сначала D0, затем D8 и D9), specs/*/spec.md (особенно route-load-map), tasks.md и handoff.md.

ЗАДАЧА: выполни раздел 5 tasks.md «Карта нагрузки» — только его и не больше, чем написано в пунктах.

ПРАВИЛА
- Если разделы 1–4 не отмечены в tasks.md — остановись и сообщи.
- Бекенд не трогать: корневые *.py, requirements-*, Dockerfile, compose.yaml, .dockerignore, Python-тесты. static/index.html — только через npm run build. Не коммитить data/, dataset/, artifacts/, node_modules/, dist/.
- Сумма маршрутов у остановки — никогда не «посадки на остановке». Геометрию не выдумывать: если Overpass недоступен — остановись и запиши это в handoff.md.
- Бекенд: FORECAST_DIR=artifacts/service .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000.
- В конце зелёные: npm run typecheck / lint / test / build и .venv/Scripts/python.exe -m unittest discover. Затем проверка на собранной странице, которую отдаёт бекенд (не только в vite dev). Отметить чекбоксы, короткая запись в handoff.md, один коммит «feat(frontend): раздел 5 — карта нагрузки».

ПОДСКАЗКИ
- Overpass:
  - POST с полем data, User-Agent проекта, таймаут 120 с;
  - первым пробуй https://maps.mail.ru/osm/tools/overpass/api/interpreter, затем overpass-api.de: он 2026-09-27 отвечал 504;
  - запрос: relation["type"="route"]["route"="tram"]["ref"~"^(1|5|7|11|12|17|25|26|28|50)$"](55.49,37.30,56.00,37.97);out geom;
  - затем теги узлов-остановок: rel(id:…)->.r;node(r.r);out;
- Склейка путей: члены relation с пустой ролью идут по порядку маршрута. Разворачивай путь, если стыкуется концом; при разрыве начинай новый отрезок. Остановки — узлы с ролями stop, stop_entry_only, stop_exit_only и их name. Координаты — 5 знаков после точки.
- Для тестов сохрани ответ /reference-map бекенда в src/test/fixtures/reference-map.json. В справочнике кавычки прямые ("), в OSM — ёлочки: при сравнении названий нормализуй кавычки и ё → е.
- MapLibre: import 'maplibre-gl' и его CSS. Обязательно проверь, что воркер стартует в собранном однофайловом static/index.html. Если нет — maplibregl.setWorkerUrl с blob.
- Glyphs в растровом стиле нет. Номера маршрутов — HTML-маркеры (maplibregl.Marker), названия остановок — всплывающие подсказки.
- Окраска: одна GeoJSON-линия на маршрут со свойством route. Цвет и толщина меняются через setPaintProperty с ['match', ['get','route'], …] — без новых запросов и без перерисовки React-дерева; map держи в ref. Таймер проигрывания очищается при размонтировании.
- Значения берутся из хука сценария (раздел 4). Квантили — по тем же значениям, что показаны на карте.
```

---

## Раздел 6. Выпуск, «О модели» и сдача

```text
Репозиторий хакатонного проекта «Прогноз пассажиропотока московских трамваев», ветка feat/frontend-dashboard.
Спека — openspec/changes/build-dispatcher-dashboard/. Прочитай proposal.md, design.md (сначала D0, затем раздел «Факты для вкладки „О модели“» и D13), specs/*/spec.md (особенно operations-planning и model-transparency), tasks.md и handoff.md.

ЗАДАЧА: выполни раздел 6 tasks.md «Выпуск, „О модели“ и сдача» — только его и не больше, чем написано в пунктах.

ПРАВИЛА
- Если разделы 1–5 не отмечены в tasks.md — остановись и сообщи.
- Бекенд не трогать: корневые *.py, requirements-*, Dockerfile, compose.yaml, .dockerignore, Python-тесты. static/index.html — только через npm run build. Не коммитить data/, dataset/, artifacts/, node_modules/, dist/. В корневом README менять только раздел «Веб-сервис прогнозов».
- Тексты «О модели» — строго факты из design, цифры не менять и не добавлять.
- Бекенд: FORECAST_DIR=artifacts/service .venv/Scripts/python.exe -m uvicorn forecast_api:app --port 8000.
- В конце зелёные: npm run typecheck / lint / test / build и .venv/Scripts/python.exe -m unittest discover. Отметить чекбоксы, короткий отчёт в handoff.md, один коммит «feat(frontend): раздел 6 — выпуск, о модели, сдача».

ПОДСКАЗКИ
- Выпуск: B берётся после сценария (хук из раздела 4). Для «Дня» — значения дня, для периода — средний день. Рейсы = ⌈B·s / (C·f)⌉, интервал = ⌊60 / рейсы⌋. По умолчанию C = 180 пасс., f = 70 %, s = 0,35.
- model-info.ts: ключ — префикс forecast_version до «:». Тест должен фиксировать 0,861 / 0,835 / 0,840 / 0,848 и 0,857 / 0,827 / 0,843. Для неизвестной модели (например, mock_synthetic) — только версия и ссылка на README: https://github.com/Nikita-812/Transport#readme.
- Docker (из корня):
  FORECAST_SNAPSHOT_DIR=./artifacts/service docker compose up -d --build
  Открой http://127.0.0.1:8000/, пройди основные экраны, затем docker compose down.
- Скриншоты в docs/frontend/: overview.png, map.png, scenario.png, model.png. Если инструмента скриншотов нет — пропусти и отметь в handoff.md.
- README, раздел «Веб-сервис прогнозов»: что умеет интерфейс, как открыть, как пересобрать фронтенд (cd frontend && npm ci && npm run build), ссылка на frontend/README.md.
```

---

## Промпт продолжения (если сессия прервалась)

```text
Продолжи работу над фронтендом хакатонного проекта «Прогноз пассажиропотока московских трамваев», ветка feat/frontend-dashboard.
Спека — openspec/changes/build-dispatcher-dashboard/. Прочитай proposal.md, design.md (D0 первым), specs/*/spec.md, tasks.md и handoff.md, затем git status и git log.

Найди первый неотмеченный раздел tasks.md. Пойми, что уже сделано (незакоммиченные изменения, последние коммиты), и доделай только оставшиеся пункты этого раздела.

Правила те же:
- бекенд не трогать;
- static/index.html — только через npm run build;
- в конце зелёные npm run typecheck / lint / test / build и .venv/Scripts/python.exe -m unittest discover;
- отмеченные чекбоксы, короткая запись в handoff.md и коммит.

Непонятные незакоммиченные изменения не удаляй молча — опиши их и спроси.
```

---

## Промпт финального ревью (по желанию, в другом агенте)

```text
Сделай ревью фронтенда хакатонного проекта «Прогноз пассажиропотока московских трамваев», ветка feat/frontend-dashboard.
Спека — openspec/changes/build-dispatcher-dashboard/: прочитай proposal.md, design.md (D0 первым), specs/*/spec.md, tasks.md и handoff.md, затем git log и git diff main --stat.

Проверь:
- бекенд не тронут;
- static/index.html совпадает со свежей сборкой (npm run build, затем git diff);
- в git нет data/, dataset/, artifacts/, node_modules/, dist/;
- нет выдуманных метрик и прогнозов по остановкам, обязательные подписи на месте;
- все проверки зелёные (запусти их);
- основные сценарии specs работают на странице бекенда.

Исправь явные дефекты одним коммитом «fix(frontend): финальное ревью», не расширяя объём. Спорное — опиши. Итог — короткой записью в handoff.md.
```
