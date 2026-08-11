"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function TickerQuickInput({ className }: { className?: string }) {
  const [value, setValue] = useState("");
  const router = useRouter();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const ticker = value.trim().toUpperCase();
    if (!ticker) return;
    router.push(`/evaluation/${encodeURIComponent(ticker)}`);
  }

  return (
    <form onSubmit={handleSubmit} className={`flex gap-2 ${className ?? ""}`}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ticker, e.g. GOOGL"
        aria-label="Ticker symbol"
        maxLength={10}
        className="w-40 rounded-md border border-subtle bg-surface px-3 py-2 text-sm uppercase tracking-wide text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <button
        type="submit"
        className="whitespace-nowrap rounded-md bg-brand px-4 py-2 text-sm font-medium text-accent transition hover:bg-brand-dark"
      >
        New evaluation
      </button>
    </form>
  );
}
