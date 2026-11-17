import test from "node:test";
import assert from "node:assert/strict";
import { mapTiles, roadRoute, searchAddress } from "./maps.ts";
import { quotePrice } from "./quotePrice.ts";

test("free test tiles work without a key and a key selects Geoapify", () => {
  assert.match(mapTiles().url, /tile\.openstreetmap\.org/);
  assert.match(mapTiles("test-key").url, /maps\.geoapify\.com/);
});

test("address search is Philippine-scoped and truck routing uses road meters", async () => {
  const originalFetch = globalThis.fetch;
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("search"))
      return new Response(JSON.stringify({ results: [{ formatted: "Manila Port", lat: 14.59, lon: 120.97 }] }), { status: 200 });
    return new Response(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { distance: 4286, time: 780 }, geometry: { type: "LineString", coordinates: [[120.97, 14.59], [120.89, 14.48]] } }] }), { status: 200 });
  };
  try {
    const [pickup] = await searchAddress("Manila Port", "test-key");
    const route = await roadRoute(pickup, { address: "Cavite", lat: 14.48, lon: 120.89 }, "test-key");
    assert.equal(requests[0].searchParams.get("filter"), "countrycode:ph");
    assert.equal(requests[1].searchParams.get("mode"), "truck");
    assert.equal(requests[1].searchParams.get("type"), "balanced");
    assert.equal(requests[1].searchParams.get("units"), "metric");
    assert.equal(requests[1].searchParams.get("waypoints"), "14.59,120.97|14.48,120.89");
    assert.equal(route.distanceKm, 4.29);
    assert.equal(route.durationMinutes, 13);
  } finally { globalThis.fetch = originalFetch; }
});

test("quote preview mirrors rate card calculation", () => {
  assert.deepEqual(quotePrice({ base_charge: 1000, rate_per_km: 25, margin_pct: 10, tax_pct: 12 }, 100, 2, [400, 100, 200, 50, 75, 0, 25], 0),
    { cost: 8700, margin: 870, tax: 1148.4, total: 10718.4 });
});
