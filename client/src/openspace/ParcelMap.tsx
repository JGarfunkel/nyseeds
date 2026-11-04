import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { GeoJSON, LayersControl, MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import { fetchJson, STATUS_STYLE } from "./data";

interface Props {
  geoUrl: string;
  selectedId: string;
  statusById: Map<string, string>;
  fallbackCenter: [number, number] | null;
  onSelect: (id: string) => void;
}

const SELECTED: L.PathOptions = { color: "#1d4ed8", weight: 4, fillOpacity: 0.35, fillColor: "#3b82f6" };

export default function ParcelMap({ geoUrl, selectedId, statusById, fallbackCenter, onSelect }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["openspace-geo", geoUrl],
    queryFn: () => fetchJson<FeatureCollection>(geoUrl),
  });

  const { parcels, nypad } = useMemo(() => {
    const feats = data?.features ?? [];
    return {
      parcels: { type: "FeatureCollection", features: feats.filter((f) => f.properties?.layer === "parcel") } as FeatureCollection,
      nypad: { type: "FeatureCollection", features: feats.filter((f) => f.properties?.layer === "nypad") } as FeatureCollection,
    };
  }, [data]);

  const parcelStyle = (f?: Feature): L.PathOptions => {
    const id = f?.properties?.parcel_id;
    if (id === selectedId) return SELECTED;
    const fill = STATUS_STYLE[statusById.get(id) ?? ""]?.fill ?? "#6b7280";
    return { color: fill, weight: 1, fillColor: fill, fillOpacity: 0.18 };
  };

  const parcelLayer = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    parcelLayer.current?.setStyle(parcelStyle as L.StyleFunction);
    parcelLayer.current?.eachLayer((l) => {
      const f = (l as L.GeoJSON).feature as Feature | undefined;
      if (f?.properties?.parcel_id === selectedId) (l as L.Path).bringToFront();
    });
  });

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={fallbackCenter ?? [41.1, -73.8]}
        zoom={fallbackCenter ? 16 : 10}
        className="h-full w-full rounded-md"
        scrollWheelZoom
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Street map">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Aerial">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Esri, Maxar, Earthstar Geographics"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          {nypad.features.length > 0 && (
            <LayersControl.Overlay checked name="NYPAD protected areas">
              <GeoJSON
                key={`nypad-${geoUrl}`}
                data={nypad}
                style={{ color: "#15803d", weight: 1.5, dashArray: "4 4", fillOpacity: 0.05 }}
                onEachFeature={(f, layer) => {
                  const p = f.properties ?? {};
                  layer.bindTooltip(
                    [p.name, p.category, p.designation].filter(Boolean).join("<br>"),
                    { sticky: true },
                  );
                }}
              />
            </LayersControl.Overlay>
          )}
          {/* react-leaflet does not redraw a GeoJSON layer when `data` changes, so the
              layers mount only once the outlines have loaded. */}
          {parcels.features.length > 0 && (
            <LayersControl.Overlay checked name="Open space parcels">
              <GeoJSON
                key={`parcels-${geoUrl}`}
                ref={parcelLayer}
                data={parcels}
                style={parcelStyle}
                onEachFeature={(f, layer) => {
                  layer.on("click", () => onSelect(f.properties?.parcel_id));
                }}
              />
            </LayersControl.Overlay>
          )}
        </LayersControl>
        <FitToSelected parcels={parcels} selectedId={selectedId} fallbackCenter={fallbackCenter} />
      </MapContainer>
      {(isLoading || error) && (
        <div className="absolute left-2 bottom-2 z-[1000] rounded bg-white/90 px-2 py-1 text-xs text-gray-700 shadow">
          {isLoading ? "Loading parcel outlines…" : `Could not load outlines: ${(error as Error).message}`}
        </div>
      )}
    </div>
  );
}

function FitToSelected({
  parcels,
  selectedId,
  fallbackCenter,
}: {
  parcels: FeatureCollection;
  selectedId: string;
  fallbackCenter: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    const f = parcels.features.find((x) => x.properties?.parcel_id === selectedId);
    if (f) {
      map.fitBounds(L.geoJSON(f).getBounds(), { padding: [40, 40], maxZoom: 17 });
    } else if (fallbackCenter) {
      map.setView(fallbackCenter, 16);
    } else if (parcels.features.length) {
      map.fitBounds(L.geoJSON(parcels).getBounds(), { padding: [20, 20] });
    }
  }, [map, parcels, selectedId, fallbackCenter?.[0], fallbackCenter?.[1]]);
  // Leaflet needs a size check when its container appears or resizes.
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, [map, selectedId]);
  return null;
}
