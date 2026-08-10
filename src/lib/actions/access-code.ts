"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentMonthSGT } from "@/lib/current-month";
import { getLockoutStatus, recordFailedAttempt, resetAttempts } from "@/lib/access-throttle";

export type AccessCodeState = {
  error?: string;
};

/** Uppercase + trim so codes are case-insensitive, matching set-access-code.mjs. */
function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Checks the submitted code against this month's access_codes row
 * (Asia/Singapore calendar month) and, on a match, records the unlock in
 * user_access. Both reads/writes use the service-role client because
 * access_codes has no client-facing RLS policies at all.
 *
 * Codes are case-insensitive: normalized to uppercase + trimmed before both
 * hashing (set-access-code.mjs) and comparing (here).
 *
 * Brute-force throttling: 5 consecutive failed attempts locks this user out
 * of further attempts for 1 hour (access_code_attempts table, service-role
 * only). The counter resets on a successful check.
 */
export async function verifyAccessCode(
  _prevState: AccessCodeState,
  formData: FormData
): Promise<AccessCodeState> {
  const code = normalizeCode(String(formData.get("code") ?? ""));

  if (!code) {
    return { error: "Enter this month's access code." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  const lockout = await getLockoutStatus(admin, user.id);
  if (lockout.locked) {
    return {
      error: `Too many incorrect attempts. Try again in ${lockout.remainingMinutes} minute${lockout.remainingMinutes === 1 ? "" : "s"}.`,
    };
  }

  const month = currentMonthSGT();

  const { data: accessCode, error: fetchError } = await admin
    .from("access_codes")
    .select("code_hash")
    .eq("month", month)
    .maybeSingle();

  if (fetchError) {
    return { error: "Something went wrong checking the code. Try again." };
  }

  if (!accessCode) {
    return {
      error: "No access code has been set for this month yet. Check with the admin.",
    };
  }

  const matches = await bcrypt.compare(code, accessCode.code_hash);

  if (!matches) {
    const lockout = await recordFailedAttempt(admin, user.id);
    if (lockout.locked) {
      // This attempt was the 5th consecutive failure — announce the lockout
      // now instead of letting the user see a generic wrong-code message
      // and only discovering they're locked out on their next attempt.
      return {
        error: `Too many incorrect attempts. Try again in ${lockout.remainingMinutes} minute${lockout.remainingMinutes === 1 ? "" : "s"}.`,
      };
    }
    return { error: "That code isn't right for this month." };
  }

  await resetAttempts(admin, user.id);

  const { error: insertError } = await admin
    .from("user_access")
    .upsert({ user_id: user.id, month }, { onConflict: "user_id,month" });

  if (insertError) {
    return { error: "Code was correct, but we couldn't unlock your access. Try again." };
  }

  redirect("/dashboard");
}
