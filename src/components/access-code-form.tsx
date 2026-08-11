"use client";

import { useActionState } from "react";
import { verifyAccessCode, type AccessCodeState } from "@/lib/actions/access-code";

const initialState: AccessCodeState = {};

export function AccessCodeForm() {
  const [state, formAction, pending] = useActionState(verifyAccessCode, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="code" className="block text-sm font-medium text-slate-700">
          Access code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          autoComplete="off"
          autoFocus
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tracking-wide focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand px-4 py-2 text-sm font-medium text-accent transition hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? "Checking…" : "Unlock this month"}
      </button>
    </form>
  );
}
