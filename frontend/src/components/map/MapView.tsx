import { Alert, Loader, Text, isLightColor } from '@mantine/core';
import type { Feature, FeatureCollection, MultiLineString, Point } from 'geojson';
import type {
  GeoJSONSource, LngLatBoundsLike, Map as MaplibreMap, MapLayerMouseEvent, Marker, StyleSpecification,
} from 'maplibre-gl';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { RouteId } from '../../api/types';
import { OSM_ROUTES, type LngLat } from '../../data/osm-routes';
import { ROUTE_COLORS } from '../../data/route-colors';
import { formatInteger } from '../../domain/format';
import { LOAD_CLASS_COUNT, MIN_LINE_WIDTH } from '../../domain/mapLoad';
import { routeLabelAnchors } from '../../domain/routeLabels';
import type { StopCluster } from '../../domain/stops';
import classes from './map.module.css';
import { loadMaplibre } from './maplibre';
import { CASING_COLOR, CASING_EXTRA_WIDTH, casingWidths, NO_DATA_COLOR, routeMatch, type HourPaint } from './paint';

// Единственная подложка — растровые тайлы OSM с атрибуцией (design D0). Если тайлы не грузятся, остаётся
// светлый фон, и линии со остановками видны сами: они вшиты в страницу и от внешней сети не зависят.
const OSM_LINK = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">';

/** Одна линия (MultiLineString) на маршрут со свойством `route`: окраска меняется только выражениями. */
const ROUTES_GEOJSON: FeatureCollection<MultiLineString, { route: RouteId }> = {
  type: 'FeatureCollection',
  features: OSM_ROUTES.routes.map((route) => ({
    type: 'Feature', properties: { route: route.route }, geometry: { type: 'MultiLineString', coordinates: route.lines },
  })),
};

/** Стиль создаётся заново для каждой карты: MapLibre хранит его как своё состояние. */
function createStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: `© ${OSM_LINK}OpenStreetMap contributors</a>`,
      },
      routes: {
        type: 'geojson',
        data: ROUTES_GEOJSON,
        attribution: `Маршруты: ${OSM_LINK}OpenStreetMap</a> (ODbL)`,
      },
      stops: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e9ecef' } },
      { id: 'osm', type: 'raster', source: 'osm' },
      {
        id: 'route-casing', type: 'line', source: 'routes', filter: ['in', ['get', 'route'], ['literal', []]],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': CASING_COLOR, 'line-opacity': 0.55, 'line-width': MIN_LINE_WIDTH + CASING_EXTRA_WIDTH },
      },
      {
        id: 'route-line', type: 'line', source: 'routes', filter: ['in', ['get', 'route'], ['literal', []]],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': NO_DATA_COLOR, 'line-width': MIN_LINE_WIDTH },
      },
      {
        id: 'stop-points', type: 'circle', source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 13, 3.5, 16, 6],
          'circle-color': '#ffffff',
          'circle-stroke-color': '#343a40',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 1.5],
        },
      },
      {
        id: 'stop-selected', type: 'circle', source: 'stops', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#212529', 'circle-stroke-width': 3.5 },
      },
      // Невидимая область попадания: точка остановки на обзорном масштабе меньше пальца.
      { id: 'stop-hit', type: 'circle', source: 'stops', paint: { 'circle-radius': 10, 'circle-opacity': 0 } },
    ],
  };
}

const LINE_LAYERS = ['route-casing', 'route-line'] as const;

/** Подписи элементов управления MapLibre на русском. */
const LOCALE = {
  'Map.Title': 'Карта нагрузки маршрутов',
  'Marker.Title': 'Подпись маршрута',
  'Popup.Close': 'Закрыть',
  'NavigationControl.ZoomIn': 'Приблизить',
  'NavigationControl.ZoomOut': 'Отдалить',
  'NavigationControl.ResetBearing': 'Сбросить поворот',
  'AttributionControl.ToggleAttribution': 'Показать или скрыть атрибуцию',
};

function stopsGeoJson(stops: readonly StopCluster[]): FeatureCollection<Point, { id: string; name: string; routes: string }> {
  return {
    type: 'FeatureCollection',
    features: stops.map((stop): Feature<Point, { id: string; name: string; routes: string }> => ({
      type: 'Feature',
      properties: { id: stop.id, name: stop.name, routes: stop.routes.join(', ') },
      geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
    })),
  };
}

function boundsOf(routes: readonly RouteId[]): LngLatBoundsLike {
  const chosen = OSM_ROUTES.routes.filter((route) => routes.includes(route.route));
  const points = (chosen.length ? chosen : OSM_ROUTES.routes).flatMap((route) => route.lines.flat());
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

let anchors: Map<RouteId, LngLat> | null = null;
/** Геометрия постоянна, поэтому места подписей считаются один раз за сессию. */
function labelAnchors(): Map<RouteId, LngLat> {
  anchors ??= routeLabelAnchors(OSM_ROUTES.routes);
  return anchors;
}

function labelElement(route: RouteId): HTMLElement {
  const element = document.createElement('div');
  const color = ROUTE_COLORS[route];
  element.className = classes.routeLabel ?? '';
  element.setAttribute('role', 'img');
  element.textContent = String(route);
  element.style.backgroundColor = color;
  element.style.color = isLightColor(color) ? '#000000' : '#ffffff';
  return element;
}

function labelText(route: RouteId, paint: HourPaint): string {
  const value = paint.values.get(route);
  const loadClass = paint.classes.get(route);
  if (value === undefined || loadClass === undefined) return `Маршрут ${route}: нет данных`;
  return `Маршрут ${route}: ${formatInteger(value)} посадок в час, класс нагрузки ${loadClass + 1} из ${LOAD_CLASS_COUNT}`;
}

/** Подсказка остановки: название и маршруты. Текст из данных вставляется как текст, не как HTML. */
function stopTooltip(name: string, routes: string): HTMLElement {
  const root = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = name;
  const list = document.createElement('div');
  list.textContent = `Маршруты: ${routes}`;
  root.append(title, list);
  return root;
}

export interface MapViewProps {
  /** Выбранные маршруты: линии и подписи номеров. */
  routes: readonly RouteId[];
  /** Цвет и толщина линий в выбранный час. */
  paint: HourPaint;
  stops: readonly StopCluster[];
  selectedStop: string | null;
  onSelectStop: (id: string) => void;
}

/**
 * Тонкая обёртка MapLibre (design D1): карта создаётся один раз и живёт в ref. Смена часа и сценария меняет
 * только paint-выражения через `setPaintProperty`, выбор маршрутов — фильтры слоёв и подписи; данные
 * линий не перезагружаются и запросов к API нет.
 */
export function MapView({ routes, paint, stops, selectedStop, onSelectStop }: MapViewProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markers = useRef(new Map<RouteId, Marker>());
  const createMarker = useRef<((route: RouteId) => Marker) | null>(null);
  const initialRoutes = useRef(routes);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const selectStop = useEffectEvent((id: string) => onSelectStop(id));

  useEffect(() => {
    let cancelled = false;
    let map: MaplibreMap | null = null;
    const markerMap = markers.current;
    loadMaplibre().then((maplibre) => {
      const element = container.current;
      if (cancelled || !element) return;
      try {
        map = new maplibre.Map({
          container: element,
          style: createStyle(),
          bounds: boundsOf(initialRoutes.current),
          fitBoundsOptions: { padding: 24 },
          minZoom: 8,
          maxZoom: 18,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          renderWorldCopies: false,
          attributionControl: { compact: false },
          locale: LOCALE,
        });
      } catch (error) {
        console.warn('Карта не создана', error);
        setStatus('error');
        return;
      }
      const created = map;
      created.touchZoomRotate.disableRotation();
      created.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      // Ошибки тайлов подложки не мешают работе: линии и остановки вшиты в страницу.
      created.on('error', (event) => {
        if ((event as { sourceId?: string }).sourceId !== 'osm') console.warn('Ошибка карты', event.error);
      });
      // Названия остановок — всплывающие подсказки: в растровом стиле нет шрифтов для подписей.
      const popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: classes.stopTooltip });
      let hovered: string | null = null;
      created.on('mousemove', 'stop-hit', (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const properties = feature.properties as { id: string; name: string; routes: string };
        created.getCanvas().style.cursor = 'pointer';
        if (hovered === properties.id) return;
        hovered = properties.id;
        popup.setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(stopTooltip(properties.name, properties.routes)).addTo(created);
      });
      created.on('mouseleave', 'stop-hit', () => {
        hovered = null;
        created.getCanvas().style.cursor = '';
        popup.remove();
      });
      created.on('click', 'stop-hit', (event: MapLayerMouseEvent) => {
        const id = (event.features?.[0]?.properties as { id?: unknown } | undefined)?.id;
        if (typeof id === 'string') selectStop(id);
      });
      createMarker.current = (route) => {
        const marker = new maplibre.Marker({ element: labelElement(route), anchor: 'center' });
        marker.setLngLat(labelAnchors().get(route)!).addTo(created);
        return marker;
      };
      const ready = () => {
        if (cancelled) return;
        mapRef.current = created;
        setStatus('ready');
      };
      if (created.isStyleLoaded()) ready();
      else created.once('style.load', ready);
    }).catch((error: unknown) => {
      console.warn('MapLibre не загрузился', error);
      if (!cancelled) setStatus('error');
    });
    return () => {
      cancelled = true;
      for (const marker of markerMap.values()) marker.remove();
      markerMap.clear();
      createMarker.current = null;
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  // Выбор маршрутов: фильтры слоёв и подписи номеров.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !createMarker.current) return;
    for (const layer of LINE_LAYERS) map.setFilter(layer, ['in', ['get', 'route'], ['literal', [...routes]]]);
    for (const [route, marker] of markers.current) {
      if (!routes.includes(route)) { marker.remove(); markers.current.delete(route); }
    }
    for (const route of routes) if (!markers.current.has(route)) markers.current.set(route, createMarker.current(route));
  }, [status, routes]);

  // Час и сценарий: только paint-выражения. Подписи получают значение текстом — нагрузка не только цветом.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    map.setPaintProperty('route-line', 'line-color', routeMatch(paint.colors, NO_DATA_COLOR));
    map.setPaintProperty('route-line', 'line-width', routeMatch(paint.widths, MIN_LINE_WIDTH));
    map.setPaintProperty('route-casing', 'line-width', routeMatch(casingWidths(paint.widths), MIN_LINE_WIDTH + CASING_EXTRA_WIDTH));
    for (const [route, marker] of markers.current) marker.getElement().setAttribute('aria-label', labelText(route, paint));
  }, [status, paint, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    void map.getSource<GeoJSONSource>('stops')?.setData(stopsGeoJson(stops));
  }, [status, stops]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    map.setFilter('stop-selected', ['==', ['get', 'id'], selectedStop ?? '']);
  }, [status, selectedStop]);

  return (
    <div className={classes.frame}>
      <div ref={container} className={classes.map} data-testid="load-map" />
      {status === 'loading' && (
        <div className={classes.overlay} role="status"><Loader size="sm" /><Text size="sm">Загрузка карты…</Text></div>
      )}
      {status === 'error' && (
        <div className={classes.overlay}>
          <Alert color="red" title="Карта не отображается" maw={420}>
            Браузер не смог запустить карту (нужен WebGL). Остальные вкладки работают.
          </Alert>
        </div>
      )}
    </div>
  );
}
