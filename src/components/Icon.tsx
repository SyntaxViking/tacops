interface IconProps {
  src: string;
  title?: string;
  // A small glowing ring around the icon - used by PortraitList to mark a character as required
  // (red) or optional (orange) for an expedition's suggested solution, without splitting them into
  // separate rows (see OperationCard.tsx) - picking units in power order across the whole group
  // matters more than which bucket each one happens to be in.
  halo?: "required" | "optional";
}

const HALO_CLASS: Record<"required" | "optional", string> = {
  required: "rounded-sm ring-2 ring-red-500 shadow-[0_0_4px_2px_rgba(239,68,68,0.8)]",
  optional: "rounded-sm ring-2 ring-orange-500 shadow-[0_0_4px_2px_rgba(249,115,22,0.8)]",
};

export function Icon({ src, title, halo }: IconProps) {
  return <img className={`block h-[30px] w-auto ${halo ? HALO_CLASS[halo] : ""}`} src={src} title={title} />;
}
