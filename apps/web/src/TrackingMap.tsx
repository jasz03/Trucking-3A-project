import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Point, Trip, Vehicle } from "./types";
import { freshness, manilaTime } from "./lib/time";
import { mapTiles } from "./lib/maps";

export default function TrackingMap({
  points,
  trips,
  vehicles,
}: {
  points: Point[];
  trips: Trip[];
  vehicles: Vehicle[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const [tileError, setTileError] = useState(false);
  const tile = mapTiles(
    import.meta.env.VITE_GEOAPIFY_KEY,
    import.meta.env.VITE_MAP_TILE_URL,
  );

  useEffect(() => {
    if (!host.current || map.current) return;
    const instance = L.map(host.current, { zoomControl: false }).setView(
      [12.8797, 121.774],
      6,
    );
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    L.tileLayer(tile.url, { attribution: tile.attribution, maxZoom: 18 })
      .on("tileerror", () => setTileError(true))
      .addTo(instance);
    map.current = instance;
    markers.current = L.layerGroup().addTo(instance);
    return () => {
      instance.remove();
      map.current = null;
      markers.current = null;
    };
  }, [tile.url, tile.attribution]);

  useEffect(() => {
    if (!markers.current || !map.current) return;
    markers.current.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const point of points) {
      const trip = trips.find((item) => item.id === point.trip_id);
      const plate =
        vehicles.find((item) => item.id === trip?.vehicle_id)?.plate_number ??
        "Truck";
      const active = trip && !["completed", "cancelled"].includes(trip.status);
      const signal = active ? freshness(point.received_at) : "Last known";
      const location: L.LatLngExpression = [point.latitude, point.longitude];
      bounds.push(location);
      L.marker(location, {
        icon: L.divIcon({
          className: `truck-pin ${signal === "Live" ? "" : "stale"}`,
          html: "<span></span>",
          iconSize: [20, 20],
        }),
      })
        .bindPopup(
          `<strong>${plate.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</strong><br>${signal} · received ${manilaTime(point.received_at)}`,
        )
        .addTo(markers.current);
    }
    if (bounds.length)
      map.current.fitBounds(L.latLngBounds(bounds), {
        padding: [50, 50],
        maxZoom: 12,
      });
  }, [points, trips, vehicles]);

  return (
    <div className="map-frame">
      <div className="map" ref={host} aria-label="Latest truck locations on map" />
      {tileError && <div className="map-service-error" role="alert">Map tiles could not load. Check your map key or network connection.</div>}
    </div>
  );
}
