import { parseRawForecast } from '../api/types';
import fixture from './fixtures/forecast-real.json';

export const fixtureHealth = fixture.health;
export const fixtureVersion = fixture.health.forecast_version;
export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}
export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
export function fixtureResponse(input: string): Response {
  const url = new URL(input, 'http://localhost');
  if (url.pathname === '/health') return jsonResponse(fixture.health);
  const route = Number(url.searchParams.get('route'));
  const start = url.searchParams.get('start_date') ?? fixture.start;
  const end = url.searchParams.get('end_date') ?? fixture.end;
  const response = fixture.raw.map(parseRawForecast).find((r) => r.routes[0] === route);
  if (!response) return jsonResponse({ detail: 'routes contains an unsupported route' }, 422);
  return jsonResponse({ ...response, rows: response.rows.filter((row) => row.date >= start && row.date <= end) });
}
