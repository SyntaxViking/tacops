// Which linear hero event quest(s) are currently live, as the ids the raidman-replay-gallery
// pipeline already uses (gallery.json's source.id, e.g. "linear_hero_event_4" - confirmed against
// a live GET_PLAYER capture: hero.liveEvents.liveEvents[].modules[].module.liveEventConfigId).
// Matched against bundled quest-battle data (see quest-battle-data.ts) to decide what to show in
// the Hero Quests tab. `hero` is GET_PLAYER's player.hero; anything missing yields an empty list
// rather than throwing. Returns every id found, not just the first - nothing rules out more than
// one being live at once, even though only one has been observed so far.
export function extractActiveQuestIds(hero: any): string[] {
  const liveEvents = hero?.liveEvents?.liveEvents ?? [];
  const ids: string[] = [];
  for (const event of liveEvents) {
    for (const m of event?.modules ?? []) {
      if (m?.type === "linearHeroEvent" && m.module?.liveEventConfigId) ids.push(m.module.liveEventConfigId);
    }
  }
  return ids;
}
