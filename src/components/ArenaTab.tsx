import { useState } from "react";
import { fetchPvpState } from "../api/fetch-pvp-state";
import { getPvpOpponentCard } from "../pvp/pvp-view-model";
import { ArenaOpponentCard } from "./ArenaOpponentCard";
import { Spinner } from "./Spinner";
import { ErrorIcon } from "./ErrorIcon";
import type { Environment, RawPvpState } from "../api/types";

interface ArenaTabProps {
  environment: Environment;
  pvpPosition: number | null;
  webCredentials: { userId: string; clientSecret: string };
}

// Self-contained tab that owns its own fetch/loading/error state, same pattern as GuildChatTab -
// NOT threaded through App.tsx's own state, since nothing else needs this data. Unlike
// GuildChatTab (Tauri-only, via findCredentials), this dispatches through fetchPvpState's
// isTauri() branch exactly like fetchCrusadeData - the web build needs userId/clientSecret from
// App.tsx's own state, which GuildChatTab's pattern has no equivalent for.
export function ArenaTab({ environment, pvpPosition, webCredentials }: ArenaTabProps) {
  const [pvpState, setPvpState] = useState<RawPvpState | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    if (pvpPosition === null) return;
    setLoading(true);
    setStatus("");
    try {
      const state = await fetchPvpState(environment, pvpPosition, webCredentials);
      setPvpState(state);
    } catch (error) {
      setStatus(`Failed: ${error}`);
    } finally {
      setLoading(false);
    }
  }

  if (pvpPosition === null) {
    return (
      <div>
        <h2 className="text-xl font-semibold">Arena</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Not currently in a PVP season.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 text-left">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Arena</h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            A closer look at the 3 opponents the game currently offers - their equipment, ability
            levels, relics, and the map they'll fight on, none of which the game itself shows before
            you pick.
          </p>
        </div>
        {pvpState && (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="shrink-0 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm shadow-sm dark:border-white/15 dark:bg-neutral-900/40"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {!pvpState && (
        <div className="flex flex-col items-center gap-2 py-8">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-black/10 bg-white px-4 py-2 shadow-sm dark:border-white/15 dark:bg-neutral-900/40"
          >
            {loading ? "Loading…" : "Load opponents"}
          </button>
        </div>
      )}

      <p className="inline-flex items-center gap-2">
        {loading && <Spinner seconds={60} />}
        {status && <ErrorIcon />}
        {status}
      </p>

      {pvpState && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {pvpState.pvpEncounters.map((encounter) => (
            <ArenaOpponentCard key={encounter.opponent.userId} card={getPvpOpponentCard(encounter)} />
          ))}
        </div>
      )}
    </div>
  );
}
