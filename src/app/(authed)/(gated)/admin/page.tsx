import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/access";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !(await isAdmin(supabase, user.id))) {
    notFound();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
      <p className="mt-2 text-slate-500">
        Access-code rotation and student management are coming in a later
        phase. For now, set the monthly code with{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">
          scripts/set-access-code.mjs
        </code>
        .
      </p>
    </div>
  );
}
