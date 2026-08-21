import { useEffect, useRef } from 'react';
import type { Place } from '../data/types';
import s from '../styles/ui.module.css';

function coordinates(geom: unknown): [number, number] | null {
  if (geom && typeof geom === 'object' && 'coordinates' in geom) {
    const value = (geom as { coordinates?: unknown }).coordinates;
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') return [value[0], value[1]];
  }
  return null;
}

export default function PlacesMap({ places }: { places: Place[] }) {
  const host = useRef<HTMLDivElement>(null);
  const mapped = places.flatMap((place) => { const point = coordinates(place.geom); return point ? [{ place, point }] : []; });
  useEffect(() => {
    if (!host.current || !mapped.length) return;
    let map: import('maplibre-gl').Map | undefined;
    let cancelled = false;
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([module]) => {
      if (cancelled || !host.current) return;
      const MapLibre = module.default;
      map = new MapLibre.Map({ container: host.current, center: mapped[0]!.point, zoom: 10, style: 'https://demotiles.maplibre.org/style.json', attributionControl: {} });
      const bounds = new MapLibre.LngLatBounds();
      for (const { place, point } of mapped) { bounds.extend(point); new MapLibre.Marker({ color: '#c95016' }).setLngLat(point).setPopup(new MapLibre.Popup().setText(place.name)).addTo(map); }
      if (mapped.length > 1) map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [mapped.map((item) => `${item.place.id}:${item.point.join(',')}`).join('|')]);
  return <section className={s.map}>{mapped.length ? <div ref={host} style={{ width: '100%', height: '100%' }} aria-label={`Map showing ${mapped.length} places`} /> : <div className={s.mapNotice}><div><h2>No mapped places yet</h2><p>{places.length} place{places.length === 1 ? '' : 's'} are kept in your list without coordinates. This release does not geocode or request your location.</p></div></div>}</section>;
}
