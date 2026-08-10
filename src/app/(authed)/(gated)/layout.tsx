import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCurrentMonthAccess, isAdmin } from "@/lib/access";

// Wraps everything that requires this month's access code to already be
// unlocked (dashboard, admin, and future Phase 2+ tool pages).
// Admins (profiles.is_admin = true) skip the monthly access-code requirement
// entirely — they never need to enter a code.
export default async function GatedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (await isAdmin(supabase, user.id)) {
    return <>{children}</>;
  }

  if (!(await hasCurrentMonthAccess(supabase, user.id))) {
    redirect("/access-code");
  }

  return <>{children}</>;
}
