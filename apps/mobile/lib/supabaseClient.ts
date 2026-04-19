import { createClient } from "@supabase/supabase-js";

const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = String(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_VITE_SUPABASE_ANON_KEY || "",
).trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("[mobile] Supabase env missing: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY");
}

export const supabaseRealtime = createClient(supabaseUrl || "https://invalid.local", supabaseAnonKey || "invalid", {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
