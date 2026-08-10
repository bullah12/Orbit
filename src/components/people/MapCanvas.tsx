'use client';

import { useEffect, useRef, useState } from 'react';
// v6 dropped the default export; these are the three things this file uses.
// `Map` is aliased because the global of that name is also in scope here.
import { Map as MlMap, Marker, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { initials } from './PersonAvatar';
import type { MapPerson } from './types';

/**
 * The map itself. **Never imported directly** — `PeopleMap` pulls it in with
 * `next/dynamic({ ssr: false })`, which is what keeps ~220 KB of MapLibre out
 * of every bundle that is not the map view. Importing it anywhere eagerly
 * undoes that silently, so if you need something from this file, it probably
 * belongs in `types.ts` instead.
 *
 * MapLibre GL JS, not a CDN script: the service worker precaches what the
 * build emits, and a `<script src="https://…">` is a thing it cannot see. A
 * map that only works online in an app with an offline shell is a map that
 * breaks in exactly the place a household organiser gets used.
 *
 * Vector tiles, not raster, and that is the whole reason for the choice. Orbit
 * ships a real dark mode; a raster basemap is pixels baked at one lightness and
 * cannot follow it, so at sunset the app goes dark and the map stays a bright
 * rectangle. A vector style is restyleable at runtime, which is what the
 * `paintTokens` pass below does — pulling the actual computed values of
 * `--map-water` and `--map-land` out of the document and pushing them into the
 * style, so the basemap is tinted by the same two tokens the rest of the app's
 * map chrome uses rather than by a second opinion about what land looks like.
 */

/** Keyless, no account, no API key in the repo. OpenFreeMap serves both. */
const STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

/** Pins closer together than this, in screen pixels, become one cluster. */
const CLUSTER_PX = 56;

/** As close as the map will go. Past this, zooming stops separating anything. */
const MAX_ZOOM = 17;

/**
 * Would zooming in actually split this group?
 *
 * No, if every member is at the same coordinate — which is what a household
 * looks like. Asking this before easing in is the difference between a cluster
 * that opens and a cluster that swallows taps.
 */
function separable(group: MapPerson[]): boolean {
  const [first] = group;
  if (!first) return false;
  return group.some(
    (p) => Math.abs(p.lat - first.lat) > 1e-7 || Math.abs(p.lon - first.lon) > 1e-7,
  );
}

export default function MapCanvas({
  people,
  selectedIds,
  onSelect,
}: {
  /** Only people who have a place with coordinates. */
  people: MapPerson[];
  selectedIds: string[];
  /** One id for a pin, several for a cluster that cannot be zoomed apart. */
  onSelect: (ids: string[]) => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  // The click handler changes identity every render; the map is built once.
  // Reading it through a ref is what lets both of those be true.
  const select = useRef(onSelect);
  select.current = onSelect;
  const selected = useRef(selectedIds);
  selected.current = selectedIds;

  useEffect(() => {
    if (!holder.current || map.current) return;

    let m: MlMap;
    try {
      m = new MlMap({
        container: holder.current,
        style: STYLE[themeNow()],
        bounds: boundsOf(people),
        fitBoundsOptions: { padding: 64, maxZoom: 14 },
        attributionControl: { compact: true },
      });
    } catch (err) {
      // WebGL can be absent — an old device, a locked-down browser, a headless
      // context without a GL backend. Saying so beats a blank rectangle, and
      // the list view next door is the whole map's data anyway.
      setFailed(err instanceof Error ? err.message : String(err));
      return;
    }
    map.current = m;

    // No zoom buttons, deliberately. They are a pair of white squares whose
    // +/- glyphs are background images MapLibre ships at one lightness, so in
    // dark mode they are an invisible icon on a bright chip — and the only way
    // to flip them is a `prefers-color-scheme` media query, which this app's
    // stylesheet deliberately does not have (the palette is `light-dark()`, and
    // `contrast.test.ts` fails the file if a media query reappears). Pinch,
    // wheel, double-tap and the keyboard all still zoom, and tapping a cluster
    // is the gesture this map is actually built around.
    // Tiles failing is not fatal: the markers are positioned by projection, not
    // by the basemap, so they stay where they belong over an empty ground.
    m.on('error', () => {});
    m.on('load', () => paintTokens(m));
    m.on('move', () => draw());
    m.on('zoom', () => draw());
    draw();

    /** Re-cluster and re-place every pin for the current viewport. */
    function draw() {
      for (const mk of markers.current) mk.remove();
      markers.current = [];
      for (const group of cluster(m, people)) {
        const el =
          group.length === 1
            ? pinFor(group[0]!, selected.current.includes(group[0]!.id))
            : clusterPin(group);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (group.length === 1) {
            select.current([group[0]!.id]);
          } else if (separable(group) && m.getZoom() < MAX_ZOOM) {
            // A cluster that zooming can pull apart is a thing to get closer
            // to, not a thing to open.
            m.easeTo({ center: centre(group), zoom: Math.min(m.getZoom() + 2, MAX_ZOOM) });
          } else {
            // And a cluster zooming *cannot* pull apart is a thing to open.
            // Several people at one address is the ordinary case in a
            // household organiser, not an edge — two parents and a child share
            // a home, so their pins share a coordinate exactly. Zooming those
            // apart is impossible at any magnification, and without this branch
            // tapping them did nothing, for ever. The sheet lists them instead.
            select.current(group.map((g) => g.id));
          }
        });
        markers.current.push(
          new Marker({ element: el, anchor: 'bottom' })
            .setLngLat(centre(group))
            .addTo(m),
        );
      }
    }

    // Tapping the ground puts the sheet away.
    m.on('click', () => select.current([]));

    return () => {
      for (const mk of markers.current) mk.remove();
      markers.current = [];
      m.remove();
      map.current = null;
    };
    // Built once. `people` is a page-load constant here — the view is a server
    // render keyed on the URL, so a different set of people is a different
    // page, not a prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection is the one thing that changes without a navigation.
  useEffect(() => {
    for (const mk of markers.current) {
      const el = mk.getElement();
      const id = el.dataset.personId;
      el.setAttribute('aria-pressed', String(id != null && selectedIds.includes(id)));
    }
  }, [selectedIds]);

  if (failed) {
    return (
      <div className="muted flex h-full items-center justify-center p-6 text-center text-sm">
        <span>
          This browser cannot draw the map ({failed}). Everything on it is in the
          list view.
        </span>
      </div>
    );
  }

  return <div ref={holder} className="h-full w-full" style={{ background: 'var(--map-water)' }} />;
}

/**
 * The style's own ground colours, replaced with Orbit's.
 *
 * The design rule the rest of the app follows is that map surfaces are chrome:
 * greyscale plus the least blue that still says "sea", because ten category
 * colours have to sit on top and stay legible. A stock basemap has not read
 * that rule, so its background and water get overwritten with the two tokens
 * that have.
 *
 * Best-effort by construction — layer ids differ between styles, so each write
 * is attempted and a miss is not an error. Getting a slightly-off basemap is
 * not worth throwing on.
 */
function paintTokens(m: MlMap) {
  const css = getComputedStyle(document.documentElement);
  const water = css.getPropertyValue('--map-water').trim();
  const land = css.getPropertyValue('--map-land').trim();
  if (!water && !land) return;

  for (const layer of m.getStyle().layers ?? []) {
    try {
      if (layer.type === 'background' && land) {
        m.setPaintProperty(layer.id, 'background-color', land);
      } else if (layer.type === 'fill' && water && /water|ocean|sea/i.test(layer.id)) {
        m.setPaintProperty(layer.id, 'fill-color', water);
      }
    } catch {
      // A style that does not have that property on that layer. Fine.
    }
  }
}

/** Which half of every `light-dark()` pair is currently resolving. */
function themeNow(): 'light' | 'dark' {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** A pin: an avatar and the person's name. Colour is never the only cue. */
function pinFor(p: MapPerson, isSelected: boolean): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pin';
  el.dataset.personId = p.id;
  el.setAttribute('aria-pressed', String(isSelected));
  el.setAttribute('aria-label', `${p.displayName}, at ${p.placeName}`);

  const avatar = document.createElement('span');
  avatar.className = 'pin-avatar';
  const hue = p.category?.colour ?? 'slate';
  avatar.style.color = `var(--c-${hue}, var(--c-slate))`;
  avatar.style.background = `var(--c-${hue}-bg, var(--c-slate-bg))`;
  avatar.textContent = initials(p.displayName);

  const label = document.createElement('span');
  label.textContent = p.displayName;

  el.append(avatar, label);
  return el;
}

function clusterPin(group: MapPerson[]): HTMLElement {
  const n = group.length;
  // A cluster is labelled by *where* it is when it can be — every member at one
  // address is the ordinary case, and "Alder Close" says more than "4 people".
  // Only when the group spans several places does it fall back to the count.
  const first = group[0]!;
  const oneplace = group.every((p) => p.placeName === first.placeName);
  const label = oneplaceLabel(oneplace, first.placeName, n);

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pin pin-cluster';
  el.setAttribute('aria-label', `${n} people${oneplace ? ` at ${first.placeName}` : ' here'}`);

  const badge = document.createElement('span');
  badge.className = 'pin-avatar';
  badge.style.color = 'var(--c-slate)';
  badge.style.background = 'var(--c-slate-bg)';
  badge.textContent = `+${n}`;

  const text = document.createElement('span');
  text.textContent = label;

  el.append(badge, text);
  return el;
}

function oneplaceLabel(oneplace: boolean, placeName: string, n: number): string {
  return oneplace ? placeName : `${n} people`;
}

/**
 * Greedy pixel-distance clustering, recomputed on every move.
 *
 * Deliberately not MapLibre's own GeoJSON clustering: that clusters a GL
 * source, and these pins are HTML elements — a chip with an avatar and a name,
 * which is the form the design asks for precisely because a coloured dot alone
 * is not a cue. Two dozen people is nothing to group in JavaScript, and doing
 * it here means the pin and its cluster are the same kind of object.
 */
function cluster(m: MlMap, people: MapPerson[]): MapPerson[][] {
  const groups: { at: { x: number; y: number }; members: MapPerson[] }[] = [];

  for (const p of people) {
    const at = m.project([p.lon, p.lat]);
    const near = groups.find(
      (g) => Math.hypot(g.at.x - at.x, g.at.y - at.y) < CLUSTER_PX,
    );
    if (near) near.members.push(p);
    else groups.push({ at, members: [p] });
  }
  return groups.map((g) => g.members);
}

function centre(group: MapPerson[]): [number, number] {
  const lon = group.reduce((a, p) => a + p.lon, 0) / group.length;
  const lat = group.reduce((a, p) => a + p.lat, 0) / group.length;
  return [lon, lat];
}

/** Everybody on screen at the start, with a floor so one person is not zoom 22. */
function boundsOf(people: MapPerson[]): LngLatBoundsLike {
  if (people.length === 0) return [-8, 49.9, 1.8, 59] as [number, number, number, number];
  const lons = people.map((p) => p.lon);
  const lats = people.map((p) => p.lat);
  const pad = 0.01;
  return [
    Math.min(...lons) - pad,
    Math.min(...lats) - pad,
    Math.max(...lons) + pad,
    Math.max(...lats) + pad,
  ] as [number, number, number, number];
}
