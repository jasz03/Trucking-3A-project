export type PriceRate = {
  base_charge: number;
  rate_per_km: number;
  margin_pct: number;
  tax_pct: number;
};

const cents = (value: number) => Math.round(value * 100) / 100;

// The database remains authoritative; this mirrors its draft formula for an immediate preview.
export function quotePrice(rate: PriceRate, distanceKm: number, trucks: number, costs: number[], discount: number) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isInteger(trucks) || trucks < 1 || costs.some((value) => !Number.isFinite(value) || value < 0) || !Number.isFinite(discount) || discount < 0)
    return null;
  const costPerTruck = cents(rate.base_charge + distanceKm * rate.rate_per_km + costs.reduce((sum, value) => sum + value, 0));
  const cost = cents(costPerTruck * trucks);
  const margin = cents(cost * rate.margin_pct / 100);
  const tax = cents((cost + margin) * rate.tax_pct / 100);
  const total = cents(cost + margin + tax - discount);
  return total >= 0 ? { cost, margin, tax, total } : null;
}
