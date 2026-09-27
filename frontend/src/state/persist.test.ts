import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJson, readString, storageKey, writeJson, writeString } from './persist';

afterEach(() => window.localStorage.clear());

const isNumbers = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => typeof item === 'number');

describe('persist', () => {
  it('ключи с префиксом приложения', () => {
    writeString('x', '1');
    expect(window.localStorage.getItem(storageKey('x'))).toBe('1');
    expect(readString('x')).toBe('1');
  });

  it('JSON с проверкой формы', () => {
    writeJson('list', [1, 2]);
    expect(readJson('list', isNumbers, [])).toEqual([1, 2]);
    window.localStorage.setItem(storageKey('list'), '{broken');
    expect(readJson('list', isNumbers, [])).toEqual([]);
    window.localStorage.setItem(storageKey('list'), '["a"]');
    expect(readJson('list', isNumbers, [7])).toEqual([7]);
  });

  it('исключения хранилища не выходят наружу', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(readString('x')).toBeNull();
    expect(writeString('x', '1')).toBe(false);
    expect(readJson('x', isNumbers, [])).toEqual([]);
  });
});
