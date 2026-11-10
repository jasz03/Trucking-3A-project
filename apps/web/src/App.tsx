import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  Plus,
  RefreshCw,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import { configured, supabase } from "./lib/supabase";
import { freshness, manilaTime } from "./lib/time";
import TrackingMap from "./TrackingMap";
import AccessPanel from "./AccessPanel";
import { ResetPassword, SignIn } from "./AuthScreen";
import type {
  Attendance,
  Driver,
  Point,
  Profile,
  Role,
  Trip,
  Vehicle,
} from "./types";

type Tab =
  | "overview"
  | "dispatch"
  | "tracking"
  | "vehicles"
  | "drivers"
  | "attendance"
  | "access";
const staff = (role: Role, allowed: Role[]) => allowed.includes(role);
const title: Record<Tab, string> = {
  overview: "Operations overview",
  dispatch: "Dispatch board",
  tracking: "Live fleet",
  vehicles: "Vehicles",
  drivers: "Drivers",
  attendance: "Attendance",
  access: "Users & access",
};
const description: Record<Tab, string> = {
  overview: "A clear view of what is moving today.",
  dispatch: "Plan and follow every assignment.",
  tracking: "Latest reported locations, with honest timestamps.",
  vehicles: "The trucks your team can dispatch.",
  drivers: "People trusted with your fleet.",
  attendance: "Photo records waiting for review.",
  access: "Roles and account status.",
};

export default function App() {
  if (!configured || !supabase)
    return (
      <div className="setup">
        <div className="setup-mark">H</div>
        <h1>Connect your operations backend</h1>
        <p>
          Add the Supabase URL and anon key to <code>apps/web/.env.local</code>,
          then restart the app. See the README for setup.
        </p>
      </div>
    );
  return <ConnectedApp />;
}

function ConnectedApp() {
  const client = supabase!;
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<"vehicle" | "driver" | "trip" | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);

  useEffect(() => {
    client.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    client
      .from("profiles")
      .select("id,full_name,role,active")
      .eq("id", user.id)
      .single()
      .then(({ data, error: issue }) => {
        setProfile(data as Profile | null);
        setError(issue?.message ?? "");
        setLoading(false);
      });
  }, [client, user]);
  useEffect(() => {
    if (profile?.role === "hr" && tab === "overview") setTab("attendance");
  }, [profile, tab]);

  const load = useCallback(async () => {
    if (!profile) return;
    const results = await Promise.all([
      client.from("vehicles").select("*").order("plate_number"),
      client
        .from("drivers")
        .select("*")
        .order("created_at", { ascending: false }),
      client
        .from("profiles")
        .select("id,full_name,role,active")
        .order("full_name"),
      client
        .from("trips")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      client.from("latest_locations").select("*"),
      client
        .from("attendance")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(100),
    ]);
    const issue = results.find((result) => result.error)?.error;
    if (issue) setError(issue.message);
    setVehicles((results[0].data ?? []) as Vehicle[]);
    setDrivers((results[1].data ?? []) as Driver[]);
    setProfiles((results[2].data ?? []) as Profile[]);
    setTrips((results[3].data ?? []) as Trip[]);
    setPoints((results[4].data ?? []) as Point[]);
    setAttendance((results[5].data ?? []) as Attendance[]);
  }, [client, profile]);

  useEffect(() => {
    void load();
  }, [load, refresh]);
  useEffect(() => {
    if (tab !== "tracking" && tab !== "overview") return;
    const timer = window.setInterval(
      () => setRefresh((value) => value + 1),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [tab]);

  const profileName = (id: string) =>
    profiles.find((item) => item.id === id)?.full_name || "Unnamed user";
  const plate = (id: string) =>
    vehicles.find((item) => item.id === id)?.plate_number || "Unknown truck";
  const activeTrips = trips.filter(
    (item) => !["completed", "cancelled"].includes(item.status),
  );
  const latestByVehicle = useMemo(() => {
    const byVehicle = new Map<string, Point>();
    for (const point of points) {
      const vehicleId = trips.find(
        (trip) => trip.id === point.trip_id,
      )?.vehicle_id;
      if (!vehicleId) continue;
      const previous = byVehicle.get(vehicleId);
      if (!previous || point.received_at > previous.received_at)
        byVehicle.set(vehicleId, point);
    }
    return byVehicle;
  }, [points, trips]);
  const availableVehicles = vehicles.filter(
    (item) =>
      item.status === "available" &&
      !activeTrips.some((trip) => trip.vehicle_id === item.id),
  );
  const availableDrivers = drivers.filter(
    (item) =>
      item.active && !activeTrips.some((trip) => trip.driver_id === item.id),
  );
  const nav: { id: Tab; icon: typeof Truck; show: boolean }[] = [
    {
      id: "overview",
      icon: LayoutDashboard,
      show: staff(profile?.role ?? "driver", [
        "owner",
        "administrator",
        "fleet_manager",
        "dispatcher",
      ]),
    },
    {
      id: "dispatch",
      icon: ClipboardList,
      show: staff(profile?.role ?? "driver", [
        "owner",
        "administrator",
        "fleet_manager",
        "dispatcher",
      ]),
    },
    {
      id: "tracking",
      icon: MapPinned,
      show: staff(profile?.role ?? "driver", [
        "owner",
        "administrator",
        "fleet_manager",
        "dispatcher",
      ]),
    },
    {
      id: "vehicles",
      icon: Truck,
      show: staff(profile?.role ?? "driver", [
        "owner",
        "administrator",
        "fleet_manager",
        "dispatcher",
      ]),
    },
    {
      id: "drivers",
      icon: Users,
      show: staff(profile?.role ?? "driver", [
        "owner",
        "administrator",
        "fleet_manager",
        "dispatcher",
        "hr",
      ]),
    },
    {
      id: "attendance",
      icon: CalendarDays,
      show: staff(profile?.role ?? "driver", ["owner", "administrator", "hr"]),
    },
    {
      id: "access",
      icon: ShieldCheck,
      show: staff(profile?.role ?? "driver", ["owner", "administrator"]),
    },
  ];

  const act = async (
    run: () => PromiseLike<{ error: { message: string } | null }>,
    success: string,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await run();
      if (result.error) throw new Error(result.error.message);
      setNotice(success);
      setForm(null);
      setRefresh((value) => value + 1);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Could not save. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitVehicle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {
      plate_number: String(data.get("plate")).trim().toUpperCase(),
      vehicle_type: String(data.get("type")).trim(),
      make_model: String(data.get("model")).trim(),
      capacity_kg: data.get("capacity") ? Number(data.get("capacity")) : null,
      status: data.get("status"),
    };
    void act(
      () =>
        editingVehicle
          ? client.from("vehicles").update(values).eq("id", editingVehicle.id)
          : client.from("vehicles").insert(values),
      editingVehicle ? "Truck updated." : "Truck added.",
    );
  };
  const submitDriver = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values = {
      license_number: String(data.get("license")).trim(),
      license_expires_on: data.get("expiry"),
      phone: String(data.get("phone")).trim(),
    };
    void act(
      () =>
        editingDriver
          ? client.from("drivers").update(values).eq("id", editingDriver.id)
          : client
              .from("drivers")
              .insert({ id: data.get("profile"), ...values }),
      editingDriver ? "Driver updated." : "Driver record added.",
    );
  };
  const submitTrip = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(
      () =>
        client.rpc("create_dispatch", {
          p_customer: String(data.get("customer")).trim(),
          p_pickup: String(data.get("pickup")).trim(),
          p_destination: String(data.get("destination")).trim(),
          p_scheduled_at: new Date(String(data.get("scheduled"))).toISOString(),
          p_vehicle_id: data.get("vehicle"),
          p_driver_id: data.get("driver"),
          p_cargo: String(data.get("cargo")).trim(),
          p_instructions: String(data.get("instructions")).trim(),
        }),
      "Trip assigned. The driver can now see it.",
    );
  };

  if (!user)
    return (
      <SignIn
        onSubmit={async (email, password) => {
          const { error: issue } = await client.auth.signInWithPassword({
            email,
            password,
          });
          if (issue) throw issue;
        }}
        onReset={async (email) => {
          const { error: issue } = await client.auth.resetPasswordForEmail(
            email,
            { redirectTo: window.location.origin },
          );
          if (issue) throw issue;
        }}
      />
    );
  if (recovery)
    return (
      <ResetPassword
        onSubmit={async (password) => {
          const { error: issue } = await client.auth.updateUser({ password });
          if (issue) throw issue;
          setRecovery(false);
        }}
      />
    );
  if (loading)
    return (
      <div className="setup">
        <div className="spinner" />
        Loading your workspace…
      </div>
    );
  if (!profile?.active)
    return (
      <div className="setup">
        <h1>Account access is unavailable</h1>
        <p>Ask your administrator to activate your profile.</p>
        <button onClick={() => void client.auth.signOut()}>Sign out</button>
      </div>
    );
  if (profile.role === "driver")
    return (
      <div className="setup">
        <h1>Driver account</h1>
        <p>
          Use the driver mobile application to view trips, share location, and
          submit attendance.
        </p>
        <button onClick={() => void client.auth.signOut()}>Sign out</button>
      </div>
    );

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-icon">
            H<span>.</span>
          </span>
          <span>
            <strong>HAULMARK</strong>
            <small>OPERATIONS SYSTEM</small>
          </span>
          <button
            className="mobile-close icon-button"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          {nav
            .filter((item) => item.show)
            .map(({ id, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${tab === id ? "selected" : ""}`}
                onClick={() => {
                  setTab(id);
                  setMenuOpen(false);
                  setError("");
                }}
              >
                <Icon size={18} />
                <span>
                  {title[id].replace("Operations ", "").replace("Users & ", "")}
                </span>
                {id === "attendance" &&
                  attendance.filter((item) => item.review_status === "pending")
                    .length > 0 && (
                    <em>
                      {
                        attendance.filter(
                          (item) => item.review_status === "pending",
                        ).length
                      }
                    </em>
                  )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">
            {profile.full_name.charAt(0).toUpperCase() || "U"}
          </div>
          <div className="account">
            <strong>{profile.full_name || user.email}</strong>
            <span>{profile.role.replace("_", " ")}</span>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void client.auth.signOut()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
          <span>
            FLEET OPERATIONS <span className="topbar-divider">/</span>{" "}
            {title[tab].toUpperCase()}
          </span>
          <div className="topbar-right">
            <span className="online-dot" /> SYSTEM READY{" "}
            <button
              className="icon-button refresh"
              aria-label="Refresh data"
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">HAULMARK / {tab.toUpperCase()}</div>
              <h1>{title[tab]}</h1>
              <p>{description[tab]}</p>
            </div>
            <div className="heading-actions">
              {tab === "vehicles" &&
                staff(profile.role, [
                  "owner",
                  "administrator",
                  "fleet_manager",
                ]) && (
                  <button
                    className="primary"
                    onClick={() => {
                      setEditingVehicle(null);
                      setForm("vehicle");
                    }}
                  >
                    <Plus size={17} /> Add truck
                  </button>
                )}
              {tab === "drivers" &&
                staff(profile.role, [
                  "owner",
                  "administrator",
                  "fleet_manager",
                  "hr",
                ]) && (
                  <button
                    className="primary"
                    onClick={() => {
                      setEditingDriver(null);
                      setForm("driver");
                    }}
                  >
                    <Plus size={17} /> Add driver
                  </button>
                )}
              {tab === "dispatch" &&
                staff(profile.role, [
                  "owner",
                  "administrator",
                  "dispatcher",
                ]) && (
                  <button className="primary" onClick={() => setForm("trip")}>
                    <Plus size={17} /> New dispatch
                  </button>
                )}
            </div>
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
              <Check size={17} />
              {notice}
              <button onClick={() => setNotice("")} aria-label="Dismiss notice">
                <X size={16} />
              </button>
            </div>
          )}

          {tab === "overview" && (
            <>
              <div className="hero">
                <div>
                  <div className="hero-label">
                    <span className="pulse" /> LIVE OPERATIONS
                  </div>
                  <h2>
                    Keep the whole fleet
                    <br />
                    <i>in motion.</i>
                  </h2>
                  <p>
                    Real records from your dispatch and driver activity. Updated
                    every 15 seconds while this page is open.
                  </p>
                  <button onClick={() => setTab("dispatch")}>
                    Open dispatch board <ArrowRight size={17} />
                  </button>
                </div>
                <div className="hero-graphic">
                  <div className="radar r1" />
                  <div className="radar r2" />
                  <div className="radar r3" />
                  <div className="hero-truck">
                    <Truck size={44} strokeWidth={1.4} />
                  </div>
                </div>
              </div>
              <div className="stats">
                <Stat
                  label="REGISTERED TRUCKS"
                  value={vehicles.length}
                  detail={`${vehicles.filter((item) => item.status === "available").length} operational`}
                  icon={Truck}
                />
                <Stat
                  label="ACTIVE TRIPS"
                  value={activeTrips.length}
                  detail="Assigned or in progress"
                  icon={Activity}
                />
                <Stat
                  label="DRIVERS"
                  value={drivers.filter((item) => item.active).length}
                  detail="Active records"
                  icon={Users}
                />
                <Stat
                  label="ATTENDANCE TO REVIEW"
                  value={
                    attendance.filter(
                      (item) => item.review_status === "pending",
                    ).length
                  }
                  detail="Pending HR action"
                  icon={CalendarDays}
                />
              </div>
              <div className="section-head">
                <div>
                  <h2>Current assignments</h2>
                  <p>Trucks and drivers on active trips</p>
                </div>
                <button
                  className="text-action"
                  onClick={() => setTab("dispatch")}
                >
                  View all <ArrowRight size={16} />
                </button>
              </div>
              <TripTable
                trips={activeTrips.slice(0, 5)}
                plate={plate}
                profileName={profileName}
              />
            </>
          )}

          {tab === "dispatch" && (
            <>
              <div className="summary-row">
                <span>
                  <span className="mini-dot amber" />
                  {activeTrips.length} active
                </span>
                <span>
                  <span className="mini-dot green" />
                  {
                    trips.filter((item) => item.status === "completed").length
                  }{" "}
                  completed
                </span>
                <span>
                  <span className="mini-dot gray" />
                  {availableVehicles.length} trucks available
                </span>
              </div>
              <TripTable
                trips={trips}
                plate={plate}
                profileName={profileName}
                onCancel={
                  staff(profile.role, ["owner", "administrator", "dispatcher"])
                    ? (trip) => {
                        if (
                          window.confirm(
                            `Cancel the assignment for ${trip.customer_name}?`,
                          )
                        )
                          void act(
                            () =>
                              client.rpc("cancel_trip", {
                                p_trip_id: trip.id,
                                p_note: "Cancelled from dispatch board",
                              }),
                            "Trip cancelled. Truck and driver are available again.",
                          );
                      }
                    : undefined
                }
              />
            </>
          )}

          {tab === "tracking" && (
            <>
              <div className="map-panel">
                <div className="map-panel-title">
                  <div>
                    <h2>Fleet positions</h2>
                    <p>Only driver-submitted points appear here.</p>
                  </div>
                  <span className="live-badge">
                    <span className="pulse" /> Refreshes every 15s
                  </span>
                </div>
                <TrackingMap
                  points={Array.from(latestByVehicle.values())}
                  trips={trips}
                  vehicles={vehicles}
                />
              </div>
              <div className="section-head">
                <div>
                  <h2>Latest check-ins</h2>
                  <p>Stale data is always marked last known.</p>
                </div>
              </div>
              <div className="tracking-list">
                {vehicles.length === 0 ? (
                  <Empty
                    icon={MapPinned}
                    message="No trucks to track"
                    detail="Register a truck to start the fleet view."
                  />
                ) : (
                  vehicles.map((vehicle) => {
                    const trip = activeTrips.find(
                      (item) => item.vehicle_id === vehicle.id,
                    );
                    const point = latestByVehicle.get(vehicle.id);
                    const state = trip
                      ? freshness(point?.received_at ?? null)
                      : point
                        ? "Last known"
                        : "No signal";
                    return (
                      <div className="tracking-card" key={vehicle.id}>
                        <div className="truck-avatar">
                          <Truck size={22} />
                        </div>
                        <div className="tracking-main">
                          <strong>{vehicle.plate_number}</strong>
                          <span>
                            {trip
                              ? `${profileName(trip.driver_id)} · ${trip.destination_address}`
                              : vehicle.status}
                          </span>
                        </div>
                        <div className="tracking-meta">
                          <strong
                            className={`signal ${state === "Live" ? "is-live" : ""}`}
                          >
                            {state}
                          </strong>
                          <span>
                            {point
                              ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)} · ±${Math.round(point.accuracy_m)}m`
                              : "No location reported"}
                            {point ? ` · ${manilaTime(point.received_at)}` : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {tab === "vehicles" && (
            <div className="panel">
              <div className="panel-head">
                <h2>Fleet register</h2>
                <span>{vehicles.length} trucks</span>
              </div>
              {vehicles.length === 0 ? (
                <Empty
                  icon={Truck}
                  message="No trucks registered"
                  detail="Add the first truck to make it available for dispatch."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>PLATE NUMBER</th>
                        <th>VEHICLE</th>
                        <th>CAPACITY</th>
                        <th>AVAILABILITY</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicles.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.plate_number}</strong>
                          </td>
                          <td>
                            {item.vehicle_type}
                            <small>{item.make_model}</small>
                          </td>
                          <td>
                            {item.capacity_kg
                              ? `${Number(item.capacity_kg).toLocaleString()} kg`
                              : "—"}
                          </td>
                          <td>
                            <Status
                              value={
                                activeTrips.some(
                                  (trip) => trip.vehicle_id === item.id,
                                )
                                  ? "assigned"
                                  : item.status
                              }
                            />
                          </td>
                          <td>
                            {staff(profile.role, [
                              "owner",
                              "administrator",
                              "fleet_manager",
                            ]) && (
                              <>
                                <select
                                  aria-label={`Status of ${item.plate_number}`}
                                  value={item.status}
                                  disabled={
                                    busy ||
                                    activeTrips.some(
                                      (trip) => trip.vehicle_id === item.id,
                                    )
                                  }
                                  onChange={(event) =>
                                    void act(
                                      () =>
                                        client
                                          .from("vehicles")
                                          .update({
                                            status: event.target.value,
                                          })
                                          .eq("id", item.id),
                                      "Truck status updated.",
                                    )
                                  }
                                >
                                  <option value="available">Available</option>
                                  <option value="maintenance">
                                    Maintenance
                                  </option>
                                  <option value="inactive">Inactive</option>
                                </select>
                                <button
                                  className="row-action"
                                  onClick={() => {
                                    setEditingVehicle(item);
                                    setForm("vehicle");
                                  }}
                                >
                                  Edit
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "drivers" && (
            <div className="panel">
              <div className="panel-head">
                <h2>Driver directory</h2>
                <span>{drivers.length} records</span>
              </div>
              {drivers.length === 0 ? (
                <Empty
                  icon={Users}
                  message="No drivers registered"
                  detail="Invite a user in Users & access, then add their license record here."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>DRIVER</th>
                        <th>LICENSE</th>
                        <th>EXPIRY</th>
                        <th>STATUS</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {drivers.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{profileName(item.id)}</strong>
                            <small>{item.phone || "No phone"}</small>
                          </td>
                          <td>{item.license_number}</td>
                          <td>{item.license_expires_on}</td>
                          <td>
                            <Status
                              value={
                                item.active
                                  ? activeTrips.some(
                                      (trip) => trip.driver_id === item.id,
                                    )
                                    ? "assigned"
                                    : "active"
                                  : "inactive"
                              }
                            />
                          </td>
                          <td>
                            {staff(profile.role, [
                              "owner",
                              "administrator",
                              "fleet_manager",
                              "hr",
                            ]) && (
                              <>
                                <button
                                  className="row-action"
                                  disabled={
                                    busy ||
                                    activeTrips.some(
                                      (trip) => trip.driver_id === item.id,
                                    )
                                  }
                                  onClick={() =>
                                    void act(
                                      () =>
                                        client
                                          .from("drivers")
                                          .update({ active: !item.active })
                                          .eq("id", item.id),
                                      "Driver status updated.",
                                    )
                                  }
                                >
                                  {item.active ? "Deactivate" : "Activate"}
                                </button>
                                <button
                                  className="row-action"
                                  onClick={() => {
                                    setEditingDriver(item);
                                    setForm("driver");
                                  }}
                                >
                                  Edit
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "attendance" && (
            <div className="panel">
              <div className="panel-head">
                <h2>Attendance submissions</h2>
                <span>{attendance.length} latest records</span>
              </div>
              {attendance.length === 0 ? (
                <Empty
                  icon={CalendarDays}
                  message="No attendance yet"
                  detail="Records submitted from the driver app will appear here."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>EMPLOYEE</th>
                        <th>TYPE</th>
                        <th>RECEIVED IN MANILA</th>
                        <th>LOCATION</th>
                        <th>REVIEW</th>
                        <th>PHOTO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendance.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{profileName(item.employee_id)}</strong>
                            <small>
                              Captured {manilaTime(item.captured_at)}
                            </small>
                          </td>
                          <td>{item.kind.replaceAll("_", " ")}</td>
                          <td>{manilaTime(item.received_at)}</td>
                          <td>
                            {item.latitude.toFixed(4)},{" "}
                            {item.longitude.toFixed(4)}
                            <small>
                              ±{Math.round(item.accuracy_m)} m accuracy
                            </small>
                          </td>
                          <td>
                            {item.review_status === "pending" ? (
                              <div className="review-actions">
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(
                                      () =>
                                        client.rpc("review_attendance", {
                                          p_id: item.id,
                                          p_status: "approved",
                                          p_note: "",
                                        }),
                                      "Attendance approved.",
                                    )
                                  }
                                  aria-label="Approve attendance"
                                >
                                  <Check size={16} />
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void act(
                                      () =>
                                        client.rpc("review_attendance", {
                                          p_id: item.id,
                                          p_status: "rejected",
                                          p_note: "Rejected by reviewer",
                                        }),
                                      "Attendance rejected.",
                                    )
                                  }
                                  aria-label="Reject attendance"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            ) : (
                              <Status value={item.review_status} />
                            )}
                          </td>
                          <td>
                            <button
                              className="row-action"
                              onClick={async () => {
                                const { data, error: issue } =
                                  await client.storage
                                    .from("attendance-photos")
                                    .createSignedUrl(item.photo_path, 60);
                                if (issue) setError(issue.message);
                                else
                                  window.open(
                                    data.signedUrl,
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                              }}
                            >
                              View photo
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "access" && (
            <AccessPanel
              profiles={profiles}
              currentUser={user.id}
              canManageRoles={profile.role === "owner"}
              busy={busy}
              invite={(email, name) =>
                void act(
                  () =>
                    client.functions.invoke("invite-user", {
                      body: { email, full_name: name },
                    }),
                  "Invitation sent.",
                )
              }
              changeRole={(id, role) =>
                void act(
                  () => client.from("profiles").update({ role }).eq("id", id),
                  "Role updated.",
                )
              }
              toggleActive={(item) =>
                void act(
                  () =>
                    client
                      .from("profiles")
                      .update({ active: !item.active })
                      .eq("id", item.id),
                  "Account status updated.",
                )
              }
            />
          )}
          <footer>
            HAULMARK OPERATIONS · ASIA/MANILA · DATA FROM YOUR CONNECTED
            SUPABASE PROJECT
          </footer>
        </div>
      </main>
      {menuOpen && (
        <button
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      {form && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setForm(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              form === "vehicle"
                ? editingVehicle
                  ? "Edit truck"
                  : "Add truck"
                : form === "driver"
                  ? editingDriver
                    ? "Edit driver"
                    : "Add driver"
                  : "New dispatch"
            }
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">
                  {editingVehicle || editingDriver
                    ? "EDIT RECORD"
                    : "CREATE RECORD"}
                </div>
                <h2>
                  {form === "vehicle"
                    ? editingVehicle
                      ? "Edit truck"
                      : "Add a truck"
                    : form === "driver"
                      ? editingDriver
                        ? "Edit driver"
                        : "Add a driver"
                      : "New dispatch"}
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setForm(null)}
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
            {form === "vehicle" && (
              <form onSubmit={submitVehicle} className="form-grid">
                <label>
                  Plate number
                  <input
                    name="plate"
                    required
                    minLength={3}
                    maxLength={20}
                    placeholder="ABC 1234"
                    defaultValue={editingVehicle?.plate_number}
                  />
                </label>
                <label>
                  Truck type
                  <input
                    name="type"
                    required
                    minLength={2}
                    placeholder="10-wheeler"
                    defaultValue={editingVehicle?.vehicle_type}
                  />
                </label>
                <label>
                  Make and model
                  <input
                    name="model"
                    placeholder="Isuzu Giga"
                    defaultValue={editingVehicle?.make_model}
                  />
                </label>
                <label>
                  Capacity (kg)
                  <input
                    name="capacity"
                    type="number"
                    min="1"
                    step="0.01"
                    defaultValue={editingVehicle?.capacity_kg ?? ""}
                  />
                </label>
                <label>
                  Status
                  <select
                    name="status"
                    defaultValue={editingVehicle?.status ?? "available"}
                  >
                    <option value="available">Available</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setForm(null)}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={busy}>
                    {editingVehicle ? "Update truck" : "Save truck"}
                  </button>
                </div>
              </form>
            )}
            {form === "driver" && (
              <form onSubmit={submitDriver} className="form-grid">
                <label className="wide">
                  User account
                  <select
                    name="profile"
                    required
                    defaultValue={editingDriver?.id ?? ""}
                    disabled={Boolean(editingDriver)}
                  >
                    <option value="" disabled>
                      Select an invited driver
                    </option>
                    {editingDriver && (
                      <option value={editingDriver.id}>
                        {profileName(editingDriver.id)}
                      </option>
                    )}
                    {profiles
                      .filter(
                        (item) =>
                          item.role === "driver" &&
                          !drivers.some((driver) => driver.id === item.id),
                      )
                      .map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.full_name || item.id}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  License number
                  <input
                    name="license"
                    required
                    minLength={4}
                    defaultValue={editingDriver?.license_number}
                  />
                </label>
                <label>
                  License expiry
                  <input
                    name="expiry"
                    type="date"
                    required
                    defaultValue={editingDriver?.license_expires_on}
                  />
                </label>
                <label className="wide">
                  Phone
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={editingDriver?.phone}
                  />
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setForm(null)}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={busy}>
                    {editingDriver ? "Update driver" : "Save driver"}
                  </button>
                </div>
              </form>
            )}
            {form === "trip" && (
              <form onSubmit={submitTrip} className="form-grid">
                <label className="wide">
                  Customer
                  <input name="customer" required minLength={2} />
                </label>
                <label>
                  Pickup address
                  <input name="pickup" required minLength={3} />
                </label>
                <label>
                  Destination address
                  <input name="destination" required minLength={3} />
                </label>
                <label>
                  Truck
                  <select name="vehicle" required defaultValue="">
                    <option value="" disabled>
                      Select available truck
                    </option>
                    {availableVehicles.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.plate_number} · {item.vehicle_type}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Driver
                  <select name="driver" required defaultValue="">
                    <option value="" disabled>
                      Select available driver
                    </option>
                    {availableDrivers.map((item) => (
                      <option value={item.id} key={item.id}>
                        {profileName(item.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wide">
                  Scheduled pickup (Manila local time)
                  <input name="scheduled" type="datetime-local" required />
                </label>
                <label className="wide">
                  Cargo details
                  <input name="cargo" />
                </label>
                <label className="wide">
                  Instructions
                  <textarea name="instructions" rows={3} />
                </label>
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setForm(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !availableVehicles.length ||
                      !availableDrivers.length
                    }
                  >
                    Assign trip
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Truck;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value.toLocaleString()}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value.replaceAll("_", "-")}`}>
      <span />
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Empty({
  icon: Icon,
  message,
  detail,
}: {
  icon: typeof Truck;
  message: string;
  detail: string;
}) {
  return (
    <div className="empty">
      <div>
        <Icon size={27} />
      </div>
      <strong>{message}</strong>
      <p>{detail}</p>
    </div>
  );
}
function TripTable({
  trips,
  plate,
  profileName,
  onCancel,
}: {
  trips: Trip[];
  plate: (id: string) => string;
  profileName: (id: string) => string;
  onCancel?: (trip: Trip) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Trip register</h2>
        <span>{trips.length} shown</span>
      </div>
      {trips.length === 0 ? (
        <Empty
          icon={ClipboardList}
          message="No trips yet"
          detail="Create a dispatch to start an operational record."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>TRUCK / DRIVER</th>
                <th>CUSTOMER & ROUTE</th>
                <th>SCHEDULE</th>
                <th>STATUS</th>
                {onCancel && <th>ACTION</th>}
              </tr>
            </thead>
            <tbody>
              {trips.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{plate(item.vehicle_id)}</strong>
                    <small>{profileName(item.driver_id)}</small>
                  </td>
                  <td>
                    <strong>{item.customer_name}</strong>
                    <small>
                      {item.pickup_address} → {item.destination_address}
                    </small>
                  </td>
                  <td>{manilaTime(item.scheduled_at)}</td>
                  <td>
                    <Status value={item.status} />
                  </td>
                  {onCancel && (
                    <td>
                      {!["completed", "cancelled"].includes(item.status) && (
                        <button
                          className="row-action"
                          onClick={() => onCancel(item)}
                        >
                          Cancel trip
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
