// Настоящий API, запущенный по design D3. Запись только после получения согласованной версии.
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.API_TARGET ?? 'http://127.0.0.1:8000';
const start = '2025-11-01';
const end = '2025-11-07';
/** @param {string} path */
async function get(path) {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const body = await response.json();
  if (!body || typeof body !== 'object' || !('forecast_version' in body) || typeof body.forecast_version !== 'string') {
    throw new Error(`${path}: отсутствует forecast_version`);
  }
  return body;
}
const health = await get('/health');
const raw = await Promise.all([1, 17].map((route) => get(`/forecasts?route=${route}&start_date=${start}&end_date=${end}`)));
const groups = ['weekday', 'day', 'week'];
const aggregates = await Promise.all(groups.map((group) => get(`/forecasts?routes=1,17&start_date=${start}&end_date=${end}&group_by=${group}`)));
if ([...raw, ...aggregates].some((response) => response.forecast_version !== health.forecast_version)) throw new Error('Версия изменилась во время снятия фикстуры');
const fixture = { source: 'forecast_api.py, FORECAST_DIR=artifacts/service', start, end, health, raw, aggregates };
const directory = new URL('../src/test/fixtures/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('forecast-real.json', directory), `${JSON.stringify(fixture, null, 2)}\n`);
console.info(`Сохранена реальная фикстура: ${health.forecast_version}, ${start}…${end}`);
