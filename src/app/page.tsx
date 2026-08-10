import { redirect } from "next/navigation";

// The (authed) and (gated) layouts do the real routing decisions
// (login vs access-code vs dashboard); this just picks a sensible default.
export default function Home() {
  redirect("/dashboard");
}
