export const FACTION_ICON_FILE: Record<string, string> = {
  AdeptusAstartes: "Adeptus Astartes.png",
  AdeptusMechanicus: "Adeptus Mechanicus.png",
  Aeldari: "Aeldari.png",
  AstraMilitarum: "Astra Militarum.png",
  BlackLegion: "Black Legion.png",
  BlackTemplars: "Black Templars.png",
  BloodAngels: "Blood Angels.png",
  Custodes: "Adeptus Custodes.png",
  DarkAngels: "Dark Angels.png",
  DeathGuard: "Death Guard.png",
  EmperorsChildren: "Emperor's Children.png",
  Genestealers: "Genestealer Cults.png",
  LeaguesOfVotann: "Leagues of Votann.png",
  Necrons: "Necrons.png",
  Orks: "Orks.png",
  Sisterhood: "Adepta Sororitas.png",
  SpaceWolves: "Space Wolves.png",
  Tau: "T'au Empire.png",
  ThousandSons: "Thousand Sons.png",
  Tyranids: "Tyranids.png",
  Ultramarines: "Ultramarines.png",
  WorldEaters: "World Eaters.png",
};

export function factionIconUrl(faction: string): string | undefined {
  const file = FACTION_ICON_FILE[faction];
  if (!file) {
    return undefined;
  }
  return new URL(`../assets/factions/${file}`, import.meta.url).href;
}
