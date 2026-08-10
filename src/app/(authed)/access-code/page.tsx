import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCurrentMonthAccess } from "@/lib/access";
import { AccessCodeForm } from "@/components/access-code-form";

export default async function AccessCodePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // AuthedLayout already guarantees a user here, but keep this page safe
  // to reason about on its own.
  if (!user) {
    redirect("/login");
  }

  if (await hasCurrentMonthAccess(supabase, user.id)) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">
        Enter this month&apos;s access code
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Your access code rotates monthly. Check your community channel for
        the current one.
      </p>
      <AccessCodeForm />
    </div>
  );
}
