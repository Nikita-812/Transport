import { create } from 'zustand';
import { isIsoDate, ROUTES, type Coverage, type RouteId } from '../api/types';
import { validHours, type HourRange } from '../domain/aggregate';
import { defaultGranularity, nowSelection, resolveRange, type Granularity, type Horizon } from '../domain/horizon';
import { createDefaultScenario, type ScenarioKind, type ScenarioRule } from '../domain/scenario';
import { parseUrl, type Filters } from './url';
import type { TabId } from './tabs';
export { TABS, isTabId, type TabId } from './tabs';

interface UiState {
  tab: TabId;
  panelOpen: boolean;
  coverage: Coverage | null;
  filters: Filters | null;
  urlWarnings: string[];
  validationError: string | null;
  nowMode: boolean;
  nowOutside: boolean;
  mapHour: number;
  /** Остановка, открытая на карте (идентификатор кластера из `domain/stops.ts`). */
  selectedStop: string | null;
  scenario: ScenarioRule[];
  initialize: (coverage: Coverage, search: string) => void;
  setTab: (tab: TabId) => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setRoutes: (routes: RouteId[]) => void;
  setHorizon: (horizon: Horizon) => void;
  setDates: (start: string, end: string) => void;
  setHours: (hours: HourRange) => void;
  setGranularity: (granularity: Granularity) => void;
  setSplit: (split: Filters['split']) => void;
  setMapHour: (hour: number) => void;
  setSelectedStop: (id: string | null) => void;
  updateScenarioRule: (kind: ScenarioKind, patch: Partial<ScenarioRule>) => void;
  resetScenario: () => void;
  goNow: () => void;
  tickNow: () => void;
  dismissWarnings: () => void;
  setValidationError: (error: string | null) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  tab: 'overview', panelOpen: false, coverage: null, filters: null, urlWarnings: [], validationError: null,
  nowMode: false, nowOutside: false, mapHour: 0, selectedStop: null, scenario: createDefaultScenario(),
  initialize: (coverage, search) => {
    const parsed = parseUrl(search, coverage);
    const now = nowSelection(coverage);
    set({ coverage, filters: parsed.filters, tab: parsed.tab, urlWarnings: parsed.warnings, validationError: null,
      nowMode: parsed.nowMode, nowOutside: parsed.nowMode && now.outsideCoverage, mapHour: now.hour });
  },
  setTab: (tab) => set({ tab }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setRoutes: (routes) => {
    const { filters } = get();
    if (filters) set({ filters: { ...filters, routes: ROUTES.filter((route) => routes.includes(route)) } });
  },
  setHorizon: (horizon) => {
    const { filters, coverage } = get();
    if (!filters || !coverage) return;
    const range = resolveRange(horizon, filters.start, filters.end, coverage);
    set({ filters: { ...filters, horizon, start: range.start, end: range.end, granularity: defaultGranularity(horizon, range) },
      nowMode: false, nowOutside: false, validationError: null });
  },
  setDates: (start, end) => {
    const { filters, coverage } = get();
    if (!filters || !coverage) return;
    if (!isIsoDate(start) || !isIsoDate(end) || start < coverage.start || start > coverage.end || end < coverage.start || end > coverage.end) {
      set({ validationError: 'Выберите корректные даты в пределах покрытия снимка.' }); return;
    }
    if (filters.horizon === 'period' && end < start) { set({ validationError: 'Дата окончания не может быть раньше даты начала.' }); return; }
    const range = resolveRange(filters.horizon, start, end, coverage);
    set({ filters: { ...filters, start: range.start, end: range.end, granularity: defaultGranularity(filters.horizon, range) },
      nowMode: false, nowOutside: false, validationError: null });
  },
  setHours: (hours) => {
    const { filters } = get();
    if (!validHours(hours)) { set({ validationError: 'Часы: целые числа от 0 до 23; «с» не позже «по».' }); return; }
    if (filters) set({ filters: { ...filters, hours }, validationError: null });
  },
  setGranularity: (granularity) => {
    const { filters } = get(); if (filters) set({ filters: { ...filters, granularity } });
  },
  setSplit: (split) => {
    const { filters } = get(); if (filters) set({ filters: { ...filters, split } });
  },
  setMapHour: (hour) => { if (Number.isInteger(hour) && hour >= 0 && hour <= 23) set({ mapHour: hour, nowMode: false }); },
  setSelectedStop: (selectedStop) => set({ selectedStop }),
  updateScenarioRule: (kind, patch) => set((state) => ({
    scenario: state.scenario.map((rule) => (rule.kind === kind ? { ...rule, ...patch, kind } : rule)),
  })),
  resetScenario: () => set({ scenario: createDefaultScenario() }),
  goNow: () => {
    const { filters, coverage } = get(); if (!filters || !coverage) return;
    const now = nowSelection(coverage);
    set({ filters: { ...filters, horizon: 'day', start: now.date, end: now.date, granularity: 'hour', hours: { from: 0, to: 23 } },
      mapHour: now.hour, nowMode: true, nowOutside: now.outsideCoverage, validationError: null });
  },
  tickNow: () => {
    const { filters, coverage, nowMode, mapHour } = get(); if (!nowMode || !filters || !coverage) return;
    const now = nowSelection(coverage);
    if (now.date !== filters.start || now.hour !== mapHour) {
      set({ filters: now.date === filters.start ? filters : { ...filters, start: now.date, end: now.date },
        mapHour: now.hour, nowOutside: now.outsideCoverage });
    }
  },
  dismissWarnings: () => set({ urlWarnings: [] }),
  setValidationError: (validationError) => set({ validationError }),
}));
