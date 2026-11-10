import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { supabase } from "./supabase";

export const TRACKING_TASK = "haulmark-authorized-tracking";
const SESSION_KEY = "haulmark_session";
const PENDING_STOP_KEY = "haulmark_pending_stop";
const QUEUE_KEY = "haulmark_location_queue";
type QueuedPoint = {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

function queue(): QueuedPoint[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") as QueuedPoint[];
  } catch {
    return [];
  }
}

export async function flushLocations() {
  const pending = queue();
  for (let index = 0; index < pending.length; index++) {
    const point = pending[index];
    const { error } = await supabase.rpc("report_location", {
      p_session_id: point.sessionId,
      p_latitude: point.latitude,
      p_longitude: point.longitude,
      p_accuracy_m: point.accuracy,
      p_captured_at: point.capturedAt,
    });
    if (error) {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(pending.slice(index)));
      throw error;
    }
  }
  localStorage.removeItem(QUEUE_KEY);
}

TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) return;
  const locations = (data as { locations: Location.LocationObject[] })
    .locations;
  const pending = queue();
  for (const item of locations)
    pending.push({
      sessionId,
      latitude: item.coords.latitude,
      longitude: item.coords.longitude,
      accuracy: Math.max(item.coords.accuracy ?? 0, 0),
      capturedAt: new Date(item.timestamp).toISOString(),
    });
  // shortcut: retain the newest 1000 offline points; add durable batch retention before long offline trips.
  localStorage.setItem(QUEUE_KEY, JSON.stringify(pending.slice(-1000)));
  try {
    await flushLocations();
  } catch (problem) {
    if (
      problem instanceof Error &&
      /not active|Driver account inactive/.test(problem.message)
    ) {
      await Location.stopLocationUpdatesAsync(TRACKING_TASK);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(QUEUE_KEY);
    }
  }
});

export async function startSharing(tripId: string) {
  await syncPendingStop();
  if (hasPendingStop())
    throw new Error(
      "Previous sharing stop is awaiting network confirmation. Retry when online.",
    );
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted)
    throw new Error(
      "Location permission is required to share your trip position.",
    );
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted)
    throw new Error(
      "Allow background location for trip sharing in your device settings.",
    );
  const { data, error } = await supabase.rpc("start_tracking", {
    p_trip_id: tripId,
  });
  if (error) throw error;
  const sessionId = data as string;
  localStorage.setItem(SESSION_KEY, sessionId);
  try {
    await Location.startLocationUpdatesAsync(TRACKING_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 60_000,
      distanceInterval: 100,
      foregroundService: {
        notificationTitle: "Haulmark trip sharing is on",
        notificationBody:
          "Your location is shared with dispatch during this trip.",
      },
      showsBackgroundLocationIndicator: true,
    });
  } catch (problem) {
    localStorage.removeItem(SESSION_KEY);
    await supabase.rpc("stop_tracking", { p_session_id: sessionId });
    throw problem;
  }
  return sessionId;
}

export async function stopSharing() {
  const sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) return true;
  if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK))
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  localStorage.removeItem(SESSION_KEY);
  localStorage.setItem(PENDING_STOP_KEY, sessionId);
  return syncPendingStop();
}

export function activeSession() {
  return localStorage.getItem(SESSION_KEY);
}

export async function syncPendingStop() {
  const sessionId = localStorage.getItem(PENDING_STOP_KEY);
  if (!sessionId) return true;
  let uploaded = true;
  try {
    await flushLocations();
  } catch {
    uploaded = false;
  }
  const { error } = await supabase.rpc("stop_tracking", {
    p_session_id: sessionId,
  });
  if (error) return false;
  localStorage.removeItem(PENDING_STOP_KEY);
  if (!uploaded) {
    const remaining = queue().filter((point) => point.sessionId !== sessionId);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  }
  return uploaded;
}

export function hasPendingStop() {
  return Boolean(localStorage.getItem(PENDING_STOP_KEY));
}
