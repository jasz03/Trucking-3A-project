import "react-native-url-polyfill/auto";
import "expo-sqlite/localStorage/install";
import { createClient } from "@supabase/supabase-js";

export const configured = Boolean(
  process.env.EXPO_PUBLIC_SUPABASE_URL &&
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "missing-key",
  {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
