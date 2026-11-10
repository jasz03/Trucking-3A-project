import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { User } from "@supabase/supabase-js";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { decode } from "base64-arraybuffer";
import { configured, supabase } from "./supabase";
import {
  activeSession,
  flushLocations,
  hasPendingStop,
  startSharing,
  stopSharing,
  syncPendingStop,
} from "./tracking";

type Trip = {
  id: string;
  customer_name: string;
  pickup_address: string;
  destination_address: string;
  scheduled_at: string;
  status:
    | "assigned"
    | "accepted"
    | "in_transit"
    | "at_destination"
    | "completed"
    | "cancelled";
  vehicle_id: string;
  vehicles: { plate_number: string } | null;
};
type Entry = {
  id: string;
  kind: string;
  received_at: string;
  review_status: string;
};
type Kind =
  | "time_in"
  | "time_out"
  | "break_out"
  | "break_in"
  | "overtime_in"
  | "overtime_out";
const next: Partial<
  Record<Trip["status"], { status: Trip["status"]; label: string }>
> = {
  assigned: { status: "accepted", label: "Accept assignment" },
  accepted: { status: "in_transit", label: "Start trip" },
  in_transit: { status: "at_destination", label: "Mark arrived" },
  at_destination: { status: "completed", label: "Complete trip" },
};
const kinds: { id: Kind; label: string }[] = [
  { id: "time_in", label: "Time in" },
  { id: "time_out", label: "Time out" },
  { id: "break_out", label: "Break out" },
  { id: "break_in", label: "Break in" },
  { id: "overtime_in", label: "Overtime in" },
  { id: "overtime_out", label: "Overtime out" },
];
const localTime = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<"trip" | "attendance">("trip");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [name, setName] = useState("");
  const [selectedKind, setSelectedKind] = useState<Kind>("time_in");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [captureRef, setCaptureRef] = useState<string | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [position, setPosition] = useState<Location.LocationObject | null>(
    null,
  );
  const [sharing, setSharing] = useState(Boolean(activeSession()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    const [tripResult, attendanceResult, profileResult] = await Promise.all([
      supabase
        .from("trips")
        .select(
          "id,customer_name,pickup_address,destination_address,scheduled_at,status,vehicle_id,vehicles(plate_number)",
        )
        .eq("driver_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("attendance")
        .select("id,kind,received_at,review_status")
        .eq("employee_id", user.id)
        .order("received_at", { ascending: false })
        .limit(20),
      supabase.from("profiles").select("full_name").eq("id", user.id).single(),
    ]);
    if (tripResult.error || attendanceResult.error || profileResult.error)
      setError(
        tripResult.error?.message ||
          attendanceResult.error?.message ||
          profileResult.error?.message ||
          "Could not load records.",
      );
    setTrips((tripResult.data || []) as unknown as Trip[]);
    setEntries((attendanceResult.data || []) as Entry[]);
    setName(profileResult.data?.full_name || user.email || "Driver");
    if (
      !tripResult.error &&
      activeSession() &&
      !(tripResult.data || []).some(
        (item) => !["completed", "cancelled"].includes(item.status),
      )
    ) {
      await stopSharing();
      setSharing(false);
      setMessage(
        "Your assignment ended. Location sharing stopped on this device.",
      );
    }
    try {
      await syncPendingStop();
      await flushLocations();
    } catch {
      /* retry on next refresh */
    }
  }, [user]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      await refresh();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Action failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = (trip: Trip) =>
    void run(async () => {
      const change = next[trip.status];
      if (!change) return;
      if (change.status === "completed" && sharing) {
        await stopSharing();
        setSharing(false);
        if (hasPendingStop())
          throw new Error(
            "Sharing stopped on this device. Connect to the internet to confirm the stop before completing the trip.",
          );
      }
      const { error: issue } = await supabase.rpc("driver_set_trip_status", {
        p_trip_id: trip.id,
        p_status: change.status,
      });
      if (issue) throw issue;
      setMessage(`Trip marked ${change.status.replaceAll("_", " ")}.`);
    });

  const toggleSharing = (trip: Trip | undefined) =>
    void run(async () => {
      if (sharing) {
        const uploaded = await stopSharing();
        setSharing(false);
        setMessage(
          hasPendingStop()
            ? "Sharing stopped on this device. Server confirmation is pending until you reconnect."
            : uploaded
              ? "Location sharing stopped."
              : "Sharing stopped. Some queued locations could not be uploaded.",
        );
      } else {
        if (!trip) throw new Error("No assigned trip.");
        await startSharing(trip.id);
        setSharing(true);
        setMessage("Location sharing is on for this trip.");
      }
    });

  const capture = () =>
    void run(async () => {
      const camera = await ImagePicker.requestCameraPermissionsAsync();
      if (!camera.granted)
        throw new Error("Camera permission is required for photo attendance.");
      const location = await Location.requestForegroundPermissionsAsync();
      if (!location.granted)
        throw new Error("Location permission is required for attendance.");
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        cameraType: ImagePicker.CameraType.front,
        base64: true,
        quality: 0.6,
      });
      if (result.canceled) return;
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setPhoto(result.assets[0]);
      setCaptureRef(Crypto.randomUUID());
      setPhotoUploaded(false);
      setPosition(fix);
      setMessage("Photo and location captured. Review them before submitting.");
    });

  const submitAttendance = () =>
    void run(async () => {
      if (!user || !photo?.base64 || !position || !captureRef)
        throw new Error("Capture a photo and location first.");
      const bytes = decode(photo.base64);
      if (bytes.byteLength > 5 * 1024 * 1024)
        throw new Error("Photo is too large. Retake at a lower resolution.");
      const path = `${user.id}/${captureRef}.jpg`;
      if (!photoUploaded) {
        const { error: uploadError } = await supabase.storage
          .from("attendance-photos")
          .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
        if (uploadError) throw uploadError;
        setPhotoUploaded(true);
      }
      const { error: recordError } = await supabase.rpc("submit_attendance", {
        p_kind: selectedKind,
        p_photo_path: path,
        p_latitude: position.coords.latitude,
        p_longitude: position.coords.longitude,
        p_accuracy_m: Math.max(0, position.coords.accuracy ?? 0),
        p_captured_at: new Date(position.timestamp).toISOString(),
        p_client_ref: captureRef,
      });
      if (recordError) throw recordError;
      setPhoto(null);
      setCaptureRef(null);
      setPhotoUploaded(false);
      setPosition(null);
      setMessage("Attendance submitted. Server time is recorded.");
    });

  if (!configured)
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.heading}>Connect the backend</Text>
        <Text style={s.muted}>
          Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in
          apps/driver/.env.
        </Text>
      </SafeAreaView>
    );
  if (!ready)
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color="#e6a745" />
        <Text style={s.muted}>Loading…</Text>
      </SafeAreaView>
    );
  if (!user) return <SignIn />;
  const trip = trips.find(
    (item) => !["completed", "cancelled"].includes(item.status),
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={s.header}>
        <View>
          <Text style={s.kicker}>HAULMARK / DRIVER</Text>
          <Text style={s.headerTitle}>Hello, {name.split(" ")[0]}</Text>
        </View>
        <Pressable
          onPress={() =>
            Alert.alert(
              "Sign out?",
              "Your active location sharing will be stopped first.",
              [
                { text: "Cancel" },
                {
                  text: "Sign out",
                  onPress: () =>
                    void run(async () => {
                      if (sharing) await stopSharing();
                      await supabase.auth.signOut();
                    }),
                },
              ],
            )
          }
        >
          <Text style={s.headerAction}>Sign out</Text>
        </Pressable>
      </View>
      <View style={s.tabs}>
        <Pressable
          style={[s.tab, tab === "trip" && s.tabActive]}
          onPress={() => setTab("trip")}
        >
          <Text style={[s.tabText, tab === "trip" && s.tabTextActive]}>
            My trip
          </Text>
        </Pressable>
        <Pressable
          style={[s.tab, tab === "attendance" && s.tabActive]}
          onPress={() => setTab("attendance")}
        >
          <Text style={[s.tabText, tab === "attendance" && s.tabTextActive]}>
            Attendance
          </Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.body} refreshControl={undefined}>
        {error ? (
          <View style={s.error}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
        {message ? (
          <View style={s.success}>
            <Text style={s.successText}>{message}</Text>
          </View>
        ) : null}
        <Pressable onPress={() => void refresh()}>
          <Text style={s.refresh}>↻ Refresh records</Text>
        </Pressable>
        {tab === "trip" ? (
          <>
            <Text style={s.sectionLabel}>CURRENT ASSIGNMENT</Text>
            {trip ? (
              <View style={s.card}>
                <View style={s.row}>
                  <Text style={s.plate}>
                    {trip.vehicles?.plate_number || "Assigned truck"}
                  </Text>
                  <Text style={s.badge}>
                    {trip.status.replaceAll("_", " ").toUpperCase()}
                  </Text>
                </View>
                <Text style={s.customer}>{trip.customer_name}</Text>
                <Text style={s.muted}>
                  Pickup · {localTime(trip.scheduled_at)}
                </Text>
                <View style={s.route}>
                  <View style={s.routeDot} />
                  <View style={s.routeText}>
                    <Text style={s.routeLabel}>PICKUP</Text>
                    <Text style={s.routeAddress}>{trip.pickup_address}</Text>
                  </View>
                </View>
                <View style={s.route}>
                  <View style={[s.routeDot, { backgroundColor: "#dda343" }]} />
                  <View style={s.routeText}>
                    <Text style={s.routeLabel}>DESTINATION</Text>
                    <Text style={s.routeAddress}>
                      {trip.destination_address}
                    </Text>
                  </View>
                </View>
                {next[trip.status] && (
                  <Pressable
                    disabled={busy}
                    style={s.primaryButton}
                    onPress={() => updateStatus(trip)}
                  >
                    <Text style={s.primaryText}>
                      {next[trip.status]?.label}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.cardTitle}>No active trip</Text>
                <Text style={s.muted}>
                  Your next assignment will appear here after dispatch assigns
                  it.
                </Text>
              </View>
            )}
            <Text style={s.sectionLabel}>LOCATION SHARING</Text>
            <View style={s.card}>
              <View style={s.row}>
                <Text style={s.cardTitle}>
                  {sharing ? "Sharing is on" : "Sharing is off"}
                </Text>
                <View style={[s.indicator, sharing && s.indicatorOn]} />
              </View>
              <Text style={s.muted}>
                Your location is sent only during an assigned trip while sharing
                is on. Dispatch sees your last reported position and time.
              </Text>
              <Pressable
                disabled={busy || (!trip && !sharing)}
                style={[s.outlineButton, sharing && s.stopButton]}
                onPress={() => toggleSharing(trip)}
              >
                <Text style={[s.outlineText, sharing && s.stopText]}>
                  {sharing ? "Stop sharing" : "Start sharing for this trip"}
                </Text>
              </Pressable>
            </View>
            <Text style={s.sectionLabel}>RECENT TRIPS</Text>
            {trips.slice(0, 5).map((item) => (
              <View style={s.compactCard} key={item.id}>
                <Text style={s.cardTitle}>{item.customer_name}</Text>
                <Text style={s.muted}>
                  {item.destination_address} ·{" "}
                  {item.status.replaceAll("_", " ")}
                </Text>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={s.sectionLabel}>NEW ATTENDANCE</Text>
            <View style={s.card}>
              <Text style={s.cardTitle}>Photo check-in</Text>
              <Text style={s.muted}>
                Take a fresh photo and share your current GPS position.
                Submission time is recorded by the server.
              </Text>
              <View style={s.kindGrid}>
                {kinds.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[s.kind, selectedKind === item.id && s.kindSelected]}
                    onPress={() => setSelectedKind(item.id)}
                  >
                    <Text
                      style={[
                        s.kindText,
                        selectedKind === item.id && s.kindTextSelected,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                disabled={busy}
                style={s.outlineButton}
                onPress={capture}
              >
                <Text style={s.outlineText}>Open camera</Text>
              </Pressable>
              {photo && <Image source={{ uri: photo.uri }} style={s.preview} />}{" "}
              {position && (
                <Text style={s.gps}>
                  GPS: {position.coords.latitude.toFixed(5)},{" "}
                  {position.coords.longitude.toFixed(5)} · ±
                  {Math.round(position.coords.accuracy ?? 0)}m
                </Text>
              )}
              {photo && position && (
                <Pressable
                  disabled={busy}
                  style={s.primaryButton}
                  onPress={submitAttendance}
                >
                  <Text style={s.primaryText}>
                    Submit {selectedKind.replaceAll("_", " ")}
                  </Text>
                </Pressable>
              )}
            </View>
            <Text style={s.sectionLabel}>RECENT RECORDS</Text>
            {entries.length === 0 ? (
              <View style={s.compactCard}>
                <Text style={s.muted}>No attendance submitted yet.</Text>
              </View>
            ) : (
              entries.map((item) => (
                <View style={s.compactCard} key={item.id}>
                  <View style={s.row}>
                    <Text style={s.cardTitle}>
                      {item.kind.replaceAll("_", " ")}
                    </Text>
                    <Text style={s.smallBadge}>{item.review_status}</Text>
                  </View>
                  <Text style={s.muted}>
                    Received {localTime(item.received_at)}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
      {busy && (
        <View style={s.busy}>
          <ActivityIndicator color="#fff" />
        </View>
      )}
    </SafeAreaView>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <SafeAreaView style={s.login}>
      <Text style={s.loginBrand}>H.</Text>
      <Text style={s.loginTitle}>Your work, on the move.</Text>
      <Text style={s.loginDetail}>
        Trips, location sharing, and attendance in one place.
      </Text>
      {error ? <Text style={s.errorText}>{error}</Text> : null}
      <TextInput
        style={s.input}
        placeholder="Email address"
        placeholderTextColor="#9fa9a3"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={s.input}
        placeholder="Password"
        placeholderTextColor="#9fa9a3"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable
        disabled={busy}
        style={s.primaryButton}
        onPress={async () => {
          setBusy(true);
          setError("");
          const { error: issue } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (issue) setError(issue.message);
          setBusy(false);
        }}
      >
        <Text style={s.primaryText}>{busy ? "Signing in…" : "Sign in"}</Text>
      </Pressable>
      <Text style={s.loginFoot}>Ask your administrator for an account.</Text>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f6f2" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    backgroundColor: "#f5f6f2",
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1d332a",
    marginBottom: 9,
  },
  muted: { color: "#7d8a81", fontSize: 13, lineHeight: 20 },
  header: {
    backgroundColor: "#19332f",
    paddingHorizontal: 22,
    paddingTop: 25,
    paddingBottom: 23,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  kicker: {
    color: "#d5a755",
    fontWeight: "800",
    letterSpacing: 2,
    fontSize: 9,
    marginBottom: 10,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -1,
  },
  headerAction: {
    color: "#c8dbcf",
    fontSize: 12,
    fontWeight: "700",
    padding: 8,
  },
  tabs: {
    backgroundColor: "#fff",
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5ebe3",
  },
  tab: { flex: 1, paddingVertical: 16, alignItems: "center" },
  tabActive: { borderBottomColor: "#e4a744", borderBottomWidth: 3 },
  tabText: { color: "#929e94", fontWeight: "700", fontSize: 13 },
  tabTextActive: { color: "#1c392d" },
  body: { padding: 19, paddingBottom: 50 },
  refresh: {
    textAlign: "right",
    color: "#a36e31",
    fontWeight: "700",
    fontSize: 12,
    marginBottom: 12,
  },
  sectionLabel: {
    color: "#a17e48",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 10,
    marginTop: 13,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 20,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e7ede5",
  },
  compactCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 16,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: "#e7ede5",
  },
  cardTitle: {
    color: "#1c3028",
    fontSize: 16,
    fontWeight: "700",
    textTransform: "capitalize",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  plate: {
    color: "#1c3028",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  badge: {
    color: "#a7742b",
    backgroundColor: "#fff4dc",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: "hidden",
    fontSize: 10,
    fontWeight: "800",
  },
  smallBadge: { color: "#66806e", fontSize: 11, textTransform: "capitalize" },
  customer: {
    fontSize: 15,
    fontWeight: "700",
    color: "#3a5141",
    marginTop: 16,
    marginBottom: 4,
  },
  route: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 13,
    marginTop: 20,
  },
  routeDot: {
    width: 10,
    height: 10,
    backgroundColor: "#58a378",
    borderRadius: 5,
    marginTop: 4,
  },
  routeText: { flex: 1 },
  routeLabel: {
    color: "#9aa59a",
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: "800",
  },
  routeAddress: {
    color: "#304238",
    fontSize: 13,
    marginTop: 5,
    lineHeight: 19,
  },
  primaryButton: {
    backgroundColor: "#e5a843",
    borderRadius: 9,
    padding: 15,
    alignItems: "center",
    marginTop: 19,
  },
  primaryText: { color: "#182d26", fontSize: 13, fontWeight: "800" },
  outlineButton: {
    borderColor: "#e3b962",
    borderWidth: 1,
    borderRadius: 9,
    padding: 14,
    alignItems: "center",
    marginTop: 18,
  },
  outlineText: { color: "#98682e", fontSize: 13, fontWeight: "800" },
  stopButton: { borderColor: "#e2b7a8" },
  stopText: { color: "#b8614a" },
  indicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#aab7aa",
  },
  indicatorOn: { backgroundColor: "#55a977" },
  kindGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 17 },
  kind: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#dce6d9",
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  kindSelected: { backgroundColor: "#204134", borderColor: "#204134" },
  kindText: { color: "#5d7061", fontSize: 11, fontWeight: "700" },
  kindTextSelected: { color: "#fff" },
  preview: { width: "100%", height: 220, borderRadius: 9, marginTop: 15 },
  gps: { color: "#647a6e", fontSize: 11, marginTop: 12 },
  error: {
    backgroundColor: "#fff0eb",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: "#a64d34", fontSize: 12, lineHeight: 18 },
  success: {
    backgroundColor: "#e6f4e9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  successText: { color: "#3d7850", fontSize: 12 },
  busy: {
    position: "absolute",
    inset: 0,
    backgroundColor: "#1a322777",
    alignItems: "center",
    justifyContent: "center",
  },
  login: {
    flex: 1,
    backgroundColor: "#19332f",
    paddingHorizontal: 28,
    justifyContent: "center",
  },
  loginBrand: {
    fontSize: 36,
    fontWeight: "900",
    color: "#e8ad4d",
    marginBottom: 38,
  },
  loginTitle: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1.7,
    lineHeight: 40,
    marginBottom: 12,
  },
  loginDetail: {
    color: "#b4c8b9",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 37,
  },
  input: {
    backgroundColor: "#fff",
    color: "#23372e",
    borderRadius: 9,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    fontSize: 14,
  },
  loginFoot: {
    color: "#8fa99b",
    textAlign: "center",
    fontSize: 11,
    marginTop: 20,
  },
});
