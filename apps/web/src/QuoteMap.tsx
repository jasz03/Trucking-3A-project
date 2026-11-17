import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { mapTiles, type RoadRoute, type Stop } from "./lib/maps";

export default function QuoteMap({
  pickup,
  destination,
  route,
  onPick,
}: {
  pickup: Stop | null;
  destination: Stop | null;
  route: RoadRoute | null;
  onPick: (lat: number, lon: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  const [tileError, setTileError] = useState(false);
  pick.current = onPick;
  const tile = mapTiles(
    import.meta.env.VITE_GEOAPIFY_KEY,
    import.meta.env.VITE_MAP_TILE_URL,
  );

  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current).setView([12.8797, 121.774], 6);
    L.tileLayer(tile.url, { attribution: tile.attribution, maxZoom: 18 })
      .on("tileerror", () => setTileError(true))
      .addTo(instance);
    instance.on("click", (event) => pick.current(event.latlng.lat, event.latlng.lng));
    map.current = instance;
    layers.current = L.layerGroup().addTo(instance);
    const timer = window.setTimeout(() => instance.invalidateSize(), 0);
    return () => {
      window.clearTimeout(timer);
      instance.remove();
      map.current = null;
      layers.current = null;
    };
  }, [tile.url, tile.attribution]);

  useEffect(() => {
    if (!map.current || !layers.current) return;
    layers.current.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    if (route) {
      const line = L.geoJSON(route.geojson as Parameters<typeof L.geoJSON>[0], {
        style: { color: "#1d694c", weight: 6, opacity: 0.9 },
      }).addTo(layers.current);
      bounds.push(...[line.getBounds().getSouthWest(), line.getBounds().getNorthEast()]);
    }
    for (const [stop, label, color] of [
      [pickup, "Pickup", "var(--success)"],
      [destination, "Destination", "var(--warning)"],
    ] as const) {
      if (!stop) continue;
      const point: L.LatLngExpression = [stop.lat, stop.lon];
      bounds.push(point);
      L.circleMarker(point, { radius: 8, color, fillColor: color, fillOpacity: 1, weight: 2 })
        .bindTooltip(label)
        .addTo(layers.current);
    }
    if (bounds.length > 1)
      map.current.fitBounds(L.latLngBounds(bounds), { padding: [35, 35], maxZoom: 14 });
    else if (bounds.length === 1) map.current.setView(bounds[0], 14);
  }, [pickup, destination, route]);

  return (
    <div className="quote-map-frame">
      <div className="quote-map" ref={host} aria-label="Select pickup or destination on map" />
      {route && <div className="quote-route-summary" role="status">
        <strong>Recommended truck route · {route.distanceKm.toFixed(2)} km</strong>
        {route.durationMinutes > 0 && <span>About {route.durationMinutes} min without live traffic</span>}
      </div>}
      {tileError && <div className="map-service-error" role="alert">Map tiles could not load. Check your map key or network connection.</div>}
    </div>
  );
}
