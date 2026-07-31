import basemap from '@/lib/basemap.json';
import type { Whereabouts } from '@/lib/queries/whereabouts';

/**
 * The map on People.
 *
 * Inline SVG over vendored geometry, not raster tiles. `.map-land` and
 * `.map-line` in globals.css are `fill` and `stroke`, which is the stylesheet
 * saying the map is vector; and an app that refuses background location on
 * principle should not hand a tile server the household's rough position every
 * time somebody opens this page. `scripts/fetch-basemap.mjs` regenerates the
 * geometry for a different bounding box.
 *
 * The surface is chrome, deliberately — water, land and strokes are greyscale
 * plus the least blue that still reads as sea, because ten category-coloured
 * pins have to sit on top of it and stay legible.
 */

type Ring = [number, number][];

const WIDTH = 960;
const HEIGHT = 420;

export function PeopleMap({ people }: { people: Whereabouts[] }) {
  const pinned = people.filter(
    (p): p is Whereabouts & { lat: number; lon: number } => p.lat != null && p.lon != null,
  );

  const view = fitView(pinned.map((p) => [p.lon, p.lat] as [number, number]));

  return (
    <div className="map" style={{ minHeight: '18rem' }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={ariaLabel(people)}
        style={{ display: 'block', minHeight: '18rem' }}
      >
        {/*
          Land is the base, not the backdrop. `.map` paints --map-water behind
          everything, which is right for a coastline and wrong for an inland
          city — so the ground goes down first and water is drawn onto it as
          the feature it actually is here.
        */}
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="map-land" />

        {/* Parks and woodland: bounded by a stroke rather than given a colour
            of their own. The system names three map surfaces and green is not
            one of them, and inventing a fourth would be spending a hue the ten
            category colours need. */}
        <g style={{ fill: 'none', stroke: 'var(--map-line)', strokeWidth: 0.75, opacity: 0.7 }}>
          {(basemap.green as Ring[]).map((ring, i) => (
            <path key={`g${i}`} d={pathFor(ring, view)} />
          ))}
        </g>

        <g style={{ fill: 'var(--map-water)', stroke: 'var(--map-line)', strokeWidth: 0.5 }}>
          {(basemap.water as Ring[]).map((ring, i) => (
            <path key={`w${i}`} d={pathFor(ring, view)} />
          ))}
        </g>

        <g style={{ fill: 'none', stroke: 'var(--map-line)', strokeWidth: 1.25 }}>
          {(basemap.roads as Ring[]).map((ring, i) => (
            <path key={`r${i}`} d={pathFor(ring, view, false)} />
          ))}
        </g>

        {/*
          Pins are foreignObject so they are real `.pin` elements — the halo,
          the dot and the name are the stylesheet's, not reimplemented in SVG.
        */}
        {pinned.map((p) => {
          const [x, y] = project([p.lon, p.lat], view);
          return (
            <foreignObject
              key={p.personId}
              x={x - 90}
              y={y - 14}
              width={180}
              height={28}
              style={{ overflow: 'visible' }}
            >
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {/*
                  The name is on the pin, never a bare colour dot. Colour is
                  reinforcement; the label is the identification. The halo is
                  load-bearing too — it is what keeps a pin readable when it
                  lands on a boundary between two surfaces.
                */}
                <span className="pin">
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: `var(--c-${p.space.colour}, var(--c-slate))`,
                      display: 'inline-block',
                      flex: 'none',
                    }}
                  />
                  {p.name}
                </span>
              </div>
            </foreignObject>
          );
        })}
      </svg>

      <p className="faint px-2 py-1 text-2xs" style={{ background: 'var(--bg-raised)' }}>
        {basemap.attribution} · last known positions, from check-ins and the calendar
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

type View = { minX: number; minY: number; scale: number; offsetX: number; offsetY: number };

/**
 * Web Mercator, in radians on both axes.
 *
 * Both of these matter: x has to be radians too, because a single scale is
 * applied to both, and mixing degrees with the radians that come out of the
 * latitude formula squashes the map into a band.
 */
function mercatorX(lon: number): number {
  return (lon * Math.PI) / 180;
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85, Math.min(85, lat));
  return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
}

/**
 * Fit the view to the pins, falling back to the vendored bounding box when
 * there is nothing to show. Padding keeps a pin's label inside the frame
 * rather than half off the edge.
 */
function fitView(points: [number, number][]): View {
  const bb = basemap.bbox;
  let west = bb.west;
  let east = bb.east;
  let south = bb.south;
  let north = bb.north;

  if (points.length > 0) {
    west = Math.min(...points.map((p) => p[0]));
    east = Math.max(...points.map((p) => p[0]));
    south = Math.min(...points.map((p) => p[1]));
    north = Math.max(...points.map((p) => p[1]));

    // A single pin has no extent of its own, so give it a neighbourhood to sit
    // in — roughly 3km, which is enough context to recognise where it is.
    const padX = Math.max((east - west) * 0.35, 0.02);
    const padY = Math.max((north - south) * 0.35, 0.013);
    west -= padX;
    east += padX;
    south -= padY;
    north += padY;
  }

  const minX = mercatorX(west);
  const minY = mercatorY(north);
  const spanX = mercatorX(east) - mercatorX(west);
  const spanY = mercatorY(north) - mercatorY(south);

  // One scale for both axes, so the map is never stretched, and `max` so the
  // geography covers the frame rather than leaving a band of bare water. The
  // viewBox crops whatever overflows.
  const scale = Math.max(WIDTH / spanX, HEIGHT / spanY);

  // Centre what is left over, so the pins sit in the middle of the frame
  // instead of hugging the top-left corner.
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;

  return { minX, minY, scale, offsetX, offsetY };
}

function project([lon, lat]: [number, number], view: View): [number, number] {
  // minY is the northern edge, and SVG y grows downward, so subtracting from it
  // gives a positive offset that increases as you move south.
  return [
    (mercatorX(lon) - view.minX) * view.scale + view.offsetX,
    (view.minY - mercatorY(lat)) * view.scale + view.offsetY,
  ];
}

function pathFor(ring: Ring, view: View, close = true): string {
  let d = '';
  for (let i = 0; i < ring.length; i += 1) {
    const [x, y] = project(ring[i]!, view);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return close ? `${d}Z` : d;
}

function ariaLabel(people: Whereabouts[]): string {
  const placed = people.filter((p) => p.placeName);
  if (placed.length === 0) return 'Map. No recorded locations.';
  return `Map. ${placed.map((p) => `${p.name} at ${p.placeName}`).join('; ')}.`;
}
