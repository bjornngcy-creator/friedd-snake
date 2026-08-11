import "server-only";

import { createClient } from "@/lib/supabase/server";
import { hasCurrentMonthAccess, isAdmin } from "@/lib/access";

export const ACCESS_EXPIRED_ERROR =
  "Your monthly access has expired. Enter this month's code to continue.";

/**
 * Authenticates the caller and enforces the same monthly access gate the
 * (gated) layout and the evaluation/valuation pages apply — admins bypass
 * it. Every mutating evaluation/valuation server action needs this, not
 * just the page render: without it, a student whose month has lapsed (or
 * who is mid brute-force lockout) could keep autosaving through the server
 * actions directly, since actions don't run through the page's redirect.
 *
 * Shared by src/lib/actions/evaluation.ts and src/lib/actions/valuation.ts
 * — pulled out of evaluation.ts's own "use server" file rather than
 * exported from there, so it doesn't itself become a client-callable
 * server action (every export from a "use server" file is one).
 */
export async function requireEvaluationAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, error: "Not authenticated." };
  }

  if (!(await isAdmin(supabase, user.id)) && !(await hasCurrentMonthAccess(supabase, user.id))) {
    return { ok: false as const, error: ACCESS_EXPIRED_ERROR };
  }

  return { ok: true as const, supabase, userId: user.id };
}
