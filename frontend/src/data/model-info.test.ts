import { describe, expect, it } from 'vitest';
import { LIMITATIONS, modelFacts, modelName, MODELS, README_URL, SOURCES } from './model-info';

describe('название модели из forecast_version', () => {
  it('ключ — часть до двоеточия', () => {
    expect(modelName('pooled_route_blend:1ad02854ca82')).toBe('pooled_route_blend');
    expect(modelName('hist_absolute_error_depth_8_lr_0.1_iter_300:abc')).toBe('hist_absolute_error_depth_8_lr_0.1_iter_300');
    expect(modelName('mock_synthetic')).toBe('mock_synthetic');
  });
});

describe('метрики зафиксированы справочником фактов', () => {
  const scores = (version: string) => Object.fromEntries(modelFacts(version)!.metrics.map((m) => [m.period, m.score]));

  it('pooled_route_blend — 0,861 / 0,835 / 0,840 и 0,848', () => {
    expect(scores('pooled_route_blend:1ad02854ca82')).toEqual({
      'Май–июнь': 0.861,
      'Июль–август': 0.835,
      'Сентябрь–октябрь': 0.840,
      'Ранние срезы вместе': 0.848,
    });
  });

  it('сентябрь–октябрь помечен как не независимый только в этом срезе', () => {
    const facts = modelFacts('pooled_route_blend:1ad02854ca82')!;
    const notes = facts.metrics.filter((metric) => metric.note !== undefined);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.period).toBe('Сентябрь–октябрь');
    expect(notes[0]!.note).toContain('EDA');
  });

  it('прежний frozen winner — 0,857 / 0,827 и 0,843', () => {
    expect(scores('hist_absolute_error_depth_8_lr_0.1_iter_300:1ad02854ca82')).toEqual({
      'Май–июнь': 0.857,
      'Июль–август': 0.827,
      'Срезы вместе': 0.843,
    });
  });

  it('в справочнике только эти две модели', () => {
    expect(Object.keys(MODELS)).toEqual(['pooled_route_blend', 'hist_absolute_error_depth_8_lr_0.1_iter_300']);
  });
});

describe('неизвестная модель', () => {
  it('фактов нет, показывать нечего кроме версии и README', () => {
    expect(modelFacts('mock_synthetic:0001')).toBeNull();
    expect(modelFacts('pooled_route_blend_v2:1ad0')).toBeNull();
    expect(README_URL).toBe('https://github.com/Nikita-812/Transport#readme');
  });
});

describe('источники и ограничения', () => {
  it('у каждого источника рабочая схема ссылки и назначение', () => {
    for (const source of SOURCES) {
      expect(source.url).toMatch(/^https:\/\/[^\s]+[^.\s]$/);
      expect(source.purpose.length).toBeGreaterThan(0);
    }
  });

  it('перечислены календарь, OpenStreetMap, Overpass и тайлы', () => {
    const urls = SOURCES.map((source) => source.url);
    expect(urls).toContain('https://government.ru/docs/all/155500/');
    expect(urls).toContain('https://government.ru/docs/all/161028/');
    expect(urls).toContain('https://pravo.gov.ru/proxy/ips/?docbody=&nd=102074279');
    expect(urls).toContain('https://www.openstreetmap.org/copyright');
    expect(urls).toContain('https://maps.mail.ru/osm/tools/overpass/');
    expect(urls).toContain('https://operations.osmfoundation.org/policies/tiles/');
  });

  it('ограничений пять, включая отсутствие прогноза по остановкам', () => {
    expect(LIMITATIONS).toHaveLength(5);
    expect(LIMITATIONS[0]).toContain('остановкам');
  });
});
