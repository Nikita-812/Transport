export const TABS = [
  { value: 'overview', label: 'Обзор' },
  { value: 'map', label: 'Карта' },
  { value: 'table', label: 'Таблица' },
  { value: 'planning', label: 'Выпуск и расписание' },
  { value: 'model', label: 'О модели' },
] as const;
export type TabId = (typeof TABS)[number]['value'];
export function isTabId(value: unknown): value is TabId { return TABS.some((tab) => tab.value === value); }
