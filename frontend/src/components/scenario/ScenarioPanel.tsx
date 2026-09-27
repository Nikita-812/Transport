import {
  Alert, Button, Checkbox, Group, MultiSelect, NativeSelect, NumberInput, Slider, Stack, Switch, Text, Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { ROUTES, type Season } from '../../api/types';
import { hourLabel } from '../../domain/aggregate';
import { formatDecimal, SEASON_NAMES } from '../../domain/format';
import { EVENT_PRESETS, WEATHER_PRESETS, type ScenarioKind, type ScenarioRule } from '../../domain/scenario';
import { useUiStore } from '../../state/store';

function MultiplierControl({ kind, value, disabled = false }: {
  kind: ScenarioKind;
  value: number;
  disabled?: boolean;
}) {
  const update = useUiStore((state) => state.updateScenarioRule);
  const labels = { weather: 'Коэффициент погоды', season: 'Коэффициент сезона', event: 'Коэффициент события' } as const;
  const setValue = (next: number) => update(kind, { multiplier: Math.min(3, Math.max(0, next)) });
  return (
    <Stack gap={5}>
      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Text size="sm">{labels[kind]}</Text>
        <NumberInput
          aria-label={`${labels[kind]}, число`}
          value={value}
          onChange={(next) => typeof next === 'number' && setValue(next)}
          min={0}
          max={3}
          step={0.01}
          decimalScale={2}
          decimalSeparator=","
          clampBehavior="strict"
          disabled={disabled}
          size="xs"
          w={88}
        />
      </Group>
      <Slider
        thumbLabel={labels[kind]}
        value={value}
        onChange={setValue}
        min={0}
        max={3}
        step={0.01}
        label={(next) => formatDecimal(next, 2)}
        disabled={disabled}
      />
    </Stack>
  );
}

function ruleOf(rules: readonly ScenarioRule[], kind: ScenarioKind): ScenarioRule {
  const rule = rules.find((item) => item.kind === kind);
  if (!rule) throw new Error(`В сценарии нет правила ${kind}`);
  return rule;
}

const SEASON_OPTIONS = (Object.entries(SEASON_NAMES) as [Season, string][]).map(([value, label]) => ({ value, label }));
const ROUTE_OPTIONS = ROUTES.map((route) => ({ value: String(route), label: `Маршрут ${route}` }));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: hourLabel(hour) }));

/** Три фиксированные поправки D0: погода, один сезон и одно событие. */
export function ScenarioPanel() {
  const state = useUiStore();
  const { filters, coverage, scenario } = state;
  if (!filters || !coverage) return null;
  const weather = ruleOf(scenario, 'weather');
  const season = ruleOf(scenario, 'season');
  const event = ruleOf(scenario, 'event');
  const selectedRoutes = event.routes === 'all' ? ROUTES.map(String) : event.routes.map(String);
  const weatherPreset = WEATHER_PRESETS.find((item) => item.name === weather.name) ?? WEATHER_PRESETS[0];
  const eventPreset = EVENT_PRESETS.find((item) => item.name === event.name) ?? EVENT_PRESETS[0];

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={2} size="h6" tt="uppercase" c="dimmed" lts={0.4}>Сценарий</Title>
        <Button size="compact-xs" variant="subtle" color="gray" onClick={state.resetScenario}>Сбросить</Button>
      </Group>

      <NativeSelect
        label="Погода"
        value={weatherPreset.id}
        data={WEATHER_PRESETS.map((item) => ({ value: item.id, label: `${item.name} · ${formatDecimal(item.multiplier, 2)}` }))}
        onChange={(change) => {
          const preset = WEATHER_PRESETS.find((item) => item.id === change.currentTarget.value);
          if (preset) state.updateScenarioRule('weather', { name: preset.name, multiplier: preset.multiplier, enabled: true });
        }}
      />
      <MultiplierControl kind="weather" value={weather.multiplier} />

      <Switch
        label="Сезонная поправка"
        checked={season.enabled}
        onChange={(change) => state.updateScenarioRule('season', { enabled: change.currentTarget.checked })}
      />
      <NativeSelect
        label="Сезон"
        value={season.season ?? 'winter'}
        data={SEASON_OPTIONS}
        disabled={!season.enabled}
        onChange={(change) => state.updateScenarioRule('season', { season: change.currentTarget.value as Season })}
      />
      <MultiplierControl kind="season" value={season.multiplier} disabled={!season.enabled} />

      <NativeSelect
        label="Событие"
        value={event.enabled ? eventPreset.id : ''}
        data={[
          { value: '', label: 'Без события' },
          ...EVENT_PRESETS.map((item) => ({ value: item.id, label: `${item.name} · ${formatDecimal(item.multiplier, 2)}` })),
        ]}
        onChange={(change) => {
          const preset = EVENT_PRESETS.find((item) => item.id === change.currentTarget.value);
          state.updateScenarioRule('event', preset
            ? { name: preset.name, multiplier: preset.multiplier, enabled: true }
            : { enabled: false });
        }}
      />
      <MultiplierControl kind="event" value={event.multiplier} disabled={!event.enabled} />
      <MultiSelect
        label="Маршруты события"
        data={ROUTE_OPTIONS}
        value={selectedRoutes}
        disabled={!event.enabled}
        searchable
        clearable
        onChange={(values) => {
          const routes = ROUTES.filter((route) => values.includes(String(route)));
          state.updateScenarioRule('event', { routes: routes.length === ROUTES.length ? 'all' : routes });
        }}
      />
      <Group grow align="start">
        <NativeSelect
          label="Событие с"
          data={HOUR_OPTIONS}
          value={event.hours?.from ?? 0}
          disabled={!event.enabled}
          onChange={(change) => {
            const from = Number(change.currentTarget.value);
            state.updateScenarioRule('event', { hours: { from, to: Math.max(from, event.hours?.to ?? 23) } });
          }}
        />
        <NativeSelect
          label="Событие по"
          data={HOUR_OPTIONS}
          value={event.hours?.to ?? 23}
          disabled={!event.enabled}
          onChange={(change) => {
            const to = Number(change.currentTarget.value);
            state.updateScenarioRule('event', { hours: { from: Math.min(event.hours?.from ?? 0, to), to } });
          }}
        />
      </Group>
      <Checkbox
        label="Ограничить событие датами"
        checked={event.dates !== null}
        disabled={!event.enabled}
        onChange={(change) => state.updateScenarioRule('event', {
          dates: change.currentTarget.checked ? { from: filters.start, to: filters.end } : null,
        })}
      />
      {event.enabled && event.dates && (
        <Group grow align="start">
          <DateInput
            label="Дата события с"
            value={event.dates.from}
            minDate={coverage.start}
            maxDate={event.dates.to}
            valueFormat="DD.MM.YYYY"
            onChange={(value) => value && state.updateScenarioRule('event', { dates: { from: value, to: event.dates!.to } })}
          />
          <DateInput
            label="Дата события по"
            value={event.dates.to}
            minDate={event.dates.from}
            maxDate={coverage.end}
            valueFormat="DD.MM.YYYY"
            onChange={(value) => value && state.updateScenarioRule('event', { dates: { from: event.dates!.from, to: value } })}
          />
        </Group>
      )}

      <Alert color="blue" title="Экспертное допущение">
        Модель на погоде и событиях не обучена. Коэффициенты задаёт пользователь.
      </Alert>
      <Text size="sm" fw={600}>прогноз = база × коэффициенты</Text>
    </Stack>
  );
}
