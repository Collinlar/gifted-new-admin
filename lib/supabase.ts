import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_SERVICE_ROLE!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_SERVICE_ROLE)."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
