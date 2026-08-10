"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentMonthSGT } from "@/lib/current-month";

export type AccessCodeState = {
  error?: string;
};

/**
 * Checks the submitted code against this month's access_codes row
 * (Asia/Singapore calendar month) and, on a match, records the unlock in
 * user_access. Both reads/writes use the service-role client because
 * access_codes has no client-facing RLS policies at all.
 */
export async function verifyAccessCode(
  _prevState: AccessCodeState,
  formData: FormData
): Promise<AccessCodeState> {
  const code = String(formData.get("code") ?? "").trim();

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

  const month = currentMonthSGT();
  const admin = createAdminClient();

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
    return { error: "That code isn't right for this month." };
  }

  const { error: insertError } = await admin
    .from("user_access")
    .upsert({ user_id: user.id, month }, { onConflict: "user_id,month" });

  if (insertError) {
    return { error: "Code was correct, but we couldn't unlock your access. Try again." };
  }

  redirect("/dashboard");
}
