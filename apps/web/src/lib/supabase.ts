import { createClient } from "@supabase/supabase-js";

// Capture this before Supabase consumes the invite link's URL fragment.
export const invitedFromUrl =
  new URLSearchParams(window.location.hash.slice(1)).get("type") === "invite";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key);
export const supabase = configured ? createClient(url, key) : null;
