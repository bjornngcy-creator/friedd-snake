import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";

// Belt-and-suspenders: proxy.ts already redirects unauthenticated requests
// to /login, but Server Functions should not rely on proxy alone (a matcher
// change could silently stop covering a route).
export default async function AuthedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav email={user.email} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        {children}
      </main>
    </div>
  );
}
