import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReplayPlaylistBattleListPage } from "../../src/components/library/ReplayPlaylistBattleListPage";
import { REANIMATOR_INCURSION_MYTHIC_2_BATTLES } from "../../src/library/reanimator-incursion-mythic-2-data";
import "../../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReplayPlaylistBattleListPage title="Reanimator Incursion - Mythic 2" battles={REANIMATOR_INCURSION_MYTHIC_2_BATTLES} />
  </StrictMode>,
);
