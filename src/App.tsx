import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Spinner } from "./components/Spinner";
import { ErrorIcon } from "./components/ErrorIcon";
import { EnvironmentToggle } from "./components/EnvironmentToggle";
import { DataSourceToggle } from "./components/DataSourceToggle";
import { ViewModeToggle, type ViewMode } from "./components/ViewModeToggle";
import { Tabs } from "./components/Tabs";
import { OperationsTable } from "./components/OperationsTable";
import { OperationsCards } from "./components/OperationsCards";
import { CharactersTable } from "./components/CharactersTable";
import { MowTable } from "./components/MowTable";
import { GuildChatTab } from "./components/GuildChatTab";
import { ArenaTab } from "./components/ArenaTab";
import { OnslaughtTab } from "./components/OnslaughtTab";
import { BoardCoverageTab } from "./components/BoardCoverageTab";
import { CrusadeTab } from "./components/CrusadeTab";
import { MonitorTab } from "./components/MonitorTab";
import { HeroQuestsTab } from "./components/HeroQuestsTab";
import { RewardPriorityPicker } from "./components/RewardPriorityPicker";
import { RequiredCharacterPool } from "./components/RequiredCharacterPool";
import { ResourceTokens } from "./components/ResourceTokens";
import { BuildTimestamp } from "./components/BuildTimestamp";
import { CrusadePointsRateIndicator } from "./components/CrusadePointsRateIndicator";
import { RolloverCooldownModal } from "./components/RolloverCooldownModal";
import { msUntilRolloverWindowEnds } from "./rollover-window";
import { StaleVersionBanner } from "./components/StaleVersionBanner";
import { Toast } from "./components/Toast";
import { registerStaleVersionHandler, startVersionCheck } from "./version-check";
import { fetchPlayerData } from "./api/fetch-player-data";
import { entryIsUnavailable } from "./board/board-view-model";
import { activePlanetIds, fetchCrusadeData, fetchPlanetLeaderboard, resolveMyFactionId } from "./api/fetch-crusade-data";
import { clearWebCredential, retrieveWebCredential, storeWebCredential } from "./api/store-web-credential";
import { fetchUserPreferences, setAntiFavoritedCharacters, setFavoritedCharacters, setFavoritedPlanets } from "./api/user-preferences";
import { getDevDataSource, setDevDataSource, type DevDataSource } from "./api/dev-data-source";
import { fetchCrusadeCache } from "./api/fetch-crusade-cache";
import { fetchLeaderboardCache } from "./api/fetch-leaderboard-cache";
import { seedPlanetRefreshStateFromCache, toSeededPlanetLeaderboard } from "./api/crusade-cache-seed";
import { isPlanetAutoRefreshable } from "./crusade/crusade-domination-view-model";
import { toggleStarredPlanet } from "./crusade/starred-planets";
import { toggleTrackedPlanetId } from "./crusade/tracked-planet";
import { appendTrackedSample, computeTotalHourlyRate, createTrackedPlanetState, mergeHistoryIntoTrackedPlanetState, restartIfRecontested } from "./crusade/planet-tracker-view-model";
import { fetchAllPlanetHistory, fetchPlanetHistory } from "./api/fetch-planet-history";
import { AnonymousCrusadeSection } from "./components/AnonymousCrusadeSection";
import { trackUsage } from "./track-usage";
import type { BoardAssignmentResult } from "./board/board-solver";
import type { SolveRequest, SolveResponse } from "./board/board-solver.worker";
import type { PriorityKey } from "./board/reward-amount";
import type { CrusadeData, CrusadeSectorMap, Environment, ExpeditionBoardEntry, OnslaughtBoards, PlanetDefenseCounts, PlanetLeaderboard, PlanetRefreshEntry, PlayerResources, RawUnit } from "./api/types";
import type { HeroQuestJar } from "./hero-quests/hero-quest-view-model";
import type { TrackedPlanetSample, TrackedPlanetState } from "./crusade/planet-tracker-view-model";

const TABS = [
  { id: "operations", label: "Operations" },
  { id: "crusade", label: "Crusade" },
  { id: "monitor", label: "Monitor" },
  { id: "guildchat", label: "Guild Chat" },
  { id: "arena", label: "Arena" },
  { id: "onslaught", label: "Onslaught" },
  { id: "characters", label: "Characters" },
  { id: "mows", label: "Machines of War" },
  { id: "coverage", label: "Board Coverage" },
  { id: "heroquests", label: "Hero Quests" },
];

const FETCH_COUNTDOWN_SECONDS = 60;
// Outer watchdog for the board-solver's optimal-solve worker (see its own effect for why this
// exists) - if it hasn't responded by this point, it's killed and the already-computed greedy
// result (see GREEDY_TIMEOUT_NOTE below) is used to unblock the UI instead.
const WATCHDOG_MS = 20_000;
// Shown while the greedy result is up and the real optimization is still running behind the
// spinner overlay - see the solver effect.
const GREEDY_PREVIEW_NOTE = "This is a quick solve while a full optimization runs in the background.";
// Shown once the optimal attempt concludes (success or failure) without ever improving on the
// greedy result that's already on screen - same assignment, just relabeled now that nothing
// better is coming.
const GREEDY_TIMEOUT_NOTE = "The optimizer took too long to respond, so this is a quick fallback assignment (not necessarily optimal).";
// The visible countdown must never hit 0 before WATCHDOG_MS could possibly fire - it previously
// had its own separately-tuned value (12s) that drifted under WATCHDOG_MS's actual 20s, so the
// spinner looked stuck for that 8s gap even though it was still legitimately working. Derived
// from WATCHDOG_MS directly (plus a few seconds of slack) so the two can't drift apart like that
// again - in practice the greedy preview now lands almost immediately, well before this matters.
const SOLVER_COUNTDOWN_SECONDS = Math.ceil(WATCHDOG_MS / 1000) + 5;

const LOCAL_STORAGE_USER_ID_KEY = "tacops:userId";
const LOCAL_STORAGE_CLIENT_SECRET_KEY = "tacops:clientSecret";

export function App() {
  const [environment, setEnvironment] = useState<Environment>("prod");
  // Tauri-only (see dev-data-source.ts) - initialized from localStorage so the choice survives
  // app restarts; meaningless/always "local" on the web build.
  const [devDataSource, setDevDataSourceState] = useState<DevDataSource>(() => getDevDataSource());
  function changeDevDataSource(source: DevDataSource) {
    setDevDataSource(source);
    setDevDataSourceState(source);
  }
  const [activeTab, setActiveTab] = useState(TABS[0].id);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [selectedExpeditionId, setSelectedExpeditionId] = useState<string | null>(null);
  // Defaults to true so the full app is shown on load (no anonymous-crusade gate, no title tap
  // needed). The title tap / "8" key still toggles it, but the default state is the app itself.
  const [devModeEnabled, setDevModeEnabled] = useState(true);
  // Mirrors devModeEnabled for the auto-login effect below, which checks this from inside a
  // retrieveWebCredential().then() callback - that closure captures devModeEnabled's value at
  // mount (always false), so it needs the current value via a ref, same reasoning as
  // favoritedPlanetIdsRef/trackedPlanetIdRef elsewhere in this file.
  const devModeEnabledRef = useRef(false);
  devModeEnabledRef.current = devModeEnabled;
  const lastEightPressRef = useRef(0);
  // Some password managers autofill a field via simulated keystrokes - a user whose userId
  // happens to contain an "8" would otherwise have every such keystroke toggle dev mode as it's
  // typed, which swaps the whole layout out from under the login form mid-autofill. Latches after
  // the very first "8" (real or simulated) so this can only ever fire once per page load - tapping
  // the title 8 times (handleTitleTap below) still works afterward as the keyboard-free fallback.
  const eightKeyUsedRef = useRef(false);
  const titleTapCountRef = useRef(0);
  const lastTitleTapRef = useRef(0);
  // Pre-populated from localStorage so a returning visitor doesn't have to re-enter credentials
  // (or wait for the browser's own autofill to kick in on field interaction). Written on every
  // go() - see below.
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_USER_ID_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [clientSecret, setClientSecret] = useState(() => {
    try {
      return localStorage.getItem(LOCAL_STORAGE_CLIENT_SECRET_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [showClientSecret, setShowClientSecret] = useState(false);
  const AUTO_LOGIN_STORAGE_KEY = "tacops.autoLoginEnabled";
  // Opt-in, off by default - the auto-login effect below only ever attempts
  // retrieveWebCredential() when this is true, and go() only ever calls storeWebCredential() when
  // this is true, so a user who never checks the box gets neither half of the feature at all.
  const [autoLoginEnabled, setAutoLoginEnabledState] = useState(() => {
    try {
      return localStorage.getItem(AUTO_LOGIN_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  function setAutoLoginEnabled(enabled: boolean) {
    setAutoLoginEnabledState(enabled);
    try {
      localStorage.setItem(AUTO_LOGIN_STORAGE_KEY, String(enabled));
    } catch {
      // Best-effort - worst case the preference doesn't persist across reloads.
    }
  }
  const [status, setStatus] = useState("");
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [secondsRemaining, setSecondsRemaining] = useState(FETCH_COUNTDOWN_SECONDS);
  const [rolloverMsRemaining, setRolloverMsRemaining] = useState(() => msUntilRolloverWindowEnds(Date.now()));
  const [board, setBoard] = useState<ExpeditionBoardEntry[]>([]);
  const [heroes, setHeroes] = useState<RawUnit[]>([]);
  const [favoritedCharacterIds, setFavoritedCharacterIds] = useState<
    Set<string>
  >(new Set());
  const [antiFavoritedCharacterIds, setAntiFavoritedCharacterIds] = useState<
    Set<string>
  >(new Set());
  const [favoritedPlanetIds, setFavoritedPlanetIds] = useState<Set<string>>(
    new Set(),
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [staleVersionDetected, setStaleVersionDetected] = useState(false);
  const [machinesOfWar, setMachinesOfWar] = useState<RawUnit[]>([]);
  const [adViewsRemaining, setAdViewsRemaining] = useState<number | null>(null);
  const [resources, setResources] = useState<PlayerResources | null>(null);
  const [heroQuestJars, setHeroQuestJars] = useState<HeroQuestJar[]>([]);
  const [activeQuestIds, setActiveQuestIds] = useState<string[]>([]);
  const [sectorMap, setSectorMap] = useState<CrusadeSectorMap>({ planets: [], connections: [] });
  const [planetDefenses, setPlanetDefenses] = useState<Record<string, PlanetDefenseCounts>>({});
  const [onslaughtBoards, setOnslaughtBoards] = useState<OnslaughtBoards>({ Imperial: [], Chaos: [], Xenos: [] });
  const [rawPlayerData, setRawPlayerData] = useState<unknown>(null);
  const [crusadeData, setCrusadeData] = useState<CrusadeData | null>(null);
  // Mirrors crusadeData for the dedicated tracker loop below (see the tracker effect) - that loop
  // must always read the latest planet data across ticks, not a stale closure, without depending on
  // crusadeData itself in its effect deps (which would tear the loop down and rebuild it on every
  // routine score refresh). Written synchronously at every setCrusadeData call site.
  const crusadeDataRef = useRef<CrusadeData | null>(null);
  // Bumped only in go() - unlike crusadeData itself, this changes exactly once per GO click, never
  // on the background per-planet score refresh inside fetchOnePlanet (which also calls
  // setCrusadeData to keep planet scores fresh - see below). The rolling-refresh scheduler effect
  // keys off this instead of crusadeData so a routine planet-score update can't tear down and
  // restart every worker mid-flight.
  const [crusadeSessionId, setCrusadeSessionId] = useState(0);
  const [planetRefreshState, setPlanetRefreshState] = useState<
    Map<string, PlanetRefreshEntry>
  >(new Map());
  const [crusadeError, setCrusadeError] = useState<string | null>(null);
  // Drives the Crusade tab's "refresh all leaderboards" button (see refreshAllPlanetsNow) - a ref
  // (not just the state) so a rapid double-click can't start a second overlapping pass before the
  // first one's synchronous guard check has a chance to see the state update.
  const [isRefreshingAllPlanets, setIsRefreshingAllPlanets] = useState(false);
  const isRefreshingAllPlanetsRef = useRef(false);
  // Mirrors planetRefreshState for the scheduler's long-lived async worker loops (see the effect
  // below) - those loops must always read the latest state across ticks, not a stale closure, and
  // every mutation of planet-refresh state writes here synchronously before mirroring into
  // planetRefreshState via setPlanetRefreshState. Nothing schedules off the state variable itself.
  const planetRefreshStateRef = useRef<Map<string, PlanetRefreshEntry>>(
    new Map(),
  );
  // Same reason as planetRefreshStateRef: the scheduler's long-lived loops must see the latest
  // starred set (it decides which planets keep auto-refreshing), not a stale closure.
  const favoritedPlanetIdsRef = useRef<ReadonlySet<string>>(new Set());
  favoritedPlanetIdsRef.current = favoritedPlanetIds;
  // The single planet (if any) the user has pinned to the top of the Domination tab for live,
  // no-delay refreshing - see the dedicated tracker effect below. In-memory only, never persisted;
  // resets to null on every go() (see go()'s reset points) and the instant the user untracks it.
  const [trackedPlanetId, setTrackedPlanetId] = useState<string | null>(null);
  const trackedPlanetIdRef = useRef<string | null>(null);
  trackedPlanetIdRef.current = trackedPlanetId;
  const [trackedPlanetState, setTrackedPlanetState] =
    useState<TrackedPlanetState | null>(null);
  // Mirrors trackedPlanetState for the tracker loop, same reason as the refs above - specifically
  // so the loop can check .frozen without depending on trackedPlanetState itself in its effect deps
  // (which would tear down/rebuild the loop on every single sample).
  const trackedPlanetStateRef = useRef<TrackedPlanetState | null>(null);
  trackedPlanetStateRef.current = trackedPlanetState;
  // Every planet's persisted history, for the Monitor tab (MonitorTab.tsx) - fetched and kept
  // fresh here, not inside MonitorTab itself, so it survives switching away from the Monitor tab
  // and back (MonitorTab is only ever mounted while its tab is active, so state owned inside it
  // would reset to empty and have to re-fetch from scratch on every tab switch). Shared,
  // account-agnostic data (the same open /api/planet-history-all endpoint everyone reads), so this
  // starts and keeps refreshing independent of go()/crusadeSessionId/activeTab.
  const [planetHistoryByPlanet, setPlanetHistoryByPlanet] = useState<Map<string, TrackedPlanetSample[]>>(new Map());
  // Bumped on every scheduler effect setup/teardown so a stale in-flight fetch from a torn-down
  // session (a previous GO, unmount, or React StrictMode's dev-mode double-invoke) can never
  // commit into a newer session's state.
  const generationRef = useRef(0);
  // Set the instant activeTab leaves "crusade", cleared the instant it returns - drives the
  // 5-minute/1-hour auto-refresh cadence switch below.
  const awayFromCrusadeSinceRef = useRef<number | null>(null);
  // Frozen once per go() alongside the initial planetRefreshState seed, so the scheduler's
  // long-lived loops always fetch with the credentials/crusade identifiers from that session,
  // not whatever environment/userId/clientSecret happen to be in state by the time a given tick
  // actually runs.
  const sessionParamsRef = useRef<{
    environment: Environment;
    crusadeId: string;
    seasonNumber: number;
    chosenSide: string;
    myFactionId: string;
    userId: string;
    clientSecret: string;
  } | null>(null);
  const [priorityOrder, setPriorityOrder] = useState<
    [PriorityKey, PriorityKey, PriorityKey, PriorityKey]
  >(["rarity", "crusadeBomb", "intel", "crusadeNpc"]);

  // solverState tracks whether there's a usable assignment to show at all (becomes "success" the
  // moment EITHER the greedy or the optimal result lands, whichever first) - separate from
  // solverOptimizing, which tracks whether the spinner overlay should still be up (true until the
  // optimal attempt itself concludes, one way or another). The two decouple on purpose: the greedy
  // result renders for real (fulfillment, required/optional characters, the lot) the instant it
  // lands, with the spinner as a translucent overlay on top of it rather than hiding it - see the
  // solver effect below and its render site.
  const [solverState, setSolverState] = useState<"idle" | "solving" | "success" | "error">("idle");
  const [solverOptimizing, setSolverOptimizing] = useState(false);
  const [solverSecondsRemaining, setSolverSecondsRemaining] = useState(SOLVER_COUNTDOWN_SECONDS);
  const [assignment, setAssignment] = useState<BoardAssignmentResult>(new Map());
  const [solverError, setSolverError] = useState<string>();
  const [solverIncompleteReason, setSolverIncompleteReason] = useState<string>();
  // Two workers run in parallel for every solve (see the effect below): greedy (fast, shown
  // immediately) and optimal (slow, supersedes it when/if it finishes).
  const greedyWorkerRef = useRef<Worker | null>(null);
  const optimalWorkerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  // Terminate any worker still running on unmount (e.g. hot-reload in dev).
  useEffect(() => {
    return () => {
      greedyWorkerRef.current?.terminate();
      optimalWorkerRef.current?.terminate();
    };
  }, []);

  // Forces a stale tab to reload once a newer build has deployed (see src/version-check.ts) -
  // specifically so an old tab's client logic (e.g. a tracker loop predating some future rate
  // limit) can't keep running indefinitely against our Worker. Tauri's own desktop build has no
  // "reload the page" concept and ships through GitHub Releases, not this web deploy, so it's
  // exempt entirely. A 1-minute interval is deliberately tight - re-fetching "/" never reaches the
  // Worker at all (served straight from Cloudflare's static asset cache, see version-check.ts's own
  // comment), so polling this often costs nothing, and it bounds how long a stale tab can keep
  // hammering the Worker with old behavior after a new deploy to about a minute.
  useEffect(() => {
    if (isTauri()) return;
    const VERSION_CHECK_INTERVAL_MS = 3600 * 1000;
    return startVersionCheck(() => setStaleVersionDetected(true), VERSION_CHECK_INTERVAL_MS);
  }, []);

  // The other half of staleness detection: the server itself rejects any /api/fetch-* call from a
  // too-old client with HTTP 426 (worker/client-version.ts), before doing any work - this is what
  // protects a tab that's already open right now, running JS from before any of this version
  // machinery existed. src/api/fetch-with-timeout.ts calls reportStaleVersion() the moment that
  // happens; this just wires it to the same banner as the polling check above. Harmless to
  // register in Tauri too (it never goes through fetchWithTimeout, so this simply never fires).
  useEffect(() => {
    registerStaleVersionHandler(() => setStaleVersionDetected(true));
  }, []);

  // A few seconds' grace after the banner appears (see StaleVersionBanner) before forcing the
  // reload, purely so it's visible at all rather than the page vanishing with no explanation.
  useEffect(() => {
    if (!staleVersionDetected) return;
    const timer = setTimeout(() => window.location.reload(), 3000);
    return () => clearTimeout(timer);
  }, [staleVersionDetected]);

  // The solver runs entirely in Web Workers (javascript-lp-solver is synchronous with no
  // async/worker mode of its own) so it can never block the main thread. Two run in parallel for
  // every solve: a greedy one (forceGreedy, polynomial, no search - can't hang, and is normally
  // done almost instantly) and the real optimal one (the full lexicographic LP, which can
  // legitimately take a while on a hard board). The greedy result renders for real the instant it
  // lands (solverState "success", so the board shows real fulfillment/required-character data,
  // not placeholders) with a note that a better one may still be coming - the spinner stays up as
  // a translucent overlay on top of it (solverOptimizing), not hiding it, so the user can see both
  // that something was found and that work is still happening. The optimal result always
  // supersedes it outright when it finishes (the LP is never worse than greedy, by construction);
  // if the optimal attempt fails or times out instead, the greedy result already on screen is
  // simply relabeled rather than recomputed - either way solverOptimizing clears and the overlay
  // goes away within WATCHDOG_MS at the very most. Terminating and recreating both workers on
  // every change (rather than queuing) guarantees a priority-order change doesn't have to wait
  // behind a slow, now-stale solve.
  useEffect(() => {
    // Mirrors solveBoardAssignment's own openBoards.length===0 fast path (board-solver.ts) - when
    // every entry is already Dispatched/Completed there's nothing to solve, so this skips
    // spinning up (and re-spinning-up on every render) a whole Web Worker just to get back the
    // same empty assignment the worker itself would return instantly. Previously this case fell
    // through to the worker path below every time, needlessly recreating the worker.
    if (board.length === 0 || heroes.length === 0 || board.every(entryIsUnavailable)) {
      greedyWorkerRef.current?.terminate();
      optimalWorkerRef.current?.terminate();
      setAssignment(new Map());
      setSolverState("idle");
      setSolverOptimizing(false);
      setSolverError(undefined);
      setSolverIncompleteReason(undefined);
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    setSolverState("solving");
    setSolverOptimizing(true);
    setSolverError(undefined);
    setSolverIncompleteReason(undefined);

    const baseRequest = {
      requestId,
      board,
      heroes,
      priorityOrder,
      favoritedCharacterIds: [...favoritedCharacterIds],
      antiFavoritedCharacterIds: [...antiFavoritedCharacterIds],
    };

    // Tracks whether the optimal attempt has already had the final say (a real result, a worker
    // error, or the watchdog giving up on it) - guards against the watchdog firing twice and
    // against a late/failed optimal response overwriting a result it's already lost the race to.
    let optimalSettled = false;
    // Once the optimal side settles (whichever way), falls back to whatever the greedy worker
    // already produced - computed eagerly, in parallel, so it's instantly ready the moment it's
    // needed, whether that's to relabel it after a timeout/error or because it's the only result
    // that ever showed up at all.
    let greedyResult: SolveResponse | undefined;

    function finishWithGreedyFallback(errorIfNoGreedy: string) {
      optimalWorkerRef.current?.terminate();
      setSolverOptimizing(false);
      if (greedyResult?.status === "success") {
        setAssignment(new Map(greedyResult.assignmentEntries));
        setSolverIncompleteReason(GREEDY_TIMEOUT_NOTE);
        setSolverError(undefined);
        setSolverState("success");
      } else {
        // Shouldn't normally happen - greedy is polynomial and far faster than WATCHDOG_MS - but
        // there's genuinely nothing to show if it hasn't landed (or itself failed) by now.
        setSolverError(errorIfNoGreedy);
        setSolverIncompleteReason(undefined);
        setSolverState("error");
      }
    }

    greedyWorkerRef.current?.terminate();
    const greedyWorker = new Worker(new URL("./board/board-solver.worker.ts", import.meta.url), { type: "module" });
    greedyWorkerRef.current = greedyWorker;
    greedyWorker.onmessage = (event: MessageEvent<SolveResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale response, ignore
      greedyResult = event.data;
      if (optimalSettled) return; // the optimal attempt already had the final say - don't touch the UI
      if (event.data.status === "success") {
        setAssignment(new Map(event.data.assignmentEntries));
        setSolverIncompleteReason(GREEDY_PREVIEW_NOTE);
        setSolverError(undefined);
        setSolverState("success"); // real data now - solverOptimizing (still true) is what keeps the overlay up
      }
      // A failed greedy solve (shouldn't happen - solveGreedyFallback has no throw path) just
      // leaves the spinner fully covering an empty board; the optimal attempt is still in flight
      // and gets the final say either way.
    };
    greedyWorker.postMessage({ ...baseRequest, forceGreedy: true } satisfies SolveRequest);

    optimalWorkerRef.current?.terminate();
    const optimalWorker = new Worker(new URL("./board/board-solver.worker.ts", import.meta.url), { type: "module" });
    optimalWorkerRef.current = optimalWorker;

    // runPasses's own shared deadline (board-solver.ts's SOLVE_TIMEOUT_MS) bounds a *returning*
    // solver.Solve() call, but can't help if a call never returns at all - its branch-and-bound
    // loop only checks the deadline between nodes, so one pathologically slow node (or simplex
    // cycling on a degenerate root relaxation) can run for an unbounded time. This is the outer
    // safety net for exactly that.
    const watchdogTimer = setTimeout(() => {
      if (optimalSettled) return;
      optimalSettled = true;
      console.warn("[App] board solver watchdog fired - the optimal attempt never returned in time, keeping the greedy result");
      finishWithGreedyFallback("both the optimizer and the quick fallback took too long to respond");
    }, WATCHDOG_MS);

    optimalWorker.onmessage = (event: MessageEvent<SolveResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale response, ignore
      if (optimalSettled) return;
      optimalSettled = true;
      clearTimeout(watchdogTimer);
      if (event.data.status === "success") {
        setAssignment(new Map(event.data.assignmentEntries));
        setSolverIncompleteReason(event.data.solveStatus === "incomplete" ? event.data.message : undefined);
        setSolverError(undefined);
        setSolverState("success");
        setSolverOptimizing(false);
      } else {
        finishWithGreedyFallback(event.data.error);
      }
    };
    optimalWorker.postMessage({ ...baseRequest, forceGreedy: false } satisfies SolveRequest);

    return () => {
      clearTimeout(watchdogTimer);
      greedyWorker.terminate();
      optimalWorker.terminate();
    };
  }, [board, heroes, priorityOrder, favoritedCharacterIds, antiFavoritedCharacterIds]);

  // Shared by toggleDevMode's "turning off" branch and logout() below - both return to the
  // anonymous view's own default tab/view-mode, not whatever the account happened to leave set.
  function resetToAnonymousView() {
    setViewMode("cards");
    setActiveTab("operations");
  }

  function toggleDevMode() {
    setDevModeEnabled((current) => {
      const next = !current;
      if (!next) resetToAnonymousView();
      return next;
    });
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedExpeditionId(null);
        return;
      }
      // 1. Bail out if the '8' key was used for something else
      if (eightKeyUsedRef.current) return;
      // 2. Check for F9
      if (e.key !== "F9" || e.repeat) return;
      
      const now = Date.now();
      if (now - lastEightPressRef.current < 400) return;
      lastEightPressRef.current = now;
      eightKeyUsedRef.current = true;
      toggleDevMode();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Mobile has no "8" key, so tapping the title once toggles dev mode (mirroring the desktop
  // shortcut). Kept as a toggle rather than a one-way switch so the anonymous crusade view is
  // still reachable if wanted.
  function handleTitleTap() {
    const now = Date.now();
    const TITLE_TAP_WINDOW_MS = 600;
    titleTapCountRef.current =
      now - lastTitleTapRef.current > TITLE_TAP_WINDOW_MS
        ? 1
        : titleTapCountRef.current + 1;
    lastTitleTapRef.current = now;
    if (titleTapCountRef.current >= 1) {
      titleTapCountRef.current = 0;
      toggleDevMode();
    }
  }

  // Purely a visual "roughly how long this could take" indicator - actual enforcement is via the
  // RPC timeouts in fetchPlayerData, not this countdown.
  useEffect(() => {
    if (fetchState !== "loading") return;
    setSecondsRemaining(FETCH_COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setSecondsRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Same purely-visual purpose as the fetch countdown above - actual enforcement is WATCHDOG_MS.
  // Keyed on solverOptimizing, not solverState - the overlay (and this countdown alongside it)
  // stays up for as long as the optimal attempt is still running, even after solverState has
  // already flipped to "success" once the greedy result lands underneath it.
  useEffect(() => {
    if (!solverOptimizing) return;
    setSolverSecondsRemaining(SOLVER_COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setSolverSecondsRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [solverOptimizing]);

  // Drives RolloverCooldownModal - unconditional (not gated on login/fetch state, unlike the two
  // countdowns above) since the modal needs to cover the pre-login screen too (see its own
  // comment). This is purely the *visual* half of the rollover guarantee - the actual traffic
  // block is enforced independently at the transport layer (rollover-guard.ts,
  // invoke-with-timeout.ts) and server-side (worker/index.ts), so a clock that's merely a few
  // seconds off here never lets real traffic through, it just mis-times when the overlay shows.
  useEffect(() => {
    const interval = setInterval(() => {
      setRolloverMsRemaining(msUntilRolloverWindowEnds(Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  function toggleSelection(expeditionId: string) {
    setSelectedExpeditionId((current) =>
      current === expeditionId ? null : expeditionId,
    );
  }

  // overrideCredentials lets the auto-login effect below trigger a login with a retrieved
  // credential before it's ever reflected in userId/clientSecret state (React state updates
  // aren't synchronous, so setUserId/setClientSecret immediately followed by go() would still see
  // the old, empty state inside this call) - falls back to current state when omitted, so the
  // manual GO button's onSubmit (which calls go() with no arguments) is completely unaffected.
  async function go(overrideCredentials?: { userId: string; clientSecret: string }) {
    const effectiveUserId = overrideCredentials?.userId ?? userId;
    const effectiveClientSecret = overrideCredentials?.clientSecret ?? clientSecret;
    if (overrideCredentials) {
      // Keeps the (possibly still-hidden) form in sync with what's actually being attempted, so a
      // failure below shows the real attempted values ready to edit, same as a manual failure would.
      setUserId(overrideCredentials.userId);
      setClientSecret(overrideCredentials.clientSecret);
    }

    // Persist (or clear) credentials for the next visit. Wrapped in try/catch so a browser with
    // localStorage blocked (private mode, quota, policy) doesn't break the actual fetch below.
    try {
      // Use the effective credentials so auto-login saves to localStorage too!
      if (effectiveUserId && effectiveClientSecret) {
        localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, effectiveUserId);
        localStorage.setItem(LOCAL_STORAGE_CLIENT_SECRET_KEY, effectiveClientSecret);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_USER_ID_KEY);
        localStorage.removeItem(LOCAL_STORAGE_CLIENT_SECRET_KEY);
      }
    } catch {
      // ignore - persistence is best-effort
    }
    setFetchState("loading");
    setBoard([]);
    setCrusadeError(null);
    // A fresh GO (possibly a different account/crusade entirely) can't carry over a tracked planet
    // pointing at data that may no longer exist - in-memory tracking state resets on every go(),
    // same as it does on a plain reload.
    trackedPlanetIdRef.current = null;
    setTrackedPlanetId(null);
    trackedPlanetStateRef.current = null;
    setTrackedPlanetState(null);

    // Fast-paint bootstrap from the background poller's cache (see worker/poller.ts) while the
    // real, per-account fetchCrusadeData() below is in flight. Guarded so a slow cache response
    // can never clobber fresher real data: sessionParamsRef is only ever populated once the real
    // fetch below succeeds, and the scheduler effect only starts once crusadeSessionId is bumped
    // (also only after a real success) - so this seed can't race it either way.
    fetchCrusadeCache()
      .then((cache) => {
        if (sessionParamsRef.current) return;
        const { crusadeData: seededCrusadeData, planetRefreshState: seeded } =
          seedPlanetRefreshStateFromCache(cache);
        if (!seededCrusadeData) return;
        crusadeDataRef.current = seededCrusadeData;
        setCrusadeData(seededCrusadeData);
        planetRefreshStateRef.current = seeded;
        setPlanetRefreshState(seeded);

        // Second fast-paint pass, chained after the crusade snapshot above so there's something
        // to merge leaderboard data into - fills in the shared D1 leaderboard cache (worker/
        // poller.ts) for every seeded planet, still guarded the same way so a slow response here
        // can never clobber a real fetch that's already landed.
        fetchLeaderboardCache()
          .then(({ entries }) => {
            if (sessionParamsRef.current) return;
            const merged = new Map(planetRefreshStateRef.current);
            for (const [planetId, entry] of merged) {
              const cachedLeaderboard = entries[planetId];
              if (!cachedLeaderboard) continue;
              merged.set(planetId, {
                ...entry,
                leaderboard: toSeededPlanetLeaderboard(planetId, cachedLeaderboard, seededCrusadeData.chosenSide, resolveMyFactionId(seededCrusadeData)),
                lastSuccessAt: cachedLeaderboard.fetchedAt,
              });
            }
            planetRefreshStateRef.current = merged;
            setPlanetRefreshState(merged);
          })
          .catch((error) => console.error("[App] go(): fetchLeaderboardCache seed failed", error));
      })
      .catch((error) =>
        console.error("[App] go(): fetchCrusadeCache seed failed", error),
      );

    try {
      setStatus("Reading local credentials...");
      setStatus("Fetching player data...");
      const data = await fetchPlayerData(environment, { userId: effectiveUserId, clientSecret: effectiveClientSecret });
      setStatus(
        data.board.length === 0
          ? "Couldn't find any expeditions. Have you refreshed your board after claiming your completed operations?"
          : `Loaded ${data.board.length} expedition(s), ${data.heroes.length} hero(es), ${data.machinesOfWar.length} machine(s) of war.`,
      );
      setBoard(data.board);
      setHeroes(data.heroes);
      setMachinesOfWar(data.machinesOfWar);
      setAdViewsRemaining(data.adViewsRemaining);
      setResources(data.resources);
      setHeroQuestJars(data.heroQuestJars);
      setActiveQuestIds(data.activeQuestIds);
      setSectorMap(data.sectorMap);
      setPlanetDefenses(data.planetDefenses);
      setOnslaughtBoards(data.onslaughtBoards);
      setRawPlayerData(data.raw);
      setFetchState("success");
      if (!isTauri()) {
        if (autoLoginEnabled) void storeWebCredential(effectiveUserId, effectiveClientSecret);
        void trackUsage(effectiveUserId, environment);
      }
      // Best-effort restore of starred characters/planets - a failure here shouldn't affect the
      // data that already loaded successfully above, so it's not part of the try/catch's failure path.
      fetchUserPreferences(effectiveUserId)
        .then((preferences) => {
          setFavoritedCharacterIds(new Set(preferences.favoritedCharacters));
          setFavoritedPlanetIds(new Set(preferences.favoritedPlanets));
          setAntiFavoritedCharacterIds(
            new Set(preferences.antiFavoritedCharacters),
          );
        })
        .catch((error) =>
          console.error("[App] go(): fetchUserPreferences failed", error),
        );
    } catch (error) {
      console.error("[App] go(): caught error", error);
      setStatus(`Failed: ${error}`);
      setFetchState("error");
      // This attempt came from the auto-login effect, not a manual GO click - the stored
      // credential didn't work (revoked/rotated secret), so clear it rather than retrying (and
      // failing) on every future page load. A manual click's own failure means the user typed
      // something wrong themselves, unrelated to any stored credential, so this never fires then.
      if (overrideCredentials) clearWebCredential();
      return;
    }

    // Kept out of the try/catch above deliberately - a crusade-fetch failure (e.g. the
    // GAME_EVENT_GAME_CONFIG_VERSION/GAME_EVENT_MULTI_CONFIG_VERSION trio rotating again after a
    // future game update) shouldn't wipe out the board/character data that already loaded
    // successfully above. Split into two try/catches (rather than one shared one) so
    // crusadeError says which call actually failed - error.toString() already embeds the URL and
    // a JSON dump of the response, from post()/postGameEvent()'s error formatting.
    const webCredentials = { userId: effectiveUserId, clientSecret: effectiveClientSecret };
    let crusade;
    try {
      crusade = await fetchCrusadeData(environment, webCredentials);
      crusadeDataRef.current = crusade;
      setCrusadeData(crusade);
    } catch (error) {
      console.error("[App] go(): GET_CRUSADE failed", error);
      crusadeDataRef.current = null;
      setCrusadeData(null);
      planetRefreshStateRef.current = new Map();
      setPlanetRefreshState(new Map());
      setCrusadeError(`GET_CRUSADE failed: ${error}`);
      // Also stops any scheduler still running from a previous successful session - otherwise it
      // would keep polling planets for a crusade the UI no longer shows.
      setCrusadeSessionId((id) => id + 1);
      return;
    }

    // Pre-populate a refresh-state entry for every active planet immediately - cards/rows render
    // right away (showing "Not yet loaded") instead of waiting for any leaderboard fetch. The
    // rolling scheduler effect below (keyed on crusadeData) picks these up and fills them in.
    // During Domination (STRUGGLE) every planet is contestable at once - no zone filter, unlike
    // the classic per-zone Expansion (CRUSADE) phase.
    const planetIds =
      crusade.phase === "STRUGGLE"
        ? crusade.planets.map((p) => p.planetId)
        : activePlanetIds(crusade.activeZone);
    const seeded = new Map<string, PlanetRefreshEntry>(
      planetIds.map((id) => [
        id,
        {
          leaderboard: null,
          lastSuccessAt: null,
          lastAttemptAt: null,
          lastAttemptFailed: false,
          isLoading: false,
        },
      ]),
    );
    planetRefreshStateRef.current = seeded;
    setPlanetRefreshState(seeded);
    setCrusadeSessionId((id) => id + 1);
    sessionParamsRef.current = {
      environment,
      crusadeId: crusade.crusadeId,
      seasonNumber: crusade.seasonNumber,
      chosenSide: crusade.chosenSide,
      myFactionId: resolveMyFactionId(crusade),
      userId: effectiveUserId,
      clientSecret: effectiveClientSecret,
    };
  }

  // Web-only, opt-in via autoLoginEnabled (the checkbox next to the credential inputs - off by
  // default, so nothing in this effect ever runs for a user who hasn't explicitly turned it on):
  // on first mount, check whether an encrypted credential is stored for this origin (see
  // storeWebCredential's own comment) and, if so, skip the "8"/title-tap reveal gesture entirely
  // and log straight in - more automatic than even Tauri's own flow, which still needs the
  // gesture + a GO click. Works in every modern browser (no native-API mediation/consent step
  // that can decline) - whenever nothing's stored, this resolves to null, which must never be
  // treated as an error, only as "fall back to the manual form, exactly like today."
  // autoLoginEnabled is read directly (not via a ref) because its initial useState value is
  // already resolved synchronously from localStorage before this mount-only effect ever runs, so
  // there's no staleness to guard against here.
  useEffect(() => {
    if (isTauri() || !autoLoginEnabled) return;
    let cancelled = false;
    retrieveWebCredential()
      .then((credential) => {
        if (cancelled || !credential) return;
        // Guards against a retrieval that resolves after the user already pressed "8"/tapped the
        // title and started typing their own credentials - devModeEnabledRef (not the
        // devModeEnabled this effect's own closure captured at mount) reflects the current value.
        if (devModeEnabledRef.current) return;
        setDevModeEnabled(true);
        void go(credential);
      })
      .catch((error) => console.error("[App] auto-login: retrieveWebCredential failed", error));
    return () => {
      cancelled = true;
    };
    // Re-runs if the user checks the box while already on the page (not just at mount) - a
    // same-tab "turn this on" should try immediately, not require a reload. devModeEnabledRef
    // still exists for the "already revealed/typing" guard above, independent of this dep.
  }, [autoLoginEnabled]);

  // Undoes go(): every piece of account data it populates on success goes back to its own
  // useState default, the tracked-planet/crusade/scheduler state goes back the same way go()'s
  // own GET_CRUSADE-failure branch already resets it (nulling crusadeData in the same pass as
  // bumping crusadeSessionId, so the scheduler effect's re-run hits its own `if (!crusadeData)
  // return;` guard instead of starting a fresh generation), and the stored credential is deleted
  // outright (unlike the browser's own saved passwords, this app fully owns this storage, so
  // there's no "it's still in the browser's password manager" caveat here).
  function logout() {
    trackedPlanetIdRef.current = null;
    setTrackedPlanetId(null);
    trackedPlanetStateRef.current = null;
    setTrackedPlanetState(null);

    crusadeDataRef.current = null;
    setCrusadeData(null);
    planetRefreshStateRef.current = new Map();
    setPlanetRefreshState(new Map());
    setCrusadeError(null);
    setCrusadeSessionId((id) => id + 1);
    sessionParamsRef.current = null;

    setBoard([]);
    setHeroes([]);
    setMachinesOfWar([]);
    setAdViewsRemaining(null);
    setResources(null);
    setHeroQuestJars([]);
    setActiveQuestIds([]);
    setSectorMap({ planets: [], connections: [] });
    setPlanetDefenses({});
    setOnslaughtBoards({ Imperial: [], Chaos: [], Xenos: [] });
    setRawPlayerData(null);
    setFavoritedCharacterIds(new Set());
    setAntiFavoritedCharacterIds(new Set());
    setFavoritedPlanetIds(new Set());

    setUserId("");
    setClientSecret("");
    setFetchState("idle");
    setStatus("");

    resetToAnonymousView();
    setDevModeEnabled(false);
    setAutoLoginEnabled(false);
    clearWebCredential();
  }

  // Writes a planet's new refresh-state entry to both the scheduler's live ref and to React
  // state in one synchronous pass (see planetRefreshStateRef's comment above) - shared by the
  // auto-refresh scheduler and manual refresh so both commit the same way.
  function commitPlanetRefresh(planetId: string, entry: PlanetRefreshEntry) {
    const next = new Map(planetRefreshStateRef.current);
    next.set(planetId, entry);
    planetRefreshStateRef.current = next;
    setPlanetRefreshState(next);
  }

  function commitPlanetSuccess(
    planetId: string,
    leaderboard: PlanetLeaderboard,
  ) {
    const now = Date.now();
    commitPlanetRefresh(planetId, {
      leaderboard,
      lastSuccessAt: now,
      lastAttemptAt: now,
      lastAttemptFailed: false,
      isLoading: false,
    });
  }

  function commitPlanetFailure(planetId: string) {
    const now = Date.now();
    const prev = planetRefreshStateRef.current.get(planetId);
    commitPlanetRefresh(planetId, {
      leaderboard: prev?.leaderboard ?? null,
      lastSuccessAt: prev?.lastSuccessAt ?? null,
      lastAttemptAt: now,
      lastAttemptFailed: true,
      isLoading: false,
    });
  }

  async function fetchOnePlanet(planetId: string): Promise<void> {
    const session = sessionParamsRef.current;
    if (!session) return;
    try {
      const leaderboard = await fetchPlanetLeaderboard(
        session.environment,
        session.crusadeId,
        session.seasonNumber,
        session.chosenSide,
        planetId,
        session.myFactionId,
        { userId: session.userId, clientSecret: session.clientSecret },
      );
      commitPlanetSuccess(planetId, leaderboard);
    } catch (error) {
      console.error(`[App] fetchOnePlanet(${planetId}) failed`, error);
      commitPlanetFailure(planetId);
    }
  }

  // GET_CRUSADE has no per-planet variant - it always returns every planet's own score/ownership
  // data (pointsFor/pointsAgainst/sideOwner/struggleData) in one shot, unlike the per-planet
  // leaderboard fetch above. Decoupled onto its own cadence (see crusadeScoreRefreshLoop) rather
  // than piggybacking on every leaderboard tick, since it's a much heavier call - manual refresh
  // still always fires it too, see refreshPlanetNow. Also called far more often (no delay between
  // calls) by the tracker loop below while a planet is tracked - deduped via
  // refreshCrusadeScoresInFlightRef so an overlapping call from crusadeScoreRefreshLoop's
  // independent ~60s cadence can never race it and let a stale response clobber a newer one.
  const refreshCrusadeScoresInFlightRef = useRef<Promise<void> | null>(null);
  function refreshCrusadeScores(): Promise<void> {
    if (refreshCrusadeScoresInFlightRef.current)
      return refreshCrusadeScoresInFlightRef.current;
    const session = sessionParamsRef.current;
    if (!session) return Promise.resolve();
    const promise = fetchCrusadeData(session.environment, {
      userId: session.userId,
      clientSecret: session.clientSecret,
    })
      .then((crusade) => {
        crusadeDataRef.current = crusade;
        setCrusadeData(crusade);
      })
      .catch((error) =>
        console.error("[App] refreshCrusadeScores() failed", error),
      )
      .finally(() => {
        refreshCrusadeScoresInFlightRef.current = null;
      });
    refreshCrusadeScoresInFlightRef.current = promise;
    return promise;
  }

  // Auto-refresh cadence: 5 minutes normally, backing off to 1 hour once the user's been away
  // from the Crusades tab for more than 10 continuous minutes - see the activeTab effect below,
  // which tracks awayFromCrusadeSinceRef.
  const AUTO_REFRESH_WORKERS = 4;
  const NORMAL_REFRESH_MS = 5 * 60 * 1000;
  const AWAY_REFRESH_MS = 60 * 60 * 1000;
  const AWAY_TRIGGER_MS = 10 * 60 * 1000;
  const IDLE_POLL_MS = 5_000;

  // Separate, much slower cadence for refreshCrusadeScores (see currentCrusadeScoreRefreshMs) -
  // deliberately not tied to NORMAL_REFRESH_MS/AWAY_REFRESH_MS above, since GET_CRUSADE is a much
  // heavier call than a single planet's leaderboard.
  const CRUSADE_SCORE_ACTIVE_REFRESH_MS = 60 * 1000;
  const CRUSADE_SCORE_AWAY_REFRESH_MS = 5 * 60 * 1000;

  // The tracker loop's web-only rate cap (see the tracker effect below) - web calls go through our
  // own Worker (fetchWithTimeout -> /api/fetch-crusade-data/-leaderboard-data), so a web user
  // tracking a planet directly costs us Workers resources; the Tauri desktop app's equivalent
  // calls go straight from the user's own machine to Tacticus's servers (invokeWithTimeout's Rust
  // commands), costing us nothing, so it keeps the original no-delay behavior. Measured on a real
  // request pair: a *request-start-to-request-start* interval, not response-to-next-request - a
  // slow round trip eats into the gap rather than stacking on top of it.
  const TRACKER_WEB_MIN_INTERVAL_MS = 10_000;

  // Claims the most-overdue eligible planet (not currently loading, auto-refreshable - starred
  // only, see isPlanetAutoRefreshable - and past its cadence threshold) by marking it isLoading
  // synchronously - contains no `await`, so with up to 4 workers calling
  // this "at once", each call fully completes (including the ref mutation) before the next one's
  // synchronous body can run, making the claim race-free without any extra locking.
  function claimEligiblePlanet(thresholdMs: number): string | null {
    const map = planetRefreshStateRef.current;
    const now = Date.now();
    let candidate: string | null = null;
    let mostOverdueKey = Infinity;
    for (const [planetId, entry] of map) {
      // The tracked planet has its own dedicated, unthrottled loop (see the tracker effect below) -
      // letting the worker pool also claim it here would double-fetch it and fight over its
      // isLoading flag.
      if (planetId === trackedPlanetIdRef.current) continue;
      if (entry.isLoading) continue;
      if (
        !isPlanetAutoRefreshable(
          entry,
          favoritedPlanetIdsRef.current.has(planetId),
        )
      )
        continue;
      if (
        entry.lastAttemptAt !== null &&
        now - entry.lastAttemptAt < thresholdMs
      )
        continue;
      const overdueKey = entry.lastAttemptAt ?? -Infinity; // never-attempted sorts first
      if (overdueKey < mostOverdueKey) {
        mostOverdueKey = overdueKey;
        candidate = planetId;
      }
    }
    if (candidate) {
      const entry = map.get(candidate)!;
      commitPlanetRefresh(candidate, { ...entry, isLoading: true });
    }
    return candidate;
  }

  function currentRefreshThresholdMs(): number {
    const awaySince = awayFromCrusadeSinceRef.current;
    return awaySince !== null && Date.now() - awaySince > AWAY_TRIGGER_MS
      ? AWAY_REFRESH_MS
      : NORMAL_REFRESH_MS;
  }

  function currentCrusadeScoreRefreshMs(): number {
    const awaySince = awayFromCrusadeSinceRef.current;
    return awaySince !== null && Date.now() - awaySince > AWAY_TRIGGER_MS
      ? CRUSADE_SCORE_AWAY_REFRESH_MS
      : CRUSADE_SCORE_ACTIVE_REFRESH_MS;
  }

  // Rolling auto-refresh: a fixed pool of workers continuously cycles through planets, always
  // picking whichever is most overdue, never touching one currently loading or under its
  // cadence's threshold. Restarts (new generation) on every new GO - see crusadeSessionId.
  useEffect(() => {
    if (!crusadeData) return;
    const myGeneration = ++generationRef.current;

    async function worker() {
      while (generationRef.current === myGeneration) {
        const planetId = claimEligiblePlanet(currentRefreshThresholdMs());
        if (!planetId) {
          await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
          continue;
        }
        await fetchOnePlanet(planetId);
        if (generationRef.current !== myGeneration) return;
      }
    }

    // Separate loop, same generation lifecycle as the per-planet workers above - go() already
    // fetched crusade scores once, so this waits a full interval before its first refresh rather
    // than immediately re-fetching.
    async function crusadeScoreRefreshLoop() {
      while (generationRef.current === myGeneration) {
        await new Promise((resolve) =>
          setTimeout(resolve, currentCrusadeScoreRefreshMs()),
        );
        if (generationRef.current !== myGeneration) return;
        await refreshCrusadeScores();
      }
    }

    // Independent ~1-minute cadence: checks the shared D1 leaderboard cache (worker/poller.ts)
    // and adopts any entry fresher than what's held locally, serving it directly rather than
    // triggering a live fetch - pure D1 reads, no additional write pressure or game-server load.
    // Covers every planet currently in planetRefreshState, not just starred ones (unlike
    // claimEligiblePlanet's isPlanetAutoRefreshable gate, which only bounds *live* fetch cost -
    // that doesn't apply to reading an already-fetched cache). The "only adopt if strictly
    // newer" check means this can never regress a planet kept fresher by the worker pool above or
    // the live-tracker loop.
    async function leaderboardCacheFreshnessLoop() {
      while (generationRef.current === myGeneration) {
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        if (generationRef.current !== myGeneration) return;
        try {
          const { entries } = await fetchLeaderboardCache();
          const chosenSide = crusadeDataRef.current?.chosenSide ?? "";
          const factionId = crusadeDataRef.current ? resolveMyFactionId(crusadeDataRef.current) : null;
          const current = planetRefreshStateRef.current;
          const next = new Map(current);
          let changed = false;
          for (const [planetId, cached] of Object.entries(entries)) {
            const entry = current.get(planetId);
            if (!entry || entry.isLoading) continue;
            if (entry.lastSuccessAt !== null && cached.fetchedAt <= entry.lastSuccessAt) continue;
            next.set(planetId, {
              leaderboard: toSeededPlanetLeaderboard(planetId, cached, chosenSide, factionId),
              lastSuccessAt: cached.fetchedAt,
              lastAttemptAt: Date.now(),
              lastAttemptFailed: false,
              isLoading: false,
            });
            changed = true;
          }
          if (changed) {
            planetRefreshStateRef.current = next;
            setPlanetRefreshState(next);
          }
        } catch (error) {
          console.error("[App] leaderboardCacheFreshnessLoop failed", error);
        }
      }
    }

    const workers = [...Array.from({ length: AUTO_REFRESH_WORKERS }, () => worker()), crusadeScoreRefreshLoop(), leaderboardCacheFreshnessLoop()];
    return () => {
      generationRef.current++;
      void workers;
    };
  }, [crusadeSessionId]);

  // Dedicated, single-instance loop for whichever planet is tracked (see toggleTrackedPlanet) -
  // separate from the worker pool above (which explicitly skips it, see claimEligiblePlanet) so it
  // can refresh on its own cadence, exactly like refreshPlanetNow fires both a leaderboard fetch
  // and a crusade-score refresh together. True no-delay only in Tauri (see
  // TRACKER_WEB_MIN_INTERVAL_MS's own comment, above) - the desktop app's calls never reach our
  // Worker at all, so there's no backend cost to racing them. Restarts whenever the tracked planet
  // changes or a new go() starts a new session.
  useEffect(() => {
    if (!trackedPlanetId) return;
    // Re-bound with an explicit type annotation (rather than relying on the flow-narrowing above)
    // so the nested trackerLoop closure below sees a plain `string`, not `string | null` - TS
    // discards flow narrowing of outer variables inside nested function bodies.
    const planetId: string = trackedPlanetId;
    let cancelled = false;

    async function trackerLoop() {
      while (!cancelled) {
        const planet = crusadeDataRef.current?.planets.find(
          (p) => p.planetId === planetId,
        );
        if (!planet) return; // the tracked planet vanished from this crusade's data - nothing sensible to sample
        setTrackedPlanetState((prev) => {
          if (!prev || prev.planetId !== planetId) return prev;
          const restarted = restartIfRecontested(prev, planet, Date.now());
          return appendTrackedSample(restarted, planet, Date.now());
        });
        if (cancelled) return;
        if (!trackedPlanetStateRef.current?.frozen) {
          const requestStartedAt = Date.now();
          await Promise.all([fetchOnePlanet(planetId), refreshCrusadeScores()]);
          // Request-start-to-request-start spacing, not response-to-next-request: a slow round
          // trip eats into the 10s gap instead of stacking on top of it, and a round trip that
          // already took >=10s loops again immediately rather than waiting negative time.
          if (!isTauri()) {
            const remaining = TRACKER_WEB_MIN_INTERVAL_MS - (Date.now() - requestStartedAt);
            if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
          }
        } else {
          // Frozen (captured/in cooldown) - don't add extra fetch load for what can be a
          // multi-hour cooldown window. Just re-check the frozen flag periodically so recontest
          // (detected via the existing, independent crusadeScoreRefreshLoop's own ~60s cadence,
          // which keeps running regardless of tracking) is picked up reasonably promptly.
          await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
        }
      }
    }

    void trackerLoop();
    return () => {
      cancelled = true;
    };
  }, [trackedPlanetId, crusadeSessionId]);

  // Tracks how long the user has been away from the Crusades tab - reset to null the instant
  // they return (snapping the auto-refresh cadence back to 5 minutes immediately), started the
  // instant they leave. The Monitor tab counts as "still here" too - it's just another view onto
  // the same Domination data (built from already-persisted history, see MonitorTab), and the user
  // shouldn't see Crusade's own refresh cadence slow down just for having looked at it.
  useEffect(() => {
    if (activeTab === "crusade" || activeTab === "monitor") {
      awayFromCrusadeSinceRef.current = null;
    } else if (awayFromCrusadeSinceRef.current === null) {
      awayFromCrusadeSinceRef.current = Date.now();
    }
  }, [activeTab]);

  // Every planet's persisted history, for the Monitor tab - runs once on mount and keeps
  // refetching every 5 minutes regardless of activeTab/login state, matching the backend poller's
  // own crusade-refresh cadence (fetching any faster couldn't possibly turn up new data). See
  // planetHistoryByPlanet's own declaration for why this lives here rather than inside MonitorTab.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const history = await fetchAllPlanetHistory();
      if (!cancelled) setPlanetHistoryByPlanet(history);
    }
    void load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Manual refresh (req 3) - bypasses claimEligiblePlanet's cadence threshold entirely and isn't
  // capped by the 4-worker pool, since each refresh icon disables itself the instant it's
  // clicked (self-limiting in practice).
  function refreshPlanetNow(planetId: string) {
    const entry = planetRefreshStateRef.current.get(planetId);
    if (!entry || entry.isLoading) return;
    commitPlanetRefresh(planetId, { ...entry, isLoading: true });
    void fetchOnePlanet(planetId);
    // Manual refresh always also refreshes planet scores, independent of the slower background
    // cadence in crusadeScoreRefreshLoop.
    void refreshCrusadeScores();
  }

  // The Crusade tab's "refresh all leaderboards" button - a one-time, sequential sweep through
  // every currently-relevant planet (planetRefreshState is already seeded with exactly the active
  // set for whatever phase is showing - every planet during STRUGGLE, just the active zone's
  // during CRUSADE, none during Downtime, see seedPlanetRefreshStateFromCache/activePlanetIds), one
  // at a time with no delay between, until every one has been fetched once. Deliberately a plain
  // sequential loop, not routed through the auto-refresh worker pool - this must run exactly once
  // and then stop, never leaving anything behind that keeps refreshing afterward (that's entirely
  // isPlanetAutoRefreshable/favoritedPlanetIds' job, untouched here). Each planet is still claimed
  // (isLoading synchronously set) before its own fetch, the same way claimEligiblePlanet/
  // refreshPlanetNow do, so this can't race a concurrent auto-refresh or manual click over the same
  // planet's state.
  async function refreshAllPlanetsNow() {
    if (isRefreshingAllPlanetsRef.current) return;
    isRefreshingAllPlanetsRef.current = true;
    setIsRefreshingAllPlanets(true);
    try {
      for (const planetId of planetRefreshStateRef.current.keys()) {
        const entry = planetRefreshStateRef.current.get(planetId);
        if (!entry || entry.isLoading) continue;
        commitPlanetRefresh(planetId, { ...entry, isLoading: true });
        await fetchOnePlanet(planetId);
      }
    } finally {
      isRefreshingAllPlanetsRef.current = false;
      setIsRefreshingAllPlanets(false);
    }
  }

  // Optimistically updates local state, then fires the full replacement list to the backend -
  // best-effort, matching trackUsage/storeWebCredential above (a sync failure shouldn't block the
  // UI from reflecting the click). Shows a brief auto-dismissing confirmation once the save
  // actually lands, rather than optimistically on the click itself.
  function toggleFavoriteCharacter(characterId: string) {
    const next = new Set(favoritedCharacterIds);
    const turningOn = !next.has(characterId);
    if (turningOn) next.add(characterId);
    else next.delete(characterId);
    setFavoritedCharacterIds(next);
    setFavoritedCharacters(userId, clientSecret, [...next])
      .then(() => setToastMessage("Favorite characters saved"))
      .catch((error) =>
        console.error(
          "[App] toggleFavoriteCharacter(): setFavoritedCharacters failed",
          error,
        ),
      );

    // Favoriting and anti-favoriting a character at once makes no sense for the solver's
    // preference logic - turning one on clears the other, both locally and server-side.
    if (turningOn && antiFavoritedCharacterIds.has(characterId)) {
      const nextAnti = new Set(antiFavoritedCharacterIds);
      nextAnti.delete(characterId);
      setAntiFavoritedCharacterIds(nextAnti);
      setAntiFavoritedCharacters(userId, clientSecret, [...nextAnti]).catch(
        (error) =>
          console.error(
            "[App] toggleFavoriteCharacter(): clearing anti-favorite failed",
            error,
          ),
      );
    }
  }

  function toggleAntiFavoriteCharacter(characterId: string) {
    const next = new Set(antiFavoritedCharacterIds);
    const turningOn = !next.has(characterId);
    if (turningOn) next.add(characterId);
    else next.delete(characterId);
    setAntiFavoritedCharacterIds(next);
    setAntiFavoritedCharacters(userId, clientSecret, [...next])
      .then(() => setToastMessage("Deprioritized characters saved"))
      .catch((error) =>
        console.error(
          "[App] toggleAntiFavoriteCharacter(): setAntiFavoritedCharacters failed",
          error,
        ),
      );

    if (turningOn && favoritedCharacterIds.has(characterId)) {
      const nextFav = new Set(favoritedCharacterIds);
      nextFav.delete(characterId);
      setFavoritedCharacterIds(nextFav);
      setFavoritedCharacters(userId, clientSecret, [...nextFav]).catch(
        (error) =>
          console.error(
            "[App] toggleAntiFavoriteCharacter(): clearing favorite failed",
            error,
          ),
      );
    }
  }

  function toggleFavoritePlanet(planetId: string) {
    const next = toggleStarredPlanet(favoritedPlanetIds, planetId);
    if (next === favoritedPlanetIds) return; // at the star cap (the UI disables starring then; belt and braces)
    setFavoritedPlanetIds(new Set(next));
    setFavoritedPlanets(userId, clientSecret, [...next])
      .then(() => setToastMessage("Favorite planets saved"))
      .catch((error) =>
        console.error(
          "[App] toggleFavoritePlanet(): setFavoritedPlanets failed",
          error,
        ),
      );
  }

  // In-memory only (never persisted) - see trackedPlanetId's own comment. Untracking (clicking the
  // already-tracked planet again) clears the graph entirely; tracking a new one seeds a fresh state
  // starting now, then immediately (best-effort, see fetchPlanetHistory) backfills it with whatever
  // the poller has recorded for this planet's current capture-cycle era - the graph shows instantly,
  // then grows a history tail in moments rather than waiting on the fetch. The TrackIconButton on
  // every other planet is disabled while one is tracked (see isTrackDisabled), so
  // toggleTrackedPlanetId only ever actually switches planets via this path when nothing was
  // tracked yet.
  function toggleTrackedPlanet(planetId: string) {
    const next = toggleTrackedPlanetId(trackedPlanetId, planetId);
    trackedPlanetIdRef.current = next;
    setTrackedPlanetId(next);
    const nextState = next ? createTrackedPlanetState(next, Date.now()) : null;
    trackedPlanetStateRef.current = nextState;
    setTrackedPlanetState(nextState);

    if (next) {
      fetchPlanetHistory(next)
        .then((history) => {
          // Stale-fetch guard: the user may have untracked or switched to a different planet
          // before this resolved - a late history fetch for an old selection must never land on
          // whatever's tracked now.
          if (
            trackedPlanetIdRef.current !== next ||
            !trackedPlanetStateRef.current
          )
            return;
          const merged = mergeHistoryIntoTrackedPlanetState(
            trackedPlanetStateRef.current,
            history,
          );
          trackedPlanetStateRef.current = merged;
          setTrackedPlanetState(merged);
        })
        .catch((error) =>
          console.error(
            `[App] toggleTrackedPlanet(${next}): fetchPlanetHistory failed`,
            error,
          ),
        );
    }
  }

  async function exportPlayerData() {
    const contents = JSON.stringify(rawPlayerData, null, 2);
    const defaultFileName = `tacops-${environment}-player-data.json`;
    if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await save({
        defaultPath: defaultFileName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return; // user cancelled the dialog
      await invoke("write_text_file", { path, contents });
    } else {
      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = defaultFileName;
      link.click();
      URL.revokeObjectURL(url);
    }
  }

  const totalHourlyRate = computeTotalHourlyRate(crusadeData?.planets ?? [], planetHistoryByPlanet, Date.now());

  return (
    <main
      onClick={() => setSelectedExpeditionId(null)}
      className="mx-auto flex min-h-screen w-full flex-col items-center bg-neutral-100 px-4 py-[5vh] text-center text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
    >
      {rolloverMsRemaining > 0 && <RolloverCooldownModal msRemaining={rolloverMsRemaining} />}
      <BuildTimestamp />
      {devModeEnabled && <CrusadePointsRateIndicator imperialRate={totalHourlyRate.imperial} devastationRate={totalHourlyRate.devastation} />}
      {staleVersionDetected && <StaleVersionBanner onReloadNow={() => window.location.reload()} />}
      {toastMessage && <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />}
      <h1 className="cursor-pointer text-2xl font-semibold select-none" onClick={handleTitleTap}>
        TacOps
      </h1>
      {!devModeEnabled ? (
        // No credentials, no login form - just a read-only crusade view sourced from the
        // background poller's cache (see AnonymousCrusadeSection/worker/poller.ts). The full app
        // (credential form/GO/Tabs) stays behind the same "tap the title 8 times" / press "8"
        // trigger it always has (see toggleDevMode/handleKeyDown/handleTitleTap above).
        <AnonymousCrusadeSection />
      ) : (
        <>
          <p>
            {isTauri()
              ? "Reads your local Tacticus credentials, fetches your live account data, and shows your current expeditions board."
              : "Enter your Tacticus user ID and client secret to fetch your live account data and show your current expeditions board. Nothing here is ever persisted to servers."}
          </p>

          {devModeEnabled && <EnvironmentToggle value={environment} onChange={setEnvironment} />}
          {devModeEnabled && isTauri() && <DataSourceToggle value={devDataSource} onChange={changeDevDataSource} />}
          {devModeEnabled && <ViewModeToggle value={viewMode} onChange={setViewMode} />}

          {activeTab !== "guildchat" && (
            <>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  go();
                }}
                className="flex flex-col items-center gap-2"
              >
                {!isTauri() && (
                  <>
                    <input
                      type="text"
                      name="userId"
                      autoComplete="username"
                      placeholder="User ID"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      className="w-64 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900/60 dark:text-white"
                    />
                    <div className="relative w-64">
                      <input
                        type={showClientSecret ? "text" : "password"}
                        name="clientSecret"
                        autoComplete="current-password"
                        placeholder="Client secret"
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-14 text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900/60 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientSecret((v) => !v)}
                        className="absolute inset-y-0 right-0 px-3 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
                      >
                        {showClientSecret ? "Hide" : "Show"}
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                      <input
                        type="checkbox"
                        checked={autoLoginEnabled}
                        onChange={(e) => setAutoLoginEnabled(e.target.checked)}
                        className="h-4 w-4"
                      />
                      Remember me on this device (auto-login next time)
                    </label>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={fetchState === "loading"}
                    className="rounded-lg border border-transparent bg-white px-5 py-2.5 font-medium text-neutral-900 shadow-[0_2px_2px_rgba(0,0,0,0.2)] outline-none transition-colors hover:border-blue-500 active:border-blue-500 active:bg-neutral-100 disabled:cursor-default disabled:opacity-60 dark:bg-neutral-900/60 dark:text-white dark:active:bg-neutral-900/40"
                  >
                    GO
                  </button>
                  {devModeEnabled && (
                    <button
                      type="button"
                      disabled={rawPlayerData === null}
                      onClick={exportPlayerData}
                      className="hidden"
                    >
                      Export JSON
                    </button>
                  )}
                  {!isTauri() && fetchState === "success" && (
                    <button
                      type="button"
                      onClick={logout}
                      title="Stops this browser from logging you back in automatically next time - it doesn't delete the saved password from your browser's own password manager."
                      className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm text-neutral-700 outline-none transition-colors hover:border-blue-500 active:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:active:bg-neutral-900/40"
                    >
                      Log out
                    </button>
                  )}
                </div>
              </form>
              {resources && (
                <ResourceTokens
                  resources={resources}
                  adViewsRemaining={adViewsRemaining}
                />
              )}
              <p className="inline-flex items-center gap-2">
                {fetchState === "loading" && (
                  <Spinner seconds={secondsRemaining} />
                )}
                {fetchState === "error" && <ErrorIcon />}
                {status}
              </p>
            </>
          )}

          {devModeEnabled && (
            <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />
          )}

          <div className="w-full overflow-x-auto pt-2">
            {activeTab === "operations" && (
              <>
                {board.length > 0 && (
                  <>
                    <RewardPriorityPicker
                      value={priorityOrder}
                      onChange={setPriorityOrder}
                    />
                    {solverError && (
                      <p className="mt-2 text-red-600 dark:text-red-400">
                        Couldn't compute a suggested assignment: {solverError}
                      </p>
                    )}
                    {solverIncompleteReason && (
                      <p className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-base font-semibold text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                        {solverIncompleteReason}
                      </p>
                    )}
                    <RequiredCharacterPool
                      assignment={assignment}
                      heroes={heroes}
                    />
                  </>
                )}
                <div className="relative w-full">
                  {solverOptimizing && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/70 dark:bg-neutral-900/70">
                      <p className="font-medium">{solverState === "success" ? "Optimizing" : "Solving"}</p>
                      <Spinner size={64} seconds={solverSecondsRemaining} />
                    </div>
                  )}
                  <div className={solverOptimizing ? "pointer-events-none" : ""}>
                    {viewMode === "table" ? (
                      <OperationsTable
                        board={board}
                        environment={environment}
                        assignment={assignment}
                        solverReady={solverState === "success"}
                        selectedExpeditionId={selectedExpeditionId}
                        onSelect={toggleSelection}
                        heroes={heroes}
                      />
                    ) : (
                      <OperationsCards
                        board={board}
                        environment={environment}
                        assignment={assignment}
                        solverReady={solverState === "success"}
                        selectedExpeditionId={selectedExpeditionId}
                        onSelect={toggleSelection}
                        heroes={heroes}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
            {activeTab === "characters" && (
              <CharactersTable
                heroes={heroes}
                favoritedCharacterIds={favoritedCharacterIds}
                onToggleFavorite={toggleFavoriteCharacter}
                antiFavoritedCharacterIds={antiFavoritedCharacterIds}
                onToggleAntiFavorite={toggleAntiFavoriteCharacter}
              />
            )}
            {activeTab === "mows" && <MowTable machinesOfWar={machinesOfWar} />}
            {activeTab === "guildchat" && <GuildChatTab environment={environment} />}
            {activeTab === "arena" && (
              <ArenaTab
                environment={environment}
                pvpPosition={resources?.pvpPosition ?? null}
                webCredentials={{ userId, clientSecret }}
              />
            )}
            {activeTab === "onslaught" && <OnslaughtTab onslaughtBoards={onslaughtBoards} />}
            {activeTab === "coverage" && <BoardCoverageTab />}
            {activeTab === "heroquests" && <HeroQuestsTab jars={heroQuestJars} activeQuestIds={activeQuestIds} viewMode={viewMode} />}
            {activeTab === "crusade" && (
              <CrusadeTab
                crusadeData={crusadeData}
                planetRefreshState={planetRefreshState}
                sectorMap={sectorMap}
                error={crusadeError}
                viewMode={viewMode}
                onRefreshPlanet={refreshPlanetNow}
                favoritedPlanetIds={favoritedPlanetIds}
                onToggleFavoritePlanet={toggleFavoritePlanet}
                trackedPlanetId={trackedPlanetId}
                trackedPlanetState={trackedPlanetState}
                onToggleTrackPlanet={toggleTrackedPlanet}
                historyByPlanet={planetHistoryByPlanet}
                planetDefenses={planetDefenses}
                onRefreshAllPlanets={refreshAllPlanetsNow}
                isRefreshingAllPlanets={isRefreshingAllPlanets}
              />
            )}
            {activeTab === "monitor" && (
              <MonitorTab
                crusadeData={crusadeData}
                planetRefreshState={planetRefreshState}
                favoritedPlanetIds={favoritedPlanetIds}
                error={crusadeError}
                sectorMap={sectorMap}
                historyByPlanet={planetHistoryByPlanet}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}
