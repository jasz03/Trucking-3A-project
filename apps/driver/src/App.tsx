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
        <ActivityIndicator color={colors.gold} />
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
          <Text style={s.kicker}>Haulmark Driver</Text>
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
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "trip" }}
        >
          <Text style={[s.tabText, tab === "trip" && s.tabTextActive]}>
            My trip
          </Text>
        </Pressable>
        <Pressable
          style={[s.tab, tab === "attendance" && s.tabActive]}
          onPress={() => setTab("attendance")}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === "attendance" }}
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
          <Text style={s.refresh}>Refresh records</Text>
        </Pressable>
        {tab === "trip" ? (
          <>
            <Text style={s.sectionLabel}>Current assignment</Text>
            {trip ? (
              <View style={s.card}>
                <View style={s.row}>
                  <Text style={s.plate}>
                    {trip.vehicles?.plate_number || "Assigned truck"}
                  </Text>
                  <Text style={s.badge}>
                    {trip.status.replaceAll("_", " ")}
                  </Text>
                </View>
                <Text style={s.customer}>{trip.customer_name}</Text>
                <Text style={s.muted}>
                  Pickup: {localTime(trip.scheduled_at)}
                </Text>
                <View style={s.route}>
                  <View style={s.routeDot} />
                  <View style={s.routeText}>
                    <Text style={s.routeLabel}>Pickup</Text>
                    <Text style={s.routeAddress}>{trip.pickup_address}</Text>
                  </View>
                </View>
                <View style={s.route}>
                  <View style={[s.routeDot, { backgroundColor: colors.gold }]} />
                  <View style={s.routeText}>
                    <Text style={s.routeLabel}>Destination</Text>
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
            <Text style={s.sectionLabel}>Location sharing</Text>
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
            <Text style={s.sectionLabel}>Recent trips</Text>
            {trips.slice(0, 5).map((item) => (
              <View style={s.compactCard} key={item.id}>
                <Text style={s.cardTitle}>{item.customer_name}</Text>
                <Text style={s.muted}>
                  {item.destination_address} /{" "}
                  {item.status.replaceAll("_", " ")}
                </Text>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={s.sectionLabel}>New attendance</Text>
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
                  {position.coords.longitude.toFixed(5)} / ±
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
            <Text style={s.sectionLabel}>Recent records</Text>
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
          <ActivityIndicator color={colors.surface} />
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
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={s.input}
        placeholder="Password"
        placeholderTextColor={colors.muted}
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

const colors = {
  canvas: "#f3f5f3",
  surface: "#ffffff",
  line: "#dce3df",
  ink: "#1d2928",
  soft: "#50615f",
  muted: "#657673",
  pine: "#172c2c",
  pineMuted: "#b9cbc5",
  gold: "#e7ae45",
  goldInk: "#22302d",
  success: "#1d694c",
  successBg: "#e7f4ec",
  warning: "#8b570d",
  warningBg: "#fff2d9",
  danger: "#a43f32",
  dangerBg: "#fff0ec",
  scrim: "#172c2c77",
} as const;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    backgroundColor: colors.canvas,
  },
  heading: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: 8,
  },
  muted: { color: colors.soft, fontSize: 13, lineHeight: 20 },
  header: {
    backgroundColor: colors.pine,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 22,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  kicker: {
    color: colors.pineMuted,
    fontWeight: "600",
    fontSize: 12,
    marginBottom: 8,
  },
  headerTitle: {
    color: colors.surface,
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  headerAction: {
    color: colors.pineMuted,
    fontSize: 13,
    fontWeight: "600",
    padding: 8,
  },
  tabs: {
    backgroundColor: colors.surface,
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  tab: { flex: 1, paddingVertical: 15, alignItems: "center" },
  tabActive: { borderBottomColor: colors.gold, borderBottomWidth: 2 },
  tabText: { color: colors.muted, fontWeight: "600", fontSize: 14 },
  tabTextActive: { color: colors.ink },
  body: { padding: 18, paddingBottom: 48 },
  refresh: {
    textAlign: "right",
    color: colors.success,
    fontWeight: "600",
    fontSize: 13,
    marginBottom: 12,
  },
  sectionLabel: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
    marginTop: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  compactCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: {
    color: colors.ink,
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
    color: colors.ink,
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  badge: {
    color: colors.warning,
    backgroundColor: colors.warningBg,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "600",
  },
  smallBadge: { color: colors.success, fontSize: 11, textTransform: "capitalize" },
  customer: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    marginTop: 16,
    marginBottom: 4,
  },
  route: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 18,
  },
  routeDot: {
    width: 10,
    height: 10,
    backgroundColor: colors.success,
    borderRadius: 5,
    marginTop: 4,
  },
  routeText: { flex: 1 },
  routeLabel: {
    color: colors.soft,
    fontSize: 12,
    fontWeight: "600",
  },
  routeAddress: {
    color: colors.ink,
    fontSize: 14,
    marginTop: 5,
    lineHeight: 19,
  },
  primaryButton: {
    backgroundColor: colors.gold,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 19,
  },
  primaryText: { color: colors.goldInk, fontSize: 14, fontWeight: "700" },
  outlineButton: {
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 18,
  },
  outlineText: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  stopButton: { borderColor: colors.line },
  stopText: { color: colors.danger },
  indicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.muted,
  },
  indicatorOn: { backgroundColor: colors.success },
  kindGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  kind: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  kindSelected: { backgroundColor: colors.pine, borderColor: colors.pine },
  kindText: { color: colors.soft, fontSize: 12, fontWeight: "600" },
  kindTextSelected: { color: colors.surface },
  preview: { width: "100%", height: 220, borderRadius: 9, marginTop: 15 },
  gps: { color: colors.soft, fontSize: 12, marginTop: 12 },
  error: {
    backgroundColor: colors.dangerBg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 20 },
  success: {
    backgroundColor: colors.successBg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  successText: { color: colors.success, fontSize: 13 },
  busy: {
    position: "absolute",
    inset: 0,
    backgroundColor: colors.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  login: {
    flex: 1,
    backgroundColor: colors.pine,
    paddingHorizontal: 28,
    justifyContent: "center",
  },
  loginBrand: {
    fontSize: 34,
    fontWeight: "800",
    color: colors.gold,
    marginBottom: 38,
  },
  loginTitle: {
    color: colors.surface,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -1,
    lineHeight: 40,
    marginBottom: 12,
  },
  loginDetail: {
    color: colors.pineMuted,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 37,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.ink,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    fontSize: 15,
  },
  loginFoot: {
    color: colors.pineMuted,
    textAlign: "center",
    fontSize: 12,
    marginTop: 20,
  },
});
