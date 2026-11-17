export type Stop = { address: string; lat: number; lon: number };
export type RoadRoute = {
  distanceKm: number;
  durationMinutes: number;
  geojson: { type: "FeatureCollection"; features: unknown[] };
};

export function mapTiles(key?: string, customUrl?: string) {
  if (key && !key.startsWith("YOUR_"))
    return {
      url: `https://maps.geoapify.com/v1/tile/osm-bright-smooth/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(key)}`,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://www.geoapify.com/">Geoapify</a>',
    };
  if (customUrl && !customUrl.includes("YOUR_"))
    return {
      url: customUrl,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | configured tile provider',
    };
  // shortcut: public OSM tiles are for light interactive testing; use a hosted key for regular business traffic.
  return {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}

async function getJson(url: URL, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Map free-tier limit reached. Try again later."
        : `Map service returned ${response.status}. Check the Geoapify key and its allowed origins.`,
    );
  return response.json();
}

function toStop(value: unknown): Stop | null {
  if (!value || typeof value !== "object") return null;
  const place = value as { formatted?: unknown; lat?: unknown; lon?: unknown };
  if (
    typeof place.formatted !== "string" ||
    typeof place.lat !== "number" ||
    typeof place.lon !== "number" ||
    !Number.isFinite(place.lat) ||
    !Number.isFinite(place.lon) ||
    Math.abs(place.lat) > 90 ||
    Math.abs(place.lon) > 180
  )
    return null;
  return { address: place.formatted, lat: place.lat, lon: place.lon };
}

export async function searchAddress(text: string, key: string, signal?: AbortSignal) {
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.search = new URLSearchParams({
    text: text.trim(),
    filter: "countrycode:ph",
    format: "json",
    limit: "5",
    apiKey: key,
  }).toString();
  const data = (await getJson(url, signal)) as { results?: unknown[] };
  return (data.results ?? []).map(toStop).filter((stop): stop is Stop => !!stop);
}

export async function reverseAddress(lat: number, lon: number, key: string, signal?: AbortSignal) {
  const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
  url.search = new URLSearchParams({
    lat: String(lat), lon: String(lon), format: "json", limit: "1", apiKey: key,
  }).toString();
  const data = (await getJson(url, signal)) as { results?: unknown[] };
  return toStop(data.results?.[0]) ?? {
    address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lat,
    lon,
  };
}

export async function roadRoute(from: Stop, to: Stop, key: string, signal?: AbortSignal): Promise<RoadRoute> {
  const url = new URL("https://api.geoapify.com/v1/routing");
  url.search = new URLSearchParams({
    waypoints: `${from.lat},${from.lon}|${to.lat},${to.lon}`,
    mode: "truck",
    type: "balanced",
    units: "metric",
    format: "geojson",
    apiKey: key,
  }).toString();
  const data = (await getJson(url, signal)) as RoadRoute["geojson"] & {
    features?: { properties?: { distance?: number; time?: number }; geometry?: unknown }[];
  };
  const distance = data.features?.[0]?.properties?.distance;
  const seconds = data.features?.[0]?.properties?.time;
  if (!Number.isFinite(distance) || !distance || distance <= 0 || !data.features?.[0]?.geometry)
    throw new Error("No truck route found between these points. Check the pins or enter distance manually.");
  return {
    distanceKm: Math.max(0.01, Math.round(distance / 10) / 100),
    durationMinutes: typeof seconds === "number" && Number.isFinite(seconds) ? Math.round(seconds / 60) : 0,
    geojson: data,
  };
}
