import type { SupabaseClient } from "@supabase/supabase-js";
import { currentMonthSGT } from "@/lib/current-month";

/** True if this user has an unlock row for the current (Asia/Singapore) month. */
export async function hasCurrentMonthAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("user_access")
    .select("user_id")
    .eq("user_id", userId)
    .eq("month", currentMonthSGT())
    .maybeSingle();

  return Boolean(data);
}

/** True if this user's profile has is_admin set. */
export async function isAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  return Boolean(data?.is_admin);
}
