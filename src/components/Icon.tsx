interface IconProps {
  src: string;
  title?: string;
  // A small glow around the icon - used by PortraitList to mark a character as required (ruby) or
  // optional (olive green) for an expedition's suggested solution, without splitting them into
  // separate rows (see OperationCard.tsx) - picking units in power order across the whole group
  // matters more than which bucket each one happens to be in.
  //
  // drop-shadow, not a ring/box-shadow: character portraits are round art on a transparent square
  // image, so a ring/box-shadow (which outlines the element's rectangular box) would draw a square
  // nowhere near the visible round icon. drop-shadow follows the image's own alpha shape instead,
  // so the glow actually hugs the round portrait regardless of how much transparent padding the
  // source PNG has around it. Three stacked shadows at increasing blur radii for a real bloom
  // that's actually visible at this icon's small (30px) size, not just a faint 1-2px edge.
  halo?: "required" | "optional";
  // "sm" only exists for OperationCard's own character row (see PortraitList/DispatchedUnitsRow) -
  // on a narrow phone screen, that row shares its card with a rewards column (OperationCard.tsx's
  // grid-cols-2), leaving too little width for all 5 of the default 30px icons to sit on one line
  // without wrapping, which makes the card taller than it needs to be. Every other caller keeps
  // the default "md".
  size?: "sm" | "md";
}

const SIZE_CLASS: Record<"sm" | "md", string> = {
  sm: "h-[22px]",
  md: "h-[30px]",
};

// Ruby (#9B111E) and olive (#808000) - not Tailwind's red-500/orange-500, picked specifically for
// a richer, less primary-colored pair.
const HALO_FILTER: Record<"required" | "optional", string> = {
  required:
    "drop-shadow(0 0 3px rgba(155,17,30,1)) drop-shadow(0 0 6px rgba(155,17,30,1)) drop-shadow(0 0 10px rgba(155,17,30,0.9))",
  optional:
    "drop-shadow(0 0 3px rgba(128,128,0,1)) drop-shadow(0 0 6px rgba(128,128,0,1)) drop-shadow(0 0 10px rgba(128,128,0,0.9))",
};

export function Icon({ src, title, halo, size = "md" }: IconProps) {
  const sizeClass = SIZE_CLASS[size];
  if (!halo) {
    return <img className={`block ${sizeClass} w-auto`} src={src} title={title} />;
  }
  // Wrapped in its own isolated, z-raised box: a drop-shadow's paint region can otherwise get
  // clipped or painted-over at odd boundaries when a card grid stretches cards to match a row's
  // tallest one (align-items: stretch, CSS Grid's default) - seen as a line cutting through the
  // glow specifically in a grid's last row. `isolation: isolate` forces its own stacking context
  // so neither the stretch nor a neighboring card's paint order can interfere with it.
  return (
    <span className="relative z-10 inline-block" style={{ isolation: "isolate" }}>
      <img className={`block ${sizeClass} w-auto`} src={src} title={title} style={{ filter: HALO_FILTER[halo] }} />
    </span>
  );
}
