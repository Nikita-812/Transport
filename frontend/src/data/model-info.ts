// Справочник фактов о модели (design D13 и раздел design «Факты для вкладки „О модели“»).
// Источник — README и accuracy.py в ветке main на 2026-09-27. Интерфейс только показывает эти
// значения: он не пересчитывает метрики и ничего не добавляет от себя.

/** README проекта: единственное, что показывается для неизвестной модели. */
export const README_URL = 'https://github.com/Nikita-812/Transport#readme';

export interface MetricSlice {
  /** Срез проверки: «май–июнь», «ранние срезы вместе». */
  period: string;
  /** WAPE-score при прогнозах, округлённых до целых, и обучении только на прошлом. */
  score: number;
  /** Оговорка к срезу, если она есть в фактах. */
  note?: string;
}

export interface ModelFacts {
  /** Ключ справочника — часть `forecast_version` до двоеточия. */
  id: string;
  /** Роль модели в проекте. */
  status: string;
  /** Устройство, параметры, признаки и протокол обучения. */
  design: { label: string; value: string }[];
  metrics: MetricSlice[];
}

const FEATURES = 'Маршрут, час, день недели, месяц, выходной, праздник, рабочий день с учётом переносов, '
  + 'предпраздничный день, число дней от 01.01.2025 (тренд).';
const TRAINING = 'Январь–октябрь 2025. Прогноз не обновляется внутри горизонта.';
const HYPERPARAMETERS = 'loss absolute_error, глубина 8, learning rate 0,1, 300 итераций, random_state 42.';

/** Модели, о которых у команды есть зафиксированные факты. Ключ — префикс `forecast_version`. */
export const MODELS: Readonly<Record<string, ModelFacts>> = {
  pooled_route_blend: {
    id: 'pooled_route_blend',
    status: 'Принятая модель',
    design: [
      { label: 'Устройство', value: 'Среднее 50/50 общей модели HistGradientBoosting по всем маршрутам и отдельных моделей для каждого маршрута.' },
      { label: 'Параметры', value: HYPERPARAMETERS },
      { label: 'Признаки', value: FEATURES },
      { label: 'Обучение', value: TRAINING },
    ],
    metrics: [
      { period: 'Май–июнь', score: 0.861 },
      { period: 'Июль–август', score: 0.835 },
      { period: 'Сентябрь–октябрь', score: 0.840, note: 'Этот срез изучался в EDA и не является независимым.' },
      { period: 'Ранние срезы вместе', score: 0.848 },
    ],
  },
  'hist_absolute_error_depth_8_lr_0.1_iter_300': {
    id: 'hist_absolute_error_depth_8_lr_0.1_iter_300',
    status: 'Прежний frozen winner',
    design: [
      { label: 'Устройство', value: 'Одна общая модель HistGradientBoosting по всем маршрутам.' },
      { label: 'Параметры', value: HYPERPARAMETERS },
      { label: 'Признаки', value: FEATURES },
      { label: 'Обучение', value: TRAINING },
    ],
    metrics: [
      { period: 'Май–июнь', score: 0.857 },
      { period: 'Июль–август', score: 0.827 },
      { period: 'Срезы вместе', score: 0.843 },
    ],
  },
};

/** Название модели — часть `forecast_version` до двоеточия (design D13). */
export function modelName(forecastVersion: string): string {
  return forecastVersion.split(':')[0] ?? forecastVersion;
}

/** Факты модели снимка или `null`, если модель неизвестна: тогда показывается только версия. */
export function modelFacts(forecastVersion: string): ModelFacts | null {
  return MODELS[modelName(forecastVersion)] ?? null;
}

/** WAPE и шкала жюри. */
export const QUALITY = {
  wape: 'WAPE = Σ|y − ŷ| / Σy',
  score: 'WAPE-score = max(0, 1 − WAPE)',
  baseline: 'Baseline организаторов на скрытом периоде (ноябрь–декабрь 2025) ≈ 0,48.',
  protocol: 'Проверка на отложенных двухмесячных срезах: обучение только на прошлом, без обновления прогноза внутри горизонта. Прогнозы округлены до целых.',
  official: 'Официальная оценка нашего прогноза на скрытом периоде команде неизвестна.',
  eda: 'Срез «сентябрь–октябрь» изучался в EDA, поэтому он не является независимой проверкой.',
} as const;

export interface CheckedIdea {
  title: string;
  text: string;
  link?: { title: string; url: string };
}

/** Проверено и не вошло в модель: ветка `feat/model-calendar-weather`, отчёт `artifacts/model-v2/report.md`. */
export const NOT_INCLUDED: readonly CheckedIdea[] = [
  {
    title: 'Погода',
    text: 'Архив Open-Meteo. С категориальным месяцем эффект +0,0002 (0,8437 → 0,8439) — несущественно. Без категориального '
      + 'месяца эффект +0,009, но такие конфигурации слабее в целом (0,843). В опытах использовалась фактическая архивная '
      + 'погода, то есть идеальный прогноз; в эксплуатации нужен прогноз погоды на 1–10 дней.',
    link: { title: 'Open-Meteo, архив погоды', url: 'https://open-meteo.com/en/docs/historical-weather-api' },
  },
  {
    title: 'Месяц числом или без месяца',
    text: 'Хуже категориального: 0,834 против 0,844.',
  },
  {
    title: 'Перенесённые выходные профилем воскресенья',
    text: 'Не улучшили итог (0,842). Рабочая суббота 1 ноября не корректировалась: аналога в истории нет.',
  },
];

export const NOT_INCLUDED_SOURCE = 'Ветка feat/model-calendar-weather, отчёт artifacts/model-v2/report.md; итог по трём срезам, прогнозы округлены.';

/** Область определения. */
export const APPLICABILITY: readonly string[] = [
  'Маршруты 1, 5, 7, 11, 12, 17, 25, 26, 28, 50; уровень «маршрут × час».',
  'Проверены горизонты до двух месяцев.',
  'Год — качественная оценка: ноябрь и декабрь не встречались в обучении; признак тренда за пределами обучения не растёт, деревья продлевают уровень конца октября 2025.',
  'Маршрут 5 редок в данных.',
];

/** Область адаптации: что нужно, чтобы расширить решение. */
export const ADAPTATION: readonly { need: string; requires: string }[] = [
  { need: 'Новый маршрут', requires: 'История валидаций за несколько месяцев и переобучение.' },
  { need: 'Новый год', requires: 'Производственный календарь.' },
  { need: 'Прогноз по остановкам', requires: 'Привязка валидаций к остановкам: телематика, GPS, расписание.' },
  { need: 'Погода', requires: 'Исторический источник погоды, переобучение и проверка эффекта.' },
  { need: 'События', requires: 'Календарь событий с историей.' },
];

export interface DataSource {
  title: string;
  url: string;
  purpose: string;
}

export const SOURCES: readonly DataSource[] = [
  { title: 'Датасет хакатона', url: 'https://disk.yandex.ru/d/DiFwlfMOauxjBg', purpose: 'Валидации, labels, справочник остановок' },
  { title: 'Постановление Правительства РФ от 04.10.2024 № 1335', url: 'https://government.ru/docs/all/155500/', purpose: 'Производственный календарь 2025 года' },
  { title: 'Постановление Правительства РФ от 24.09.2025 № 1466', url: 'https://government.ru/docs/all/161028/', purpose: 'Производственный календарь 2026 года' },
  { title: 'ТК РФ, статьи 95 и 112', url: 'https://pravo.gov.ru/proxy/ips/?docbody=&nd=102074279', purpose: 'Нерабочие праздничные и сокращённые предпраздничные дни' },
  { title: 'OpenStreetMap, ODbL', url: 'https://www.openstreetmap.org/copyright', purpose: 'Пути и остановки маршрутов 17, 25, 26, 28, 50; получено через Overpass API' },
  { title: 'Зеркало Overpass API', url: 'https://maps.mail.ru/osm/tools/overpass/', purpose: 'Выгрузка геометрии OpenStreetMap' },
  { title: 'Тайлы OpenStreetMap', url: 'https://operations.osmfoundation.org/policies/tiles/', purpose: 'Подложка карты нагрузки' },
  { title: 'CARTO basemaps', url: 'https://carto.com/attributions', purpose: 'Проверенный поставщик тайлов; подложка карты — тайлы OpenStreetMap' },
];

/** Ограничения решения. */
export const LIMITATIONS: readonly string[] = [
  'Нет прогноза по остановкам: сумма маршрутов — не посадки на остановке.',
  'Погода и события — только сценарные допущения.',
  'Годовой горизонт не валидирован.',
  'Снимок диагностический по внутреннему порогу команды.',
  'Геометрия OpenStreetMap актуальна на дату выгрузки.',
];

/** План развития после хакатона. */
export const ROADMAP: readonly string[] = [
  'Привязка валидаций к остановкам по телематике.',
  'Источник погоды с проверкой эффекта.',
  'События и перекрытия.',
  'Регулярное переобучение.',
  'Серверные сценарии в API.',
];
