// Maps every faction to the Crusade side it fights on, matching the game's own for=Imperial/
// against=Devastation framing already used in crusade-domination-view-model.ts (Devastation bundles
// Chaos and Xenos together as the single opposing side - Tacticus's Crusade mode is Imperial-vs-
// everyone-else, not a strict three-way split). Used by the faction picker (FactionPicker.tsx /
// AnonymousCrusadeSection.tsx) to decide which side's leaderboard numbers to lead with.
export const FACTION_SIDE: Record<string, "for" | "against"> = {
  AdeptusAstartes: "for",
  AdeptusMechanicus: "for",
  AstraMilitarum: "for",
  BlackTemplars: "for",
  BloodAngels: "for",
  Custodes: "for",
  DarkAngels: "for",
  Sisterhood: "for",
  SpaceWolves: "for",
  Ultramarines: "for",
  BlackLegion: "against",
  DeathGuard: "against",
  EmperorsChildren: "against",
  ThousandSons: "against",
  WorldEaters: "against",
  Aeldari: "against",
  Genestealers: "against",
  LeaguesOfVotann: "against",
  Necrons: "against",
  Orks: "against",
  Tau: "against",
  Tyranids: "against",
};

export function factionSide(factionId: string): "for" | "against" | undefined {
  return FACTION_SIDE[factionId];
}
