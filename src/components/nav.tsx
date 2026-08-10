import { signOut } from "@/lib/actions/auth";

export function Nav({ email }: { email: string | null | undefined }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <span className="text-sm font-semibold tracking-tight text-brand">
          BPC Stock Evaluator
        </span>

        <div className="flex items-center gap-4">
          {email && <span className="text-sm text-slate-500">{email}</span>}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
