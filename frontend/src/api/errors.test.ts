import { describe, expect, it } from 'vitest';
import { ApiError, describeError, describeValidationIssues, KNOWN_DETAILS, SERVICE_UNAVAILABLE_TITLE } from './errors';
import type { ValidationIssue } from './types';

const URL = '/forecasts?route=17&start_date=2025-11-01&end_date=2025-11-01';

function http422(detail: string | ValidationIssue[]): ApiError {
  return new ApiError('http', 'HTTP 422', { url: URL, status: 422, detail });
}

describe('describeError: строковый detail', () => {
  const expected: Record<keyof typeof KNOWN_DETAILS, RegExp> = {
    unsupportedRoute: /неизвестный маршрут.*1, 5, 7, 11, 12, 17, 25, 26, 28, 50/,
    badRoutes: /числами через запятую/,
    outsideCoverage: /вне периода прогноза/,
    badHour: /от 0 до 23/,
    badGroupBy: /детализация не поддерживается/,
    routeRequired: /хотя бы один маршрут/,
    stopsUnavailable: /по остановкам недоступен/,
  };

  for (const [key, detail] of Object.entries(KNOWN_DETAILS) as [keyof typeof KNOWN_DETAILS, string][]) {
    it(`переводит «${detail}»`, () => {
      const message = describeError(http422(detail));
      expect(message.title).toBe('Некорректный запрос');
      expect(message.message).toMatch(expected[key]);
      expect(message.message).not.toContain(detail);
      expect(message.retryable).toBe(false);
      expect(message.unavailable).toBe(false);
      // Исходная строка сервиса остаётся в технических деталях.
      expect(message.details).toContain(detail);
    });
  }

  it('называет допустимый диапазон, если покрытие известно', () => {
    const message = describeError(http422(KNOWN_DETAILS.outsideCoverage), { coverage: { start: '2025-11-01', end: '2026-10-31' } });
    expect(message.message).toBe('Даты вне периода прогноза. Доступны даты с 01.11.2025 по 31.10.2026.');
  });

  it('неизвестная строка даёт общее сообщение с деталями', () => {
    const message = describeError(http422('something new'));
    expect(message.title).toBe('Ошибка запроса');
    expect(message.message).toBe('Сервис не смог выполнить запрос (код 422).');
    expect(message.details).toContain('something new');
  });
});

describe('describeError: списочный detail FastAPI', () => {
  it('отсутствующие даты (реальный ответ сервиса)', () => {
    const message = describeError(
      http422([
        { type: 'missing', loc: ['query', 'start_date'], msg: 'Field required', input: null },
        { type: 'missing', loc: ['query', 'end_date'], msg: 'Field required', input: null },
      ]),
    );
    expect(message.title).toBe('Некорректные параметры запроса');
    expect(message.message).toBe('Не указана дата начала. Не указана дата окончания.');
  });

  it('некорректная дата начала', () => {
    const message = describeError(
      http422([
        {
          type: 'date_from_datetime_parsing',
          loc: ['query', 'start_date'],
          msg: 'Input should be a valid date or datetime, input is too short',
          input: 'x',
          ctx: { error: 'input is too short' },
        },
      ]),
    );
    expect(message.message).toBe('Некорректная дата начала.');
    expect(message.details).toContain('date_from_datetime_parsing');
  });

  it('нечисловые маршрут и час', () => {
    const lines = describeValidationIssues([
      { type: 'int_parsing', loc: ['query', 'route'], msg: 'Input should be a valid integer', input: 'abc' },
      { type: 'int_parsing', loc: ['query', 'hour'], msg: 'Input should be a valid integer', input: 'x' },
    ]);
    expect(lines).toEqual(['Некорректный номер маршрута', 'Некорректный час: нужно целое число от 0 до 23']);
  });

  it('повторы схлопываются, неизвестное поле называется', () => {
    const lines = describeValidationIssues([
      { type: 'int_parsing', loc: ['query', 'route'], msg: '' },
      { type: 'int_parsing', loc: ['query', 'route'], msg: '' },
      { type: 'missing', loc: ['query', 'foo'], msg: '' },
      { type: 'value_error', loc: ['body', 3], msg: '' },
    ]);
    expect(lines).toEqual(['Некорректный номер маршрута', 'Не указан параметр «foo»', 'Некорректный параметр «body»']);
  });
});

describe('describeError: недоступность сервиса', () => {
  it('сетевая ошибка', () => {
    const error = new ApiError('network', 'Failed to fetch', { url: '/health', cause: new TypeError('Failed to fetch') });
    const message = describeError(error);
    expect(message.title).toBe(SERVICE_UNAVAILABLE_TITLE);
    expect(message.message).not.toContain('Failed to fetch');
    expect(message.details).toContain('Failed to fetch');
    expect(message).toMatchObject({ retryable: true, unavailable: true });
  });

  it('ответ 500', () => {
    const error = new ApiError('http', 'HTTP 500', { url: '/health', status: 500, body: 'Internal Server Error' });
    const message = describeError(error);
    expect(message.title).toBe(SERVICE_UNAVAILABLE_TITLE);
    expect(message.message).toBe('Сервис ответил ошибкой 500. Повторите попытку позже.');
    expect(message.details).toContain('Internal Server Error');
    expect(message).toMatchObject({ retryable: true, unavailable: true });
  });

  it('ответ 503 без JSON', () => {
    const message = describeError(new ApiError('http', 'HTTP 503', { url: '/health', status: 503, body: '<html>Bad gateway</html>' }));
    expect(message).toMatchObject({ title: SERVICE_UNAVAILABLE_TITLE, retryable: true, unavailable: true });
  });
});

describe('describeError: прочее', () => {
  it('неожиданный формат ответа', () => {
    const message = describeError(new ApiError('contract', 'health.ready: ожидалось true или false', { url: '/health', status: 200 }));
    expect(message.title).toBe('Неожиданный ответ сервиса');
    expect(message.details).toContain('health.ready');
    expect(message.retryable).toBe(true);
  });

  it('404 — общее сообщение, сырой текст только в деталях', () => {
    const message = describeError(new ApiError('http', 'HTTP 404', { url: '/nope', status: 404, detail: 'Not Found' }));
    expect(message.title).toBe('Ошибка запроса');
    expect(message.message).not.toContain('Not Found');
    expect(message.details).toContain('Not Found');
  });

  it('отмена запроса не выдаётся за недоступность', () => {
    const message = describeError(new ApiError('aborted', 'Запрос отменён', { url: '/health' }));
    expect(message).toMatchObject({ retryable: false, unavailable: false });
  });

  it('не-ApiError', () => {
    const message = describeError(new RangeError('boom'));
    expect(message.title).toBe('Непредвиденная ошибка');
    expect(message.message).not.toContain('boom');
    expect(message.details).toBe('RangeError: boom');
  });
});
