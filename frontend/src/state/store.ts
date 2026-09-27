// Состояние интерфейса (design D11). Раздел 1 хранит только вкладку и выдвижную панель;
// фильтры, синхронизацию с URL и сценарий добавляют разделы 2 и 6.
import { create } from 'zustand';

export const TABS = [
  { value: 'overview', label: 'Обзор' },
  { value: 'map', label: 'Карта' },
  { value: 'table', label: 'Таблица' },
  { value: 'planning', label: 'Выпуск и расписание' },
  { value: 'model', label: 'О модели' },
] as const;

export type TabId = (typeof TABS)[number]['value'];

export function isTabId(value: unknown): value is TabId {
  return TABS.some((tab) => tab.value === value);
}

interface UiState {
  tab: TabId;
  /** Выдвижная панель фильтров на узких экранах. */
  panelOpen: boolean;
  setTab: (tab: TabId) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  tab: 'overview',
  panelOpen: false,
  setTab: (tab) => set({ tab }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
}));
