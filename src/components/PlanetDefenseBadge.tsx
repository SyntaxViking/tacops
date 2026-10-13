const DEFENSE_ICON_URL = new URL("../assets/resources/ui_icon_crusade_buff_planetary_defense.png", import.meta.url).href;

interface PlanetDefenseBadgeProps {
  imperial: number;
  devastation: number;
}

// Renders nothing when neither side has any planetary defenses laid.
export function PlanetDefenseBadge({ imperial, devastation }: PlanetDefenseBadgeProps) {
  if (imperial <= 0 && devastation <= 0) return null;
  return (
    <span className="flex items-center gap-0.5" title="Planetary defenses">
      <img src={DEFENSE_ICON_URL} alt="" className="h-4 w-4" />
      {imperial > 0 && <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">+{imperial}</span>}
      {devastation > 0 && <span className="text-xs font-semibold text-red-600 dark:text-red-400">+{devastation}</span>}
    </span>
  );
}
