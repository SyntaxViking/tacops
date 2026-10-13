import { captureUrgency } from "../crusade/planet-tracker-view-model";

interface PointsRateIndicatorProps {
  pointsRemaining: number;
  hourlyRate: number;
}

// Urgency-colored className per captureUrgency's bucket - "imminent" gets an actual glow (a
// text-shadow, not just a color) since that's the one state meant to visually jump out.
const URGENCY_CLASS: Record<ReturnType<typeof captureUrgency>, string> = {
  imminent: "text-orange-500 [text-shadow:0_0_6px_theme(colors.orange.400)]",
  withinTwoHours: "text-amber-700 dark:text-amber-400",
  withinFourHours: "text-green-700 dark:text-green-400",
  normal: "",
};

// δ+123/hr style indicator shown next to the existing (X%) display - lowercase Greek delta (not
// the capital triangle), per the user's spec. Sign is always shown explicitly (+ or -) since a
// negative rate (losing ground) is just as meaningful here as a positive one.
export function PointsRateIndicator({ pointsRemaining, hourlyRate }: PointsRateIndicatorProps) {
  const rounded = Math.round(hourlyRate);
  const sign = rounded >= 0 ? "+" : "";
  const urgency = captureUrgency(pointsRemaining, hourlyRate);
  return <span className={`ml-1 font-medium ${URGENCY_CLASS[urgency]}`}>δ{sign}{rounded.toLocaleString()}/hr</span>;
}
