export function freshness(
  receivedAt: string | null,
  now = new Date(),
): "Live" | "Last known" | "No signal" {
  if (!receivedAt) return "No signal";
  const age = now.getTime() - new Date(receivedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= 5 * 60_000
    ? "Live"
    : "Last known";
}

export function manilaTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}
