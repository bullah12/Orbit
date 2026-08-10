'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { PersonAvatar } from './PersonAvatar';
import type { MapPerson } from './types';

/**
 * People, on a map.
 *
 * `ssr: false` and a dynamic import, so MapLibre — about 220 KB gzipped — is
 * fetched when somebody asks for the map and never lands in the Home bundle.
 * It cannot be server-rendered anyway: it wants a WebGL context.
 *
 * The loading state is the map's own ground colour rather than a spinner. The
 * shell is already correct — header, sheet, the honest count — and only the
 * tiles are outstanding.
 */
const MapCanvas = dynamic(() => import('./MapCanvas'), {
  ssr: false,
  loading: () => <div className="h-full w-full" style={{ background: 'var(--map-water)' }} />,
});

export type PlacelessPerson = {
  id: string;
  displayName: string;
  colour: string | null;
  spaceName: string;
};

export function PeopleMap({
  mappable,
  placeless,
}: {
  mappable: MapPerson[];
  /**
   * Everybody the map cannot draw. Passed in rather than counted, because the
   * row that names them opens the list of them — a number on its own would be
   * a dead end, and "some of your people are missing from this" is exactly the
   * kind of thing an interface should not make somebody take on trust.
   */
  placeless: PlacelessPerson[];
}) {
  // A list, not one id: several people can share an address, and their pins
  // then share a coordinate exactly — no amount of zoom separates them, so the
  // sheet has to be able to hold more than one.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showPlaceless, setShowPlaceless] = useState(false);
  const selected = mappable.filter((p) => selectedIds.includes(p.id));

  return (
    // The map is full-bleed and the sheet is positioned against this box, not
    // against the viewport — so the sheet stops at the bottom of the map rather
    // than sliding under the tab bar.
    <div className="relative min-h-0 flex-1">
      <MapCanvas people={mappable} selectedIds={selectedIds} onSelect={setSelectedIds} />

      <div className="sheet">
        {selected.length === 1 && (
          <PersonCard person={selected[0]!} onClose={() => setSelectedIds([])} />
        )}

        {selected.length > 1 && (
          <div className="hairline border-b">
            <div className="flex items-center gap-2 px-4 pt-3">
              <p className="section-label flex-1">
                {selected.length} people at {selected[0]!.placeName}
              </p>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                aria-label="Close"
                className="row-hover flex h-9 w-9 shrink-0 items-center justify-center rounded"
              >
                <Icon name="x" size={16} className="muted" />
              </button>
            </div>
            <ul className="mt-1">
              {selected.map((p) => (
                <li key={p.id} className="hairline border-t">
                  <button
                    type="button"
                    onClick={() => setSelectedIds([p.id])}
                    className="row-hover set-row w-full text-left"
                  >
                    <PersonAvatar name={p.displayName} colour={p.colour} size={28} />
                    <span className="min-w-0 flex-1 truncate text-sm">{p.displayName}</span>
                    <span className="faint shrink-0 text-xs">{p.spaceName}</span>
                    <Icon name="chevron" size={14} className="faint shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/*
          Permanent, whether or not a pin is selected, and whether or not the
          number is small. A map that draws eight of eleven people and says
          nothing has told a lie by omission — the three it dropped are exactly
          the ones somebody would go looking for.
        */}
        <button
          type="button"
          onClick={() => setShowPlaceless((v) => !v)}
          aria-expanded={showPlaceless}
          disabled={placeless.length === 0}
          className="row-hover set-row w-full text-left"
        >
          <Icon name="map_pin" size={16} className="faint shrink-0" />
          <span className="flex-1 text-sm">
            {placeless.length === 0
              ? 'Everybody here has a place'
              : `${placeless.length} ${placeless.length === 1 ? 'person has' : 'people have'} no place yet`}
          </span>
          {placeless.length > 0 && (
            <Icon
              name="chevron"
              size={14}
              className={showPlaceless ? 'faint -rotate-90' : 'faint rotate-90'}
            />
          )}
        </button>

        {showPlaceless && (
          <ul className="hairline border-t" id="people-without-a-place">
            {placeless.map((p) => (
              <li key={p.id} className="hairline border-b last:border-b-0">
                <Link href={`/people/${p.id}` as never} className="row-hover set-row">
                  <PersonAvatar name={p.displayName} colour={p.colour} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.displayName}</span>
                  <span className="faint shrink-0 text-xs">{p.spaceName}</span>
                  <Icon name="chevron" size={14} className="faint shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PersonCard({ person, onClose }: { person: MapPerson; onClose: () => void }) {
  return (
    <div className="hairline border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <PersonAvatar name={person.displayName} colour={person.colour} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium">{person.displayName}</p>
          <p className="muted truncate text-sm">
            {person.placeAddress ?? person.placeName}
            {/*
              The qualifier. What is on screen is the *place's* address, not
              something recorded against the person — so somebody reading
              "14 Maple Road" knows where it came from and where to go to
              change it. Without this the map quietly claims to hold addresses
              it does not have.
            */}
            <span className="faint"> · via {person.placeName}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="row-hover flex h-9 w-9 shrink-0 items-center justify-center rounded"
        >
          <Icon name="x" size={16} className="muted" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/people/${person.id}` as never}
          className="btn flex-1 rounded px-3 py-2.5 text-center text-sm font-medium btn-primary"
        >
          Open {person.displayName}’s page
        </Link>
        {/*
          OpenStreetMap, not Google: Orbit already geocodes through Nominatim
          and routes through OpenRouteService, and sending somebody's home
          address to a third party they have not chosen is not something a
          directions button should do quietly.
        */}
        <a
          href={`https://www.openstreetmap.org/directions?to=${person.lat}%2C${person.lon}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Directions to ${person.placeName}`}
          className="hairline btn flex h-11 w-11 shrink-0 items-center justify-center rounded border"
        >
          <Icon name="route" size={18} className="muted" />
        </a>
      </div>
    </div>
  );
}
