import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { ArrowRight, Check, FileText, Plus, Printer, X } from "lucide-react";
import { supabase } from "./lib/supabase";
import { manilaTime, manilaInputToUtc } from "./lib/time";
import { reverseAddress, roadRoute, searchAddress, type RoadRoute, type Stop } from "./lib/maps";
import { quotePrice } from "./lib/quotePrice";
import QuoteMap from "./QuoteMap";
import type { Driver, Profile, Role, Trip, Vehicle } from "./types";
import "./quotations.css";

type RateCard = {
  id: string;
  vehicle_type: string;
  base_charge: number;
  rate_per_km: number;
  margin_pct: number;
  tax_pct: number;
  active: boolean;
};
type Quotation = {
  id: string;
  quotation_number: string;
  customer_name: string;
  pickup_address: string;
  destination_address: string;
  pickup_at: string;
  cargo_details: string;
  vehicle_type: string;
  truck_count: number;
  distance_km: number;
  distance_source: "manual" | "map_estimate";
  base_charge: number;
  rate_per_km: number;
  margin_pct: number;
  tax_pct: number;
  estimated_cost: number;
  margin_amount: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  status:
    | "draft"
    | "pending_approval"
    | "approved"
    | "sent"
    | "accepted"
    | "rejected"
    | "converted";
  created_at: string;
};
type Line = {
  id: number;
  quotation_id: string;
  label: string;
  amount_per_truck: number;
  amount_total: number;
  basis: string;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    Number(value),
  );
const costs = [
  ["fuel", "Fuel estimate"],
  ["tolls", "Toll estimate"],
  ["labor", "Additional labor"],
  ["allowances", "Driver allowances"],
  ["loading", "Loading / unloading"],
  ["overnight", "Overnight fees"],
  ["other", "Other costs"],
] as const;

export default function QuotationsPanel({
  role,
  vehicles,
  drivers,
  profiles,
  trips,
  onDispatch,
}: {
  role: Role;
  vehicles: Vehicle[];
  drivers: Driver[];
  profiles: Profile[];
  trips: Trip[];
  onDispatch: () => void;
}) {
  const client = supabase!;
  const [section, setSection] = useState<"quotes" | "rates">("quotes");
  const [rates, setRates] = useState<RateCard[]>([]);
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [selected, setSelected] = useState<Quotation | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingRate, setEditingRate] = useState<RateCard | null>(null);
  const [assigning, setAssigning] = useState<{
    vehicles: string[];
    drivers: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const configuredMapKey = (import.meta.env.VITE_GEOAPIFY_KEY as string | undefined)?.trim() ?? "";
  const mapKey = configuredMapKey.startsWith("YOUR_") ? "" : configuredMapKey;
  const [pickupText, setPickupText] = useState("");
  const [destinationText, setDestinationText] = useState("");
  const [pickupStop, setPickupStop] = useState<Stop | null>(null);
  const [destinationStop, setDestinationStop] = useState<Stop | null>(null);
  const [searchSide, setSearchSide] = useState<"pickup" | "destination" | null>(null);
  const [suggestions, setSuggestions] = useState<Stop[]>([]);
  const [searching, setSearching] = useState(false);
  const [pinSide, setPinSide] = useState<"pickup" | "destination">("pickup");
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routing, setRouting] = useState(false);
  const [manualDistance, setManualDistance] = useState("");
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const canApprove = role === "owner" || role === "administrator";
  const configuredCompanyName = (
    import.meta.env.VITE_COMPANY_NAME as string | undefined
  )?.trim();
  const companyName =
    configuredCompanyName === "YOUR_REGISTERED_COMPANY_NAME"
      ? ""
      : configuredCompanyName;
  const load = useCallback(async () => {
    const [rateResult, quoteResult] = await Promise.all([
      client.from("rate_cards").select("*").order("vehicle_type"),
      client
        .from("quotations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const quoteIds = (quoteResult.data || []).map((quote) => quote.id);
    const lineResult = quoteIds.length
      ? await client
          .from("quotation_line_items")
          .select("*")
          .in("quotation_id", quoteIds)
          .order("id")
          .limit(900)
      : { data: [], error: null };
    const issue = rateResult.error || quoteResult.error || lineResult.error;
    if (issue) setError(issue.message);
    setRates((rateResult.data || []) as RateCard[]);
    setQuotes((quoteResult.data || []) as Quotation[]);
    setLines((lineResult.data || []) as Line[]);
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!creating || !mapKey || !searchSide) return;
    const text = searchSide === "pickup" ? pickupText : destinationText;
    if (text.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchAddress(text, mapKey, abort.signal)
        .then(setSuggestions)
        .catch((problem) => {
          if (!abort.signal.aborted) setLocationError(problem instanceof Error ? problem.message : "Address search failed.");
        })
        .finally(() => { if (!abort.signal.aborted) setSearching(false); });
    }, 500);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [creating, mapKey, searchSide, pickupText, destinationText]);
  useEffect(() => {
    if (!creating || !mapKey || !pickupStop || !destinationStop) {
      setRoute(null);
      return;
    }
    const abort = new AbortController();
    setRouting(true);
    setRoute(null);
    setLocationError("");
    void roadRoute(pickupStop, destinationStop, mapKey, abort.signal)
      .then(setRoute)
      .catch((problem) => {
        if (!abort.signal.aborted) setLocationError(problem instanceof Error ? problem.message : "Routing failed. Enter distance manually.");
      })
      .finally(() => { if (!abort.signal.aborted) setRouting(false); });
    return () => abort.abort();
  }, [creating, mapKey, pickupStop, destinationStop]);
  const selectedRate = rates.find((rate) => rate.active && rate.vehicle_type === draftValues.type);
  const distanceKm = route?.distanceKm ?? Number(manualDistance);
  const estimate = selectedRate && quotePrice(
    selectedRate,
    distanceKm,
    Number(draftValues.count ?? 1),
    costs.map(([id]) => Number(draftValues[id] ?? 0)),
    Number(draftValues.discount ?? 0),
  );
  const chooseStop = (side: "pickup" | "destination", stop: Stop) => {
    if (side === "pickup") { setPickupStop(stop); setPickupText(stop.address); }
    else { setDestinationStop(stop); setDestinationText(stop.address); }
    setSearchSide(null);
    setSuggestions([]);
    setLocationError("");
    setPinSide(side === "pickup" ? "destination" : "pickup");
  };
  const editAddress = (side: "pickup" | "destination", text: string) => {
    if (side === "pickup") { setPickupText(text); setPickupStop(null); }
    else { setDestinationText(text); setDestinationStop(null); }
    setRoute(null);
    setManualDistance("");
    setSuggestions([]);
    setSearchSide(side);
    setLocationError("");
  };
  const pickOnMap = (lat: number, lon: number) => {
    void (async () => {
      setLocating(true);
      setLocationError("");
      try {
        const stop = mapKey
          ? await reverseAddress(lat, lon, mapKey)
          : { address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
        chooseStop(pinSide, stop);
        setManualDistance("");
      } catch (problem) {
        setLocationError(problem instanceof Error ? problem.message : "Could not identify that point.");
      } finally {
        setLocating(false);
      }
    })();
  };
  const addressField = (side: "pickup" | "destination") => {
    const label = side === "pickup" ? "Pickup address" : "Destination address";
    const value = side === "pickup" ? pickupText : destinationText;
    return (
      <div className="route-field">
        <label>
          {label}
          <input
            name={side === "pickup" ? "pickup" : "destination"}
            value={value}
            onChange={(event) => editAddress(side, event.target.value)}
            onFocus={() => setSearchSide(side)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && suggestions[0] && searchSide === side) {
                event.preventDefault();
                chooseStop(side, suggestions[0]);
              }
            }}
            autoComplete="off"
            required
            minLength={3}
            aria-describedby={`${side}-hint`}
          />
        </label>
        <small id={`${side}-hint`}>{(side === "pickup" ? pickupStop : destinationStop) ? "Location selected" : "Type an address and choose a result, or pin it on the map."}</small>
        {searchSide === side && (searching || suggestions.length > 0) && (
          <div className="address-results" role="listbox" aria-label={`${label} matches`}>
            {searching && <span>Searching addresses…</span>}
            {!searching && suggestions.map((stop) => (
              <button key={`${stop.lat},${stop.lon}`} type="button" role="option" aria-selected="false" onClick={() => chooseStop(side, stop)}>{stop.address}</button>
            ))}
          </div>
        )}
      </div>
    );
  };
  const run = async (
    task: () => PromiseLike<{ error: { message: string } | null }>,
    success: string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await task();
      if (result.error) throw new Error(result.error.message);
      setNotice(success);
      await load();
      return true;
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Could not save quotation.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {
      vehicle_type: String(data.get("type")).trim(),
      base_charge: Number(data.get("base")),
      rate_per_km: Number(data.get("perkm")),
      margin_pct: Number(data.get("margin")),
      tax_pct: Number(data.get("tax")),
      active: data.get("active") === "on",
    };
    void (async () => {
      if (
        await run(
          () =>
            editingRate?.id
              ? client
                  .from("rate_cards")
                  .update(values)
                  .eq("id", editingRate.id)
              : client.from("rate_cards").insert(values),
          "Rate card saved.",
        )
      )
        setEditingRate(null);
    })();
  };
  const saveQuote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mapKey && (!pickupStop || !destinationStop)) {
      setLocationError("Choose a search result or pin both locations before saving.");
      return;
    }
    const data = new FormData(event.currentTarget);
    const mapped = !!(route && pickupStop && destinationStop);
    const args = {
      p_customer: String(data.get("customer")).trim(),
      p_pickup: String(data.get("pickup")).trim(),
      p_destination: String(data.get("destination")).trim(),
      p_vehicle_type: data.get("type"),
      p_truck_count: Number(data.get("count")),
      p_distance_km: distanceKm,
      p_pickup_at: manilaInputToUtc(String(data.get("pickup_at"))),
      p_cargo: String(data.get("cargo")).trim(),
      p_fuel: Number(data.get("fuel")),
      p_tolls: Number(data.get("tolls")),
      p_labor: Number(data.get("labor")),
      p_allowances: Number(data.get("allowances")),
      p_loading: Number(data.get("loading")),
      p_overnight: Number(data.get("overnight")),
      p_other: Number(data.get("other")),
      p_discount: Number(data.get("discount")),
    };
    void (async () => {
      if (
        await run(
          () =>
            client.rpc(mapped ? "create_map_quotation" : "create_quotation", mapped ? {
              ...args,
              p_pickup_lat: pickupStop!.lat,
              p_pickup_lon: pickupStop!.lon,
              p_destination_lat: destinationStop!.lat,
              p_destination_lon: destinationStop!.lon,
            } : args),
          "Quotation saved as draft.",
        )
      )
        setCreating(false);
    })();
  };
  const transition = (quote: Quotation, status: Quotation["status"]) =>
    void (async () => {
      if (
        await run(
          () =>
            client.rpc("transition_quotation", {
              p_id: quote.id,
              p_status: status,
            }),
          `Quotation marked ${status.replaceAll("_", " ")}.`,
        )
      )
        setSelected(null);
    })();
  const activeTrips = trips.filter(
    (trip) => !["completed", "cancelled"].includes(trip.status),
  );
  const availableVehicles = useMemo(
    () =>
      vehicles.filter(
        (vehicle) =>
          vehicle.status === "available" &&
          !activeTrips.some((trip) => trip.vehicle_id === vehicle.id),
      ),
    [vehicles, activeTrips],
  );
  const availableDrivers = useMemo(
    () =>
      drivers.filter(
        (driver) =>
          driver.active &&
          !activeTrips.some((trip) => trip.driver_id === driver.id),
      ),
    [drivers, activeTrips],
  );
  const convert = () => {
    if (!selected || !assigning) return;
    if (
      new Set(assigning.vehicles).size !== selected.truck_count ||
      new Set(assigning.drivers).size !== selected.truck_count ||
      assigning.vehicles.some((id) => !id) ||
      assigning.drivers.some((id) => !id)
    ) {
      setError(
        "Select a different available truck and driver for every assignment.",
      );
      return;
    }
    void (async () => {
      if (
        await run(
          () =>
            client.rpc("convert_quotation", {
              p_id: selected.id,
              p_vehicle_ids: assigning.vehicles,
              p_driver_ids: assigning.drivers,
            }),
          "Quotation converted into dispatches.",
        )
      ) {
        setSelected(null);
        setAssigning(null);
        onDispatch();
      }
    })();
  };
  const close = () => {
    setSelected(null);
    setCreating(false);
    setEditingRate(null);
    setAssigning(null);
    setError("");
  };
  const selectedLines = selected
    ? lines.filter((line) => line.quotation_id === selected.id)
    : [];

  return (
    <div className="quote-module">
      <div className="section-switch">
        <button
          className={section === "quotes" ? "active" : ""}
          onClick={() => setSection("quotes")}
        >
          Quotations
        </button>
        {canApprove && (
          <button
            className={section === "rates" ? "active" : ""}
            onClick={() => setSection("rates")}
          >
            Rate cards
          </button>
        )}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          <Check size={16} />
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss notice">
            <X size={16} />
          </button>
        </div>
      )}
      {section === "rates" && canApprove ? (
        <div className="panel">
          <div className="panel-head">
            <h2>Rate cards</h2>
            <button
              className="primary"
              onClick={() =>
                setEditingRate({
                  id: "",
                  vehicle_type: "",
                  base_charge: 0,
                  rate_per_km: 0,
                  margin_pct: 0,
                  tax_pct: 0,
                  active: true,
                })
              }
            >
              <Plus size={16} /> Add rate card
            </button>
          </div>
          <p className="panel-note">
            Configure your own base, distance, margin, and tax assumptions. No
            default Philippine rates are applied.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Truck type</th>
                  <th>Base</th>
                  <th>Per km</th>
                  <th>Margin</th>
                  <th>Tax</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={rate.id}>
                    <td>
                      <strong>{rate.vehicle_type}</strong>
                      {!rate.active && <small>Inactive</small>}
                    </td>
                    <td>{money(rate.base_charge)}</td>
                    <td>{money(rate.rate_per_km)}</td>
                    <td>{rate.margin_pct}%</td>
                    <td>{rate.tax_pct}%</td>
                    <td>
                      <button
                        className="row-action"
                        onClick={() => setEditingRate(rate)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="quote-intro">
            <div>
              <h2>Price every route with a clear breakdown.</h2>
              <p>
                Choose pickup and delivery on the map to estimate road distance.
                Rate cards calculate the price. Approval is required before a quote is sent.
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setPickupText(""); setDestinationText("");
                setPickupStop(null); setDestinationStop(null); setRoute(null);
                setManualDistance(""); setDraftValues({}); setSuggestions([]);
                setSearchSide(null); setPinSide("pickup"); setLocationError("");
                setCreating(true);
              }}
              disabled={!rates.some((rate) => rate.active)}
            >
              <Plus size={16} /> New quotation
            </button>
          </div>
          {!rates.some((rate) => rate.active) && (
            <div className="alert error">
              An owner or administrator must set up a rate card before quotes
              can be created.
            </div>
          )}
          <div className="panel">
            <div className="panel-head">
              <h2>Quotation register</h2>
              <span>{quotes.length} quotes</span>
            </div>
            {quotes.length === 0 ? (
              <div className="empty">
                <div>
                  <FileText size={27} />
                </div>
                <strong>No quotations yet</strong>
                <p>Create the first quote after adding a rate card.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Number / customer</th>
                      <th>Route</th>
                      <th>Trucks</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotes.map((quote) => (
                      <tr key={quote.id}>
                        <td>
                          <strong>{quote.quotation_number}</strong>
                          <small>{quote.customer_name}</small>
                        </td>
                        <td>
                          {quote.pickup_address}
                          <small>→ {quote.destination_address}</small>
                        </td>
                        <td>
                          {quote.truck_count} × {quote.vehicle_type}
                        </td>
                        <td>
                          <strong>{money(quote.total)}</strong>
                        </td>
                        <td>
                          <span
                            className={`status ${quote.status.replaceAll("_", "-")}`}
                          >
                            {quote.status.replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          <button
                            className="row-action"
                            onClick={() => {
                              setSelected(quote);
                              setAssigning(null);
                            }}
                          >
                            View <ArrowRight size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      {(creating || editingRate || selected) && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            className={`modal ${selected ? "quote-detail-modal" : creating ? "quote-create-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              selected
                ? "Quotation details"
                : editingRate
                  ? "Rate card"
                  : "New quotation"
            }
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">
                  {selected
                    ? selected.quotation_number
                    : editingRate
                      ? "Pricing settings"
                      : "New quotation"}
                </div>
                <h2>
                  {selected
                    ? selected.customer_name
                    : editingRate
                      ? "Rate card"
                      : "Create quotation"}
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={close}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="alert error modal-error" role="alert">
                {error}
              </div>
            )}
            {editingRate && (
              <form className="form-grid" onSubmit={saveRate}>
                <label className="wide">
                  Truck type
                  <input
                    name="type"
                    required
                    minLength={2}
                    defaultValue={editingRate.vehicle_type}
                    placeholder="10-wheeler"
                  />
                </label>
                <label>
                  Base charge (PHP)
                  <input
                    name="base"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={editingRate.base_charge}
                  />
                </label>
                <label>
                  Rate per km (PHP)
                  <input
                    name="perkm"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={editingRate.rate_per_km}
                  />
                </label>
                <label>
                  Margin (%)
                  <input
                    name="margin"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    defaultValue={editingRate.margin_pct}
                  />
                </label>
                <label>
                  Tax (%)
                  <input
                    name="tax"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    defaultValue={editingRate.tax_pct}
                  />
                </label>
                <label className="wide quote-active-label">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={editingRate.active}
                  />
                  Active for new quotations
                </label>
                <div className="form-actions">
                  <button type="button" className="secondary" onClick={close}>
                    Cancel
                  </button>
                  <button className="primary" disabled={busy}>
                    Save rate card
                  </button>
                </div>
              </form>
            )}
            {creating && (
              <form className="form-grid" onSubmit={saveQuote} onChange={(event) => {
                const target = event.target;
                if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement) && target.name)
                  setDraftValues((current) => ({ ...current, [target.name]: target.value }));
              }}>
                <label className="wide">
                  Customer
                  <input name="customer" required minLength={2} />
                </label>
                {addressField("pickup")}
                {addressField("destination")}
                <div className="wide quote-map-picker">
                  <div className="quote-map-toolbar">
                    <strong>Pin a location</strong>
                    <div role="group" aria-label="Location to pin">
                      <button type="button" className={pinSide === "pickup" ? "active" : ""} onClick={() => setPinSide("pickup")}>Pickup</button>
                      <button type="button" className={pinSide === "destination" ? "active" : ""} onClick={() => setPinSide("destination")}>Destination</button>
                    </div>
                  </div>
                  <QuoteMap pickup={pickupStop} destination={destinationStop} route={route} onPick={pickOnMap} />
                  <small>Click the map to set the selected point. {locating && "Finding address…"}</small>
                  {!mapKey && <p className="quote-map-notice">Add VITE_GEOAPIFY_KEY for address search and automatic road distance. You can still pin a map point and enter distance manually.</p>}
                  {locationError && <p className="quote-map-notice" role="alert">{locationError}</p>}
                </div>
                <label>
                  Truck type
                  <select name="type" required defaultValue="">
                    <option value="" disabled>
                      Select rate card
                    </option>
                    {rates
                      .filter((rate) => rate.active)
                      .map((rate) => (
                        <option key={rate.id} value={rate.vehicle_type}>
                          {rate.vehicle_type}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Number of trucks
                  <input
                    name="count"
                    type="number"
                    min="1"
                    max="50"
                    required
                    defaultValue="1"
                  />
                </label>
                <label>
                  Distance (km)
                  <input
                    name="distance"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={route ? route.distanceKm : manualDistance}
                    onChange={(event) => setManualDistance(event.target.value)}
                    readOnly={!!route}
                  />
                </label>
                <label>
                  Pickup date and time (Manila)
                  <input name="pickup_at" type="datetime-local" required />
                </label>
                <p className="quote-disclaimer wide">
                  {routing ? "Calculating truck road distance…" : route
                    ? "Truck road distance from Geoapify. Review the route, fuel, and toll estimates before approval."
                    : "Enter road distance manually if routing is unavailable."}
                </p>
                <label className="wide">
                  Cargo details
                  <input name="cargo" />
                </label>
                {costs.map(([id, label]) => (
                  <label key={id}>
                    {label} per truck (PHP)
                    <input
                      name={id}
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      defaultValue="0"
                    />
                  </label>
                ))}
                <label>
                  Discount for whole quote (PHP)
                  <input
                    name="discount"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue="0"
                  />
                </label>
                {estimate && <div className="wide quote-estimate" role="status">
                  <span>Estimated quote from {selectedRate?.vehicle_type} rate card · {distanceKm.toFixed(2)} km</span>
                  <strong>{money(estimate.total)}</strong>
                  <small>Final amount is calculated again by the database when saved.</small>
                </div>}
                <div className="form-actions">
                  <button type="button" className="secondary" onClick={close}>
                    Cancel
                  </button>
                  <button className="primary" disabled={busy || routing || locating}>
                    Calculate & save draft
                  </button>
                </div>
              </form>
            )}
            {selected && (
              <>
                <div className="print-sheet">
                  <div className="print-head">
                    <span className="print-brand">
                      {companyName || "Company name required"}
                    </span>
                    <div>
                      <h2>{selected.quotation_number}</h2>
                    </div>
                  </div>
                  <div className="quote-facts">
                    <div>
                      <small>Prepared for</small>
                      <strong>{selected.customer_name}</strong>
                    </div>
                    <div>
                      <small>Created</small>
                      <strong>{manilaTime(selected.created_at)}</strong>
                    </div>
                    <div>
                      <small>Status</small>
                      <strong>{selected.status.replaceAll("_", " ")}</strong>
                    </div>
                  </div>
                  <div className="quote-route">
                    <div>
                      <small>Pickup</small>
                      <strong>{selected.pickup_address}</strong>
                    </div>
                    <ArrowRight size={20} />
                    <div>
                      <small>Delivery</small>
                      <strong>{selected.destination_address}</strong>
                    </div>
                  </div>
                  <div className="quote-facts">
                    <div>
                      <small>Pickup schedule</small>
                      <strong>{manilaTime(selected.pickup_at)}</strong>
                    </div>
                    <div>
                      <small>Vehicles</small>
                      <strong>
                        {selected.truck_count} × {selected.vehicle_type}
                      </strong>
                    </div>
                    <div>
                      <small>Distance</small>
                      <strong>
                        {selected.distance_km} km / {selected.distance_source === "map_estimate" ? "truck road estimate" : "manual estimate"}
                      </strong>
                    </div>
                  </div>
                  {selected.cargo_details && (
                    <p className="quote-cargo">
                      Cargo: {selected.cargo_details}
                    </p>
                  )}
                  <div className="quote-breakdown">
                    <div className="quote-line heading">
                      <span>Cost component</span>
                      <span>Per truck</span>
                      <span>Total</span>
                    </div>
                    {selectedLines.map((line) => (
                      <div className="quote-line" key={line.id}>
                        <span>
                          {line.label}
                          <small>{line.basis}</small>
                        </span>
                        <span>{money(line.amount_per_truck)}</span>
                        <span>{money(line.amount_total)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="quote-totals">
                    <div>
                      <span>Estimated operating cost</span>
                      <strong>{money(selected.estimated_cost)}</strong>
                    </div>
                    <div>
                      <span>Margin ({selected.margin_pct}%)</span>
                      <strong>{money(selected.margin_amount)}</strong>
                    </div>
                    <div>
                      <span>Tax ({selected.tax_pct}%)</span>
                      <strong>{money(selected.tax_amount)}</strong>
                    </div>
                    <div>
                      <span>Discount</span>
                      <strong>−{money(selected.discount_amount)}</strong>
                    </div>
                    <div className="grand">
                      <span>Quoted price</span>
                      <strong>{money(selected.total)}</strong>
                    </div>
                  </div>
                  <p className="print-note">
                    Distance and manual cost entries are estimates. This
                    quotation is not an invoice or a record of collected
                    revenue.
                  </p>
                </div>
                <div className="quote-actions">
                  <button
                    className="secondary"
                    disabled={!companyName}
                    title={
                      !companyName
                        ? "Set VITE_COMPANY_NAME before printing"
                        : undefined
                    }
                    onClick={() => window.print()}
                  >
                    <Printer size={16} /> Print / save PDF
                  </button>
                  {selected.status === "draft" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => transition(selected, "pending_approval")}
                    >
                      Request approval
                    </button>
                  )}
                  {selected.status === "pending_approval" && canApprove && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => transition(selected, "approved")}
                    >
                      Approve quote
                    </button>
                  )}
                  {selected.status === "approved" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => transition(selected, "sent")}
                    >
                      Mark sent
                    </button>
                  )}
                  {selected.status === "sent" && (
                    <>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => transition(selected, "rejected")}
                      >
                        Mark rejected
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => transition(selected, "accepted")}
                      >
                        Mark accepted
                      </button>
                    </>
                  )}
                  {selected.status === "accepted" && (
                    <button
                      className="primary"
                      onClick={() =>
                        setAssigning({
                          vehicles: Array(selected.truck_count).fill(""),
                          drivers: Array(selected.truck_count).fill(""),
                        })
                      }
                    >
                      Convert to dispatch
                    </button>
                  )}
                </div>
                {assigning && (
                  <div className="convert-panel">
                    <h3>
                      Assign {selected.truck_count} truck
                      {selected.truck_count > 1 ? "s" : ""}
                    </h3>
                    <p>
                      Conversion is atomic. All selected vehicles and drivers
                      must be available.
                    </p>
                    {Array.from(
                      { length: selected.truck_count },
                      (_, index) => (
                        <div className="convert-row" key={index}>
                          <span>#{index + 1}</span>
                          <select
                            aria-label={`Truck ${index + 1}`}
                            value={assigning.vehicles[index]}
                            onChange={(event) =>
                              setAssigning((current) => {
                                if (!current) return current;
                                const vehicles = [...current.vehicles];
                                vehicles[index] = event.target.value;
                                return { ...current, vehicles };
                              })
                            }
                          >
                            <option value="">Select truck</option>
                            {availableVehicles
                              .filter(
                                (vehicle) =>
                                  vehicle.vehicle_type ===
                                  selected.vehicle_type,
                              )
                              .map((vehicle) => (
                                <option value={vehicle.id} key={vehicle.id}>
                                  {vehicle.plate_number}
                                </option>
                              ))}
                          </select>
                          <select
                            aria-label={`Driver ${index + 1}`}
                            value={assigning.drivers[index]}
                            onChange={(event) =>
                              setAssigning((current) => {
                                if (!current) return current;
                                const drivers = [...current.drivers];
                                drivers[index] = event.target.value;
                                return { ...current, drivers };
                              })
                            }
                          >
                            <option value="">Select driver</option>
                            {availableDrivers.map((driver) => (
                              <option value={driver.id} key={driver.id}>
                                {profiles.find(
                                  (profile) => profile.id === driver.id,
                                )?.full_name || driver.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      ),
                    )}
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={convert}
                    >
                      Create dispatches
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
