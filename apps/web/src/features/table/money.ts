/**
 * SOT: money-format, paise-format, currency-display
 * WHAT   Turning integer paise into something a person reads.
 * WHY    The server sends paise and only paise; every screen that formats them by hand is a
 *        screen that will eventually divide by the wrong number. This is a pure display
 *        function - it never computes a price, it only renders one the server already decided.
 * WHERE  apps/web/src/features/table, apps/web/src/features/manage
 */

/** ₹263.50, or ₹299 when it is whole. Rupee symbol, Indian grouping. */
export function money(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/** "20 min", "1 hr 5 min". For prep times and how long a ticket has been sitting. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${String(Math.max(0, Math.round(seconds)))}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} hr` : `${String(hours)} hr ${String(rest)} min`;
}
