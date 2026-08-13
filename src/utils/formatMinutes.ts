/** Formats a minute count as "Xh Ym" (or just "Ym" under an hour), for trip/charge time displays. */
export const formatMinutes = (mins: number): string => {
  const total = Math.max(0, Math.round(mins));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
};
