import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

export type LockoutStatus = {
  locked: boolean;
  remainingMinutes?: number;
};

/**
 * Checks whether this user is currently locked out of access-code attempts.
 * If a previous lock has expired, clears it (fresh streak) as a side effect.
 * Uses the service-role client — access_code_attempts has no client RLS
 * policies at all, same pattern as access_codes.
 */
export async function getLockoutStatus(
  admin: SupabaseClient,
  userId: string
): Promise<LockoutStatus> {
  const { data } = await admin
    .from("access_code_attempts")
    .select("locked_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data?.locked_until) {
    return { locked: false };
  }

  const lockedUntil = new Date(data.locked_until);
  const now = new Date();

  if (lockedUntil <= now) {
    // Lock has expired — clear it and start a fresh streak.
    await admin
      .from("access_code_attempts")
      .update({ failed_count: 0, locked_until: null, window_start: now.toISOString() })
      .eq("user_id", userId);
    return { locked: false };
  }

  const remainingMinutes = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000);
  return { locked: true, remainingMinutes };
}

/**
 * Records a failed access-code attempt. On the 5th consecutive failure,
 * locks the user out for one hour. Returns the resulting lockout status so
 * the caller can announce the lockout immediately on the attempt that
 * triggered it, rather than the user only finding out on their next try.
 */
export async function recordFailedAttempt(
  admin: SupabaseClient,
  userId: string
): Promise<LockoutStatus> {
  const { data } = await admin
    .from("access_code_attempts")
    .select("failed_count")
    .eq("user_id", userId)
    .maybeSingle();

  const nextCount = (data?.failed_count ?? 0) + 1;
  const now = new Date();
  const justLocked = nextCount >= MAX_FAILURES;
  const lockedUntil = justLocked ? new Date(now.getTime() + LOCKOUT_MS) : null;

  await admin.from("access_code_attempts").upsert(
    {
      user_id: userId,
      failed_count: nextCount,
      locked_until: lockedUntil ? lockedUntil.toISOString() : null,
      updated_at: now.toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (justLocked) {
    return { locked: true, remainingMinutes: Math.ceil(LOCKOUT_MS / 60000) };
  }
  return { locked: false };
}

/** Resets the failure streak on a successful access-code check. */
export async function resetAttempts(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from("access_code_attempts").upsert(
    {
      user_id: userId,
      failed_count: 0,
      locked_until: null,
      window_start: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}
