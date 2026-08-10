import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export type TickerInfo = {
  ticker: string;
  companyName: string;
  price: number;
};

export type TickerLookupResult =
  | { ok: true; data: TickerInfo }
  | { ok: false; error: string };

const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * Looks up a ticker's company name + current price. Checks ticker_cache
 * first (fresh = fetched within 24h); on a stale or missing entry, calls
 * Finnhub's /quote and /stock/profile2 and upserts the cache. Server-only —
 * FINNHUB_API_KEY and the service-role client never reach the browser.
 * US tickers only for now.
 */
export async function getTickerInfo(rawTicker: string): Promise<TickerLookupResult> {
  const ticker = rawTicker.trim().toUpperCase();

  if (!ticker) {
    return { ok: false, error: "Enter a ticker symbol." };
  }
  if (!TICKER_PATTERN.test(ticker)) {
    return { ok: false, error: "That doesn't look like a valid ticker symbol." };
  }

  const admin = createAdminClient();

  const { data: cached } = await admin
    .from("ticker_cache")
    .select("ticker, company_name, price, fetched_at")
    .eq("ticker", ticker)
    .maybeSingle();

  const cachedIsUsable = Boolean(cached?.company_name) && cached?.price != null;

  if (cachedIsUsable) {
    const age = Date.now() - new Date(cached!.fetched_at).getTime();
    if (age < CACHE_TTL_MS) {
      return {
        ok: true,
        data: { ticker, companyName: cached!.company_name!, price: Number(cached!.price) },
      };
    }
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey || apiKey.includes("your-finnhub-key")) {
    if (cachedIsUsable) {
      return {
        ok: true,
        data: { ticker, companyName: cached!.company_name!, price: Number(cached!.price) },
      };
    }
    return { ok: false, error: "Price lookup is not configured yet." };
  }

  try {
    const [quoteRes, profileRes] = await Promise.all([
      fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { cache: "no-store" }
      ),
      fetch(
        `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
        { cache: "no-store" }
      ),
    ]);

    if (!quoteRes.ok || !profileRes.ok) {
      throw new Error(`Finnhub HTTP ${quoteRes.status}/${profileRes.status}`);
    }

    const quote = (await quoteRes.json()) as { c?: number };
    const profile = (await profileRes.json()) as { name?: string };

    const price = typeof quote.c === "number" ? quote.c : 0;
    const companyName = typeof profile.name === "string" ? profile.name.trim() : "";

    // Finnhub returns HTTP 200 with c: 0 and an empty profile object for
    // unknown tickers rather than a 404 — treat that as "not found".
    if (price <= 0 || !companyName) {
      if (cachedIsUsable) {
        return {
          ok: true,
          data: { ticker, companyName: cached!.company_name!, price: Number(cached!.price) },
        };
      }
      return { ok: false, error: "Ticker not found — check the symbol." };
    }

    await admin.from("ticker_cache").upsert(
      { ticker, company_name: companyName, price, fetched_at: new Date().toISOString() },
      { onConflict: "ticker" }
    );

    return { ok: true, data: { ticker, companyName, price } };
  } catch {
    // Network/API failure — fall back to a stale cache entry if we have one
    // rather than blocking the student entirely.
    if (cachedIsUsable) {
      return {
        ok: true,
        data: { ticker, companyName: cached!.company_name!, price: Number(cached!.price) },
      };
    }
    return { ok: false, error: "Couldn't reach the price service. Try again shortly." };
  }
}
