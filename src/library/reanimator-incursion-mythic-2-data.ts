// Mythic-difficulty lineups for the Reanimator Incursion replay playlist, keyed by the playlist's
// own battle number (not every battle has a Mythic entry, hence the gaps) - typed in by hand from
// https://tacticus-raidman.com/public/library/cpunerd-sekhetar-quest, not fetched from anywhere.
import { Rank } from "../rank/rank.enum";
import { Rarity } from "../rarity/rarity.enum";
import { RarityStars } from "../rarity/rarity-stars.enum";
import type { ReplayPlaylistBattle, ReplayPlaylistCharacterSlot } from "./replay-playlist-battle-view-model";

// Every character used across these battles - each is Mythic rarity, just at different
// ranks/stars/ability levels, so defined once and reused per battle below.
const ABADDON: ReplayPlaylistCharacterSlot = {
  characterId: "blackAbaddon",
  rank: Rank.Adamantine2,
  rarity: Rarity.Mythic,
  stars: RarityStars.OneBlueStar,
  abilityLevel1: 50,
  abilityLevel2: 60,
};
const KHARN: ReplayPlaylistCharacterSlot = {
  characterId: "worldKharn",
  rank: Rank.Adamantine2,
  rarity: Rarity.Mythic,
  stars: RarityStars.ThreeBlueStars,
  abilityLevel1: 60,
  abilityLevel2: 60,
};
const LAVISCUS: ReplayPlaylistCharacterSlot = {
  characterId: "emperExultant",
  rank: Rank.Adamantine2,
  rarity: Rarity.Mythic,
  stars: RarityStars.OneBlueStar,
  abilityLevel1: 38,
  abilityLevel2: 38,
};
const ROTBONE: ReplayPlaylistCharacterSlot = {
  characterId: "deathRotbone",
  rank: Rank.Diamond3,
  rarity: Rarity.Mythic,
  stars: RarityStars.OneBlueStar,
  abilityLevel1: 48,
  abilityLevel2: 44,
};
const MALADUS: ReplayPlaylistCharacterSlot = {
  characterId: "deathBlightlord",
  rank: Rank.Diamond3,
  rarity: Rarity.Mythic,
  stars: RarityStars.OneBlueStar,
  abilityLevel1: 47,
  abilityLevel2: 35,
};
const WRASK: ReplayPlaylistCharacterSlot = {
  characterId: "worldTerminator",
  rank: Rank.Diamond2,
  rarity: Rarity.Mythic,
  stars: RarityStars.OneBlueStar,
  abilityLevel1: 47,
  abilityLevel2: 47,
};

// "malarot" in the source notes = Maladus + Rotbone (both included).
const CORE_FIVE = [ABADDON, KHARN, MALADUS, ROTBONE, WRASK];
const LAVISCUS_FOR_WRASK = [ABADDON, KHARN, MALADUS, ROTBONE, LAVISCUS];

export const REANIMATOR_INCURSION_MYTHIC_2_BATTLES: ReplayPlaylistBattle[] = [
  {
    battleNumber: 15,
    characters: LAVISCUS_FOR_WRASK,
    replayUrl: "https://tacticus-raidman.com/public/replays/a99190349b6781ff89fd8ad50d6932bb0c2eda2a758260eabe49fd1adaae6b04",
  },
  {
    battleNumber: 12,
    characters: LAVISCUS_FOR_WRASK,
    replayUrl: "https://tacticus-raidman.com/public/replays/8e6bc23dc1d13e76c8116b28a8421de1e380f00c99ffa3be5e7284abfc8dfa8e",
  },
  {
    battleNumber: 11,
    characters: CORE_FIVE,
    replayUrl: "https://tacticus-raidman.com/public/replays/b53d72d5b46d61c742865fb5b9d80b9d0a5189b9d4c4daa0e5dd7fd4cc4d7273",
  },
  {
    battleNumber: 10,
    characters: CORE_FIVE,
    replayUrl: "https://tacticus-raidman.com/public/replays/3cee0868d41813d361d4efbff6221fe296707527287a339ea5ee48eef979b765",
  },
  {
    battleNumber: 8,
    characters: LAVISCUS_FOR_WRASK,
    replayUrl: "https://tacticus-raidman.com/public/replays/465757d9bec3c36150ad76b7c375e81336df3339b42db4025e486053be53b7ae",
  },
  {
    battleNumber: 7,
    characters: CORE_FIVE,
    replayUrl: "https://tacticus-raidman.com/public/replays/827caa50361df106bda9f3f47b33238a5bcad3199f17df9d8b3887e9fe838583",
  },
  {
    battleNumber: 5,
    characters: [ABADDON, MALADUS, ROTBONE],
    replayUrl: "https://tacticus-raidman.com/public/replays/b9c8f790a856376a11e59d3304eb1dd4d14a6dbeb105ef3c595f20ff78c41071",
  },
  {
    battleNumber: 3,
    characters: CORE_FIVE,
    replayUrl: "https://tacticus-raidman.com/public/replays/8cbe0da33e2b20a8f76998ec598d065f82627bf2f2dadcf11115cfca28de1e1b",
  },
  {
    battleNumber: 2,
    characters: CORE_FIVE,
    replayUrl: "https://tacticus-raidman.com/public/replays/d705d188775562cde4743458eda020cea355ae2697a41704d88be805d27279db",
  },
  {
    battleNumber: 1,
    characters: CORE_FIVE,
    replayUrl: "https://tacticus-raidman.com/public/replays/db6969d441e9b187697ccb7892bc7a63fecb5644bb3e58cf45272318cb9c2fbb",
  },
];
