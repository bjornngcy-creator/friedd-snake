/**
 * Returns the current calendar month as 'YYYY-MM', evaluated in the
 * Asia/Singapore timezone. Used consistently for the monthly access-code
 * gate so "this month" means the same thing for every student regardless
 * of where the app is deployed or where the student is browsing from.
 */
export function currentMonthSGT(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;

  return `${year}-${month}`;
}
