import Link from "next/link";
import { signOut } from "@/lib/actions/auth";

export function Nav({ email }: { email: string | null | undefined }) {
  return (
    <header className="border-b border-white/10 bg-brand">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/dashboard" className="group flex items-baseline gap-2">
          <span className="font-serif text-lg tracking-tight text-accent transition group-hover:text-accent-dark">
            Equity Compass
          </span>
          <span className="hidden text-[11px] font-medium uppercase tracking-widest text-muted sm:inline">
            FRIEDD SNAKE Evaluator
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {email && <span className="text-sm text-muted">{email}</span>}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm font-medium text-muted transition hover:border-accent hover:text-accent"
            >
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
