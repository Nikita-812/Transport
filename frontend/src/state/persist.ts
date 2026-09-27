// Безопасный доступ к localStorage: в приватном режиме, при запрете cookies или переполнении
// хранилище бросает исключения. Интерфейс от этого не ломается — значение просто не сохраняется.

const PREFIX = 'tram-dashboard:';

/** Полный ключ хранилища; все ключи приложения версионируются вызывающим кодом (`scenario:v1` и т. п.). */
export function storageKey(name: string): string {
  return `${PREFIX}${name}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readString(name: string): string | null {
  try {
    return storage()?.getItem(storageKey(name)) ?? null;
  } catch {
    return null;
  }
}

export function writeString(name: string, value: string): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(storageKey(name), value);
    return true;
  } catch {
    return false;
  }
}

export function removeValue(name: string): void {
  try {
    storage()?.removeItem(storageKey(name));
  } catch {
    // Недоступное хранилище — нечего удалять.
  }
}

/** Читает JSON и проверяет его; повреждённое или неподходящее значение даёт `fallback`. */
export function readJson<T>(name: string, validate: (value: unknown) => value is T, fallback: T): T {
  const text = readString(name);
  if (text === null) return fallback;
  try {
    const value: unknown = JSON.parse(text);
    return validate(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown): boolean {
  try {
    return writeString(name, JSON.stringify(value));
  } catch {
    return false;
  }
}
