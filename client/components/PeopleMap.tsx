import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PersonDirectoryEntry } from '../data/types';
import s from '../styles/ui.module.css';

function coordinates(geom: unknown): [number, number] | null {
  if (geom && typeof geom === 'object' && 'coordinates' in geom) {
    const value = (geom as { coordinates?: unknown }).coordinates;
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') return [value[0], value[1]];
  }
  return null;
}

export default function PeopleMap({ people }: { people: PersonDirectoryEntry[] }) {
  const host = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const mapped = useMemo(() => people.flatMap((person) => { const point = coordinates(person.home_place?.geom); return point ? [{ person, point }] : []; }), [people]);
  const mappedKey = mapped.map((item) => `${item.person.id}:${item.point.join(',')}`).join('|');

  useEffect(() => {
    if (!host.current || !mapped.length) return;
    let map: import('maplibre-gl').Map | undefined;
    let cancelled = false;
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([module]) => {
      if (cancelled || !host.current) return;
      const MapLibre = module.default;
      map = new MapLibre.Map({ container: host.current, center: mapped[0]!.point, zoom: 10, style: 'https://demotiles.maplibre.org/style.json', attributionControl: {} });
      const bounds = new MapLibre.LngLatBounds();
      const repeats = new Map<string, number>();
      for (const { person, point } of mapped) {
        const coordinateKey = point.join(',');
        const index = repeats.get(coordinateKey) ?? 0;
        repeats.set(coordinateKey, index + 1);
        const angle = index * 2.4;
        const radius = index === 0 ? 0 : 0.00016 * Math.ceil(index / 5);
        const offset: [number, number] = [point[0] + Math.cos(angle) * radius, point[1] + Math.sin(angle) * radius];
        bounds.extend(offset);
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = s.personMarker ?? '';
        marker.textContent = person.display_name.slice(0, 1).toLocaleUpperCase();
        marker.setAttribute('aria-label', `${person.display_name} at ${person.home_place?.name ?? 'saved place'}`);
        marker.title = `${person.display_name} · ${person.home_place?.name ?? 'Saved place'}`;
        marker.addEventListener('click', () => navigate(`/people/${person.id}`));
        new MapLibre.Marker({ element: marker, anchor: 'bottom' }).setLngLat(offset).setPopup(new MapLibre.Popup({ offset: 22 }).setText(`${person.display_name} · ${person.home_place?.name ?? 'Saved place'}`)).addTo(map);
      }
      if (mapped.length > 1) map.fitBounds(bounds, { padding: 64, maxZoom: 14 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [mappedKey, navigate]);

  const missing = people.length - mapped.length;
  return <section className={s.peopleMapWrap}>{mapped.length ? <div ref={host} className={s.peopleMap} aria-label={`Map showing ${mapped.length} ${mapped.length === 1 ? 'person' : 'people'}`} /> : <div className={s.mapNotice}><div><h2>No people to map</h2><p>Add a home place to a person, or change the current filters.</p></div></div>}{missing > 0 && <div className={s.mapSheet}><strong>{missing} {missing === 1 ? 'person has' : 'people have'} no place yet</strong><span>They still remain available in List view.</span></div>}</section>;
}
