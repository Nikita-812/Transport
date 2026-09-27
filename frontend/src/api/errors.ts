// Ошибки API → сообщения на русском (design D12). Сырой текст исключения никогда не бывает основным
// сообщением: он уходит в раскрываемые технические детали.
import { formatIsoDate } from '../domain/format';
import { ROUTES, type Coverage, type ErrorDetail, type ValidationIssue } from './types';

export type ApiErrorKind = 'network' | 'http' | 'contract' | 'aborted';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly url: string;
  readonly status: number | undefined;
  readonly detail: ErrorDetail | undefined;
  /** Тело ответа как текст (обрезанное) — для технических деталей. */
  readonly body: string | undefined;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { url: string; status?: number; detail?: ErrorDetail; body?: string; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.url = options.url;
    this.status = options.status;
    this.detail = options.detail;
    this.body = options.body;
  }
}

export interface UserMessage {
  title: string;
  message: string;
  /** Технические детали для раскрываемого блока. */
  details?: string;
  /** Имеет смысл повторить тот же запрос (сеть, 5xx, неожиданный ответ). */
  retryable: boolean;
  /** Сервис недоступен целиком: сеть или 5xx. */
  unavailable: boolean;
}

export interface ErrorContext {
  /** Покрытие снимка из `/health`, чтобы назвать допустимый диапазон дат. */
  coverage?: Coverage | undefined;
}

export const SERVICE_UNAVAILABLE_TITLE = 'Сервис прогнозов недоступен';

/** Все известные строковые `detail` сервиса (design, «Контракт API»). */
export const KNOWN_DETAILS = {
  unsupportedRoute: 'routes contains an unsupported route',
  badRoutes: 'routes must be comma-separated route numbers',
  outsideCoverage: 'date range is outside the forecast snapshot coverage',
  badHour: 'hour must be between 0 and 23',
  badGroupBy: 'unsupported group_by',
  routeRequired: 'route or routes is required',
  stopsUnavailable: 'stop forecasts are unavailable: reference stops have no boarding target',
} as const;

function knownDetailMessage(detail: string, context: ErrorContext): string | undefined {
  switch (detail) {
    case KNOWN_DETAILS.unsupportedRoute:
      return `Выбран неизвестный маршрут. Прогноз есть для маршрутов ${ROUTES.join(', ')}.`;
    case KNOWN_DETAILS.badRoutes:
      return 'Номера маршрутов должны быть числами через запятую.';
    case KNOWN_DETAILS.outsideCoverage:
      return context.coverage
        ? `Даты вне периода прогноза. Доступны даты с ${formatIsoDate(context.coverage.start)} по ${formatIsoDate(context.coverage.end)}.`
        : 'Даты вне периода прогноза: выберите даты в пределах покрытия снимка.';
    case KNOWN_DETAILS.badHour:
      return 'Час должен быть от 0 до 23.';
    case KNOWN_DETAILS.badGroupBy:
      return 'Такая детализация не поддерживается сервисом.';
    case KNOWN_DETAILS.routeRequired:
      return 'Выберите хотя бы один маршрут.';
    case KNOWN_DETAILS.stopsUnavailable:
      return 'Прогноз по остановкам недоступен: в данных нет посадок, привязанных к остановкам.';
    default:
      return undefined;
  }
}

/** Тексты по полю запроса: [некорректное значение, отсутствует]. */
const FIELD_MESSAGES: Record<string, readonly [invalid: string, missing: string]> = {
  start_date: ['Некорректная дата начала', 'Не указана дата начала'],
  end_date: ['Некорректная дата окончания', 'Не указана дата окончания'],
  hour: ['Некорректный час: нужно целое число от 0 до 23', 'Не указан час'],
  route: ['Некорректный номер маршрута', 'Не указан маршрут'],
  routes: ['Некорректный список маршрутов', 'Не указаны маршруты'],
  group_by: ['Некорректная детализация', 'Не указана детализация'],
  stop_id: ['Некорректная остановка', 'Не указана остановка'],
};

function issueMessage(issue: ValidationIssue): string {
  const field = [...issue.loc].reverse().find((part): part is string => typeof part === 'string' && part !== 'query');
  const missing = issue.type === 'missing';
  const known = field === undefined ? undefined : FIELD_MESSAGES[field];
  if (known) return missing ? known[1] : known[0];
  if (field === undefined) return 'Некорректный параметр запроса';
  return missing ? `Не указан параметр «${field}»` : `Некорректный параметр «${field}»`;
}

/** Переводит списочный `detail` FastAPI в строки на русском, без повторов. */
export function describeValidationIssues(issues: readonly ValidationIssue[]): string[] {
  return [...new Set(issues.map(issueMessage))];
}

function technicalDetails(error: ApiError): string {
  const lines = [`${error.kind}${error.status === undefined ? '' : ` ${error.status}`} ${error.url}`];
  if (error.detail !== undefined) lines.push(typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail));
  else if (error.body) lines.push(error.body);
  if (error.kind === 'network' || error.kind === 'contract') lines.push(error.message);
  return lines.join('\n');
}

export function describeError(error: unknown, context: ErrorContext = {}): UserMessage {
  if (!(error instanceof ApiError)) {
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { title: 'Непредвиденная ошибка', message: 'Не удалось выполнить действие. Повторите попытку.', details: text, retryable: true, unavailable: false };
  }

  const details = technicalDetails(error);

  switch (error.kind) {
    case 'aborted':
      return { title: 'Запрос отменён', message: 'Запрос был отменён.', details, retryable: false, unavailable: false };
    case 'network':
      return {
        title: SERVICE_UNAVAILABLE_TITLE,
        message: 'Не удалось связаться с сервисом. Проверьте, что он запущен, и повторите попытку.',
        details,
        retryable: true,
        unavailable: true,
      };
    case 'contract':
      return {
        title: 'Неожиданный ответ сервиса',
        message: 'Сервис вернул данные в неизвестном формате. Возможно, версии интерфейса и сервиса не совпадают.',
        details,
        retryable: true,
        unavailable: false,
      };
    case 'http':
      break;
  }

  const status = error.status ?? 0;
  if (status >= 500) {
    return {
      title: SERVICE_UNAVAILABLE_TITLE,
      message: `Сервис ответил ошибкой ${status}. Повторите попытку позже.`,
      details,
      retryable: true,
      unavailable: true,
    };
  }

  if (typeof error.detail === 'string') {
    const known = knownDetailMessage(error.detail, context);
    if (known) return { title: 'Некорректный запрос', message: known, details, retryable: false, unavailable: false };
  } else if (Array.isArray(error.detail) && error.detail.length > 0) {
    return {
      title: 'Некорректные параметры запроса',
      message: `${describeValidationIssues(error.detail).join('. ')}.`,
      details,
      retryable: false,
      unavailable: false,
    };
  }

  return {
    title: 'Ошибка запроса',
    message: `Сервис не смог выполнить запрос (код ${status}).`,
    details,
    retryable: status === 0 || status === 408 || status === 429,
    unavailable: false,
  };
}
