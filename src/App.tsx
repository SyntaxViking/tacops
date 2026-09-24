import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Spinner } from "./components/Spinner";
import { ErrorIcon } from "./components/ErrorIcon";
import { EnvironmentToggle } from "./components/EnvironmentToggle";
import { ViewModeToggle, type ViewMode } from "./components/ViewModeToggle";
import { Tabs } from "./components/Tabs";
import { OperationsTable } from "./components/OperationsTable";
import { OperationsCards } from "./components/OperationsCards";
import { CharactersTable } from "./components/CharactersTable";
import { MowTable } from "./components/MowTable";
import { GuildChatTab } from "./components/GuildChatTab";
import { BoardCoverageTab } from "./components/BoardCoverageTab";
import { CrusadeTab } from "./components/CrusadeTab";
import { HeroQuestsTab } from "./components/HeroQuestsTab";
import { RewardPriorityPicker } from "./components/RewardPriorityPicker";
import { RequiredCharacterPool } from "./components/RequiredCharacterPool";
import { ResourceTokens } from "./components/ResourceTokens";
import { BuildTimestamp } from "./components/BuildTimestamp";
import { Toast } from "./components/Toast";
import { fetchPlayerData } from "./api/fetch-player-data";
import { entryIsUnavailable } from "./board/board-view-model";
import { activePlanetIds, fetchCrusadeData, fetchPlanetLeaderboard, resolveMyFactionId } from "./api/fetch-crusade-data";
import { storeWebCredential } from "./api/store-web-credential";
import { fetchUserPreferences, setAntiFavoritedCharacters, setFavoritedCharacters, setFavoritedPlanets } from "./api/user-preferences";
import { fetchCrusadeCache } from "./api/fetch-crusade-cache";
import { seedPlanetRefreshStateFromCache } from "./api/crusade-cache-seed";
import { AnonymousCrusadeSection } from "./components/AnonymousCrusadeSection";
import { trackUsage } from "./track-usage";
import type { BoardAssignmentResult } from "./board/board-solver";
import type { SolveRequest, SolveResponse } from "./board/board-solver.worker";
import type { PriorityKey } from "./board/reward-amount";
import type { CrusadeData, CrusadeSectorMap, Environment, ExpeditionBoardEntry, PlanetLeaderboard, PlanetRefreshEntry, PlayerResources, RawUnit } from "./api/types";
import type { HeroQuestJar } from "./hero-quests/hero-quest-view-model";

const TABS = [
  { id: "operations", label: "Operations" },
  { id: "crusade", label: "Crusade" },
  { id: "guildchat", label: "Guild Chat" },
  { id: "characters", label: "Characters" },
  { id: "mows", label: "Machines of War" },
  { id: "coverage", label: "Board Coverage" },
  { id: "heroquests", label: "Hero Quests" },
];

const FETCH_COUNTDOWN_SECONDS = 60;
const SOLVER_COUNTDOWN_SECONDS = 70; // 7 lexicographic passes x the 10s-per-pass solver timeout

const LOCAL_STORAGE_USER_ID_KEY = "tacops:userId";
const LOCAL_STORAGE_CLIENT_SECRET_KEY = "tacops:clientSecret";

export function App() {
  const [environment, setEnvironment] = useState<Environment>("prod");
  const [activeTab, setActiveTab] = useState(TABS[0].id);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [selectedExpeditionId, setSelectedExpeditionId] = useState<string | null>(null);
  // Defaults to true so the full app is shown on load (no anonymous-crusade gate, no title tap
  // needed). The title tap / "8" key still toggles it, but the default state is the app itself.
  const [devModeEnabled, setDevModeEnabled] = useState(true);
  const lastEightPressRef = useRef(0);
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
  const [status, setStatus] = useState("");
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [secondsRemaining, setSecondsRemaining] = useState(FETCH_COUNTDOWN_SECONDS);
  const [board, setBoard] = useState<ExpeditionBoardEntry[]>([]);
  const [heroes, setHeroes] = useState<RawUnit[]>([]);
  const [favoritedCharacterIds, setFavoritedCharacterIds] = useState<Set<string>>(new Set());
  const [antiFavoritedCharacterIds, setAntiFavoritedCharacterIds] = useState<Set<string>>(new Set());
  const [favoritedPlanetIds, setFavoritedPlanetIds] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [machinesOfWar, setMachinesOfWar] = useState<RawUnit[]>([]);
  const [adViewsRemaining, setAdViewsRemaining] = useState<number | null>(null);
  const [resources, setResources] = useState<PlayerResources | null>(null);
  const [heroQuestJars, setHeroQuestJars] = useState<HeroQuestJar[]>([]);
  const [sectorMap, setSectorMap] = useState<CrusadeSectorMap>({ planets: [], connections: [] });
  const [crusadeData, setCrusadeData] = useState<CrusadeData | null>(null);
  // Bumped only in go() - unlike crusadeData itself, this changes exactly once per GO click, never
  // on the background per-planet score refresh inside fetchOnePlanet (which also calls
  // setCrusadeData to keep planet scores fresh - see below). The rolling-refresh scheduler effect
  // keys off this instead of crusadeData so a routine planet-score update can't tear down and
  // restart every worker mid-flight.
  const [crusadeSessionId, setCrusadeSessionId] = useState(0);
  const [planetRefreshState, setPlanetRefreshState] = useState<Map<string, PlanetRefreshEntry>>(new Map());
  const [crusadeError, setCrusadeError] = useState<string | null>(null);
  // Mirrors planetRefreshState for the scheduler's long-lived async worker loops (see the effect
  // below) - those loops must always read the latest state across ticks, not a stale closure, and
  // every mutation of planet-refresh state writes here synchronously before mirroring into
  // planetRefreshState via setPlanetRefreshState. Nothing schedules off the state variable itself.
  const planetRefreshStateRef = useRef<Map<string, PlanetRefreshEntry>>(new Map());
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
  const [priorityOrder, setPriorityOrder] = useState<[PriorityKey, PriorityKey, PriorityKey, PriorityKey]>([
    "rarity",
    "crusadeBomb",
    "intel",
    "crusadeNpc",
  ]);

  const [solverState, setSolverState] = useState<"idle" | "solving" | "success" | "error">("idle");
  const [solverSecondsRemaining, setSolverSecondsRemaining] = useState(SOLVER_COUNTDOWN_SECONDS);
  const [assignment, setAssignment] = useState<BoardAssignmentResult>(new Map());
  const [solverError, setSolverError] = useState<string>();
  const [solverIncompleteReason, setSolverIncompleteReason] = useState<string>();
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  // Terminate any worker still running on unmount (e.g. hot-reload in dev).
  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  // The solver runs entirely in a Web Worker (javascript-lp-solver is synchronous with no
  // async/worker mode of its own) so it can never block the main thread - the board renders
  // immediately from fetched data, and this fills in the suggested assignment once it's ready.
  // Terminating and recreating the worker on every change (rather than queuing) guarantees a
  // priority-order change doesn't have to wait behind a slow, now-stale solve.
  useEffect(() => {
    // Mirrors solveBoardAssignment's own openBoards.length===0 fast path (board-solver.ts) - when
    // every entry is already Dispatched/Completed there's nothing to solve, so this skips
    // spinning up (and re-spinning-up on every render) a whole Web Worker just to get back the
    // same empty assignment the worker itself would return instantly. Previously this case fell
    // through to the worker path below every time, needlessly recreating the worker.
    if (board.length === 0 || heroes.length === 0 || board.every(entryIsUnavailable)) {
      workerRef.current?.terminate();
      setAssignment(new Map());
      setSolverState("idle");
      setSolverError(undefined);
      setSolverIncompleteReason(undefined);
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    workerRef.current?.terminate();
    const worker = new Worker(new URL("./board/board-solver.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SolveResponse>) => {
      if (event.data.requestId !== requestIdRef.current) return; // stale response, ignore
      if (event.data.status === "success") {
        setAssignment(new Map(event.data.assignmentEntries));
        setSolverIncompleteReason(event.data.solveStatus === "incomplete" ? event.data.message : undefined);
        setSolverError(undefined);
        setSolverState("success");
      } else {
        setSolverError(event.data.error);
        setSolverIncompleteReason(undefined);
        setSolverState("error");
      }
    };

    setSolverState("solving");
    setSolverError(undefined);
    setSolverIncompleteReason(undefined);
    const request: SolveRequest = {
      requestId,
      board,
      heroes,
      priorityOrder,
      favoritedCharacterIds: [...favoritedCharacterIds],
      antiFavoritedCharacterIds: [...antiFavoritedCharacterIds],
    };
    worker.postMessage(request);
  }, [board, heroes, priorityOrder, favoritedCharacterIds, antiFavoritedCharacterIds]);

  function toggleDevMode() {
    setDevModeEnabled((current) => {
      const next = !current;
      if (!next) {
        setViewMode("cards");
        setActiveTab("operations");
      }
      return next;
    });
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedExpeditionId(null);
        return;
      }
      if (e.key !== "8" || e.repeat) return;
      const now = Date.now();
      if (now - lastEightPressRef.current < 400) return;
      lastEightPressRef.current = now;
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
    titleTapCountRef.current = now - lastTitleTapRef.current > TITLE_TAP_WINDOW_MS ? 1 : titleTapCountRef.current + 1;
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

  // Same purely-visual purpose as the fetch countdown above - actual enforcement is the
  // solver's own per-pass timeout in board-solver.ts.
  useEffect(() => {
    if (solverState !== "solving") return;
    setSolverSecondsRemaining(SOLVER_COUNTDOWN_SECONDS);
    const interval = setInterval(() => {
      setSolverSecondsRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [solverState]);

  function toggleSelection(expeditionId: string) {
    setSelectedExpeditionId((current) => (current === expeditionId ? null : expeditionId));
  }

  async function go() {
    // Persist (or clear) credentials for the next visit. Wrapped in try/catch so a browser with
    // localStorage blocked (private mode, quota, policy) doesn't break the actual fetch below.
    try {
      if (userId && clientSecret) {
        localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, userId);
        localStorage.setItem(LOCAL_STORAGE_CLIENT_SECRET_KEY, clientSecret);
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

    // Fast-paint bootstrap from the background poller's cache (see worker/poller.ts) while the
    // real, per-account fetchCrusadeData() below is in flight. Guarded so a slow cache response
    // can never clobber fresher real data: sessionParamsRef is only ever populated once the real
    // fetch below succeeds, and the scheduler effect only starts once crusadeSessionId is bumped
    // (also only after a real success) - so this seed can't race it either way.
    fetchCrusadeCache()
      .then((cache) => {
        if (sessionParamsRef.current) return;
        const { crusadeData: seededCrusadeData, planetRefreshState: seeded } = seedPlanetRefreshStateFromCache(cache);
        if (!seededCrusadeData) return;
        setCrusadeData(seededCrusadeData);
        planetRefreshStateRef.current = seeded;
        setPlanetRefreshState(seeded);
      })
      .catch((error) => console.error("[App] go(): fetchCrusadeCache seed failed", error));

    try {
      setStatus("Reading local credentials...");
      setStatus("Fetching player data...");
      const data = await fetchPlayerData(environment, { userId, clientSecret });
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
      setSectorMap(data.sectorMap);
      setFetchState("success");
      if (!isTauri()) {
        void storeWebCredential(userId, clientSecret);
        void trackUsage(userId, environment);
      }
      // Best-effort restore of starred characters/planets - a failure here shouldn't affect the
      // data that already loaded successfully above, so it's not part of the try/catch's failure path.
      fetchUserPreferences(userId)
        .then((preferences) => {
          setFavoritedCharacterIds(new Set(preferences.favoritedCharacters));
          setFavoritedPlanetIds(new Set(preferences.favoritedPlanets));
          setAntiFavoritedCharacterIds(new Set(preferences.antiFavoritedCharacters));
        })
        .catch((error) => console.error("[App] go(): fetchUserPreferences failed", error));
    } catch (error) {
      console.error("[App] go(): caught error", error);
      setStatus(`Failed: ${error}`);
      setFetchState("error");
      return;
    }

    // Kept out of the try/catch above deliberately - a crusade-fetch failure (e.g. the
    // GAME_EVENT_GAME_CONFIG_VERSION/GAME_EVENT_MULTI_CONFIG_VERSION trio rotating again after a
    // future game update) shouldn't wipe out the board/character data that already loaded
    // successfully above. Split into two try/catches (rather than one shared one) so
    // crusadeError says which call actually failed - error.toString() already embeds the URL and
    // a JSON dump of the response, from post()/postGameEvent()'s error formatting.
    const webCredentials = { userId, clientSecret };
    let crusade;
    try {
      crusade = await fetchCrusadeData(environment, webCredentials);
      setCrusadeData(crusade);
    } catch (error) {
      console.error("[App] go(): GET_CRUSADE failed", error);
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
    const planetIds = crusade.phase === "STRUGGLE" ? crusade.planets.map((p) => p.planetId) : activePlanetIds(crusade.activeZone);
    const seeded = new Map<string, PlanetRefreshEntry>(
      planetIds.map((id) => [id, { leaderboard: null, lastSuccessAt: null, lastAttemptAt: null, lastAttemptFailed: false, isLoading: false }]),
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
      userId,
      clientSecret,
    };
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

  function commitPlanetSuccess(planetId: string, leaderboard: PlanetLeaderboard) {
    const now = Date.now();
    commitPlanetRefresh(planetId, { leaderboard, lastSuccessAt: now, lastAttemptAt: now, lastAttemptFailed: false, isLoading: false });
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
  // still always fires it too, see refreshPlanetNow.
  async function refreshCrusadeScores(): Promise<void> {
    const session = sessionParamsRef.current;
    if (!session) return;
    try {
      const crusade = await fetchCrusadeData(session.environment, { userId: session.userId, clientSecret: session.clientSecret });
      setCrusadeData(crusade);
    } catch (error) {
      console.error("[App] refreshCrusadeScores() failed", error);
    }
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

  // Claims the most-overdue eligible planet (not currently loading, past its cadence threshold)
  // by marking it isLoading synchronously - contains no `await`, so with up to 4 workers calling
  // this "at once", each call fully completes (including the ref mutation) before the next one's
  // synchronous body can run, making the claim race-free without any extra locking.
  function claimEligiblePlanet(thresholdMs: number): string | null {
    const map = planetRefreshStateRef.current;
    const now = Date.now();
    let candidate: string | null = null;
    let mostOverdueKey = Infinity;
    for (const [planetId, entry] of map) {
      if (entry.isLoading) continue;
      if (entry.lastAttemptAt !== null && now - entry.lastAttemptAt < thresholdMs) continue;
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
    return awaySince !== null && Date.now() - awaySince > AWAY_TRIGGER_MS ? AWAY_REFRESH_MS : NORMAL_REFRESH_MS;
  }

  function currentCrusadeScoreRefreshMs(): number {
    const awaySince = awayFromCrusadeSinceRef.current;
    return awaySince !== null && Date.now() - awaySince > AWAY_TRIGGER_MS ? CRUSADE_SCORE_AWAY_REFRESH_MS : CRUSADE_SCORE_ACTIVE_REFRESH_MS;
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
        await new Promise((resolve) => setTimeout(resolve, currentCrusadeScoreRefreshMs()));
        if (generationRef.current !== myGeneration) return;
        await refreshCrusadeScores();
      }
    }

    const workers = [...Array.from({ length: AUTO_REFRESH_WORKERS }, () => worker()), crusadeScoreRefreshLoop()];
    return () => {
      generationRef.current++;
      void workers;
    };
  }, [crusadeSessionId]);

  // Tracks how long the user has been away from the Crusades tab - reset to null the instant
  // they return (snapping the auto-refresh cadence back to 5 minutes immediately), started the
  // instant they leave.
  useEffect(() => {
    if (activeTab === "crusade") {
      awayFromCrusadeSinceRef.current = null;
    } else if (awayFromCrusadeSinceRef.current === null) {
      awayFromCrusadeSinceRef.current = Date.now();
    }
  }, [activeTab]);

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
      .catch((error) => console.error("[App] toggleFavoriteCharacter(): setFavoritedCharacters failed", error));

    // Favoriting and anti-favoriting a character at once makes no sense for the solver's
    // preference logic - turning one on clears the other, both locally and server-side.
    if (turningOn && antiFavoritedCharacterIds.has(characterId)) {
      const nextAnti = new Set(antiFavoritedCharacterIds);
      nextAnti.delete(characterId);
      setAntiFavoritedCharacterIds(nextAnti);
      setAntiFavoritedCharacters(userId, clientSecret, [...nextAnti]).catch((error) =>
        console.error("[App] toggleFavoriteCharacter(): clearing anti-favorite failed", error),
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
      .catch((error) => console.error("[App] toggleAntiFavoriteCharacter(): setAntiFavoritedCharacters failed", error));

    if (turningOn && favoritedCharacterIds.has(characterId)) {
      const nextFav = new Set(favoritedCharacterIds);
      nextFav.delete(characterId);
      setFavoritedCharacterIds(nextFav);
      setFavoritedCharacters(userId, clientSecret, [...nextFav]).catch((error) =>
        console.error("[App] toggleAntiFavoriteCharacter(): clearing favorite failed", error),
      );
    }
  }

  function toggleFavoritePlanet(planetId: string) {
    const next = new Set(favoritedPlanetIds);
    if (next.has(planetId)) next.delete(planetId);
    else next.add(planetId);
    setFavoritedPlanetIds(next);
    setFavoritedPlanets(userId, clientSecret, [...next])
      .then(() => setToastMessage("Favorite planets saved"))
      .catch((error) => console.error("[App] toggleFavoritePlanet(): setFavoritedPlanets failed", error));
  }

  return (
    <main
      onClick={() => setSelectedExpeditionId(null)}
      className="mx-auto flex min-h-screen w-full flex-col items-center bg-neutral-100 px-4 py-[5vh] text-center text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
    >
      <BuildTimestamp />
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
              : "Enter your Tacticus user ID and client secret to fetch your live account data and show your current expeditions board. Nothing you enter here is stored - only your browser remembers it, if you let it."}
          </p>

          {devModeEnabled && <EnvironmentToggle value={environment} onChange={setEnvironment} />}
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
                </div>
              </form>
              {resources && <ResourceTokens resources={resources} adViewsRemaining={adViewsRemaining} />}
              <p className="inline-flex items-center gap-2">
                {fetchState === "loading" && <Spinner seconds={secondsRemaining} />}
                {fetchState === "error" && <ErrorIcon />}
                {status}
              </p>
            </>
          )}

          {devModeEnabled && <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />}

          <div className="w-full overflow-x-auto pt-2">
            {activeTab === "operations" && (
              <>
                {board.length > 0 && (
                  <>
                    <RewardPriorityPicker value={priorityOrder} onChange={setPriorityOrder} />
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
                    <RequiredCharacterPool assignment={assignment} heroes={heroes} />
                  </>
                )}
                <div className="relative w-full">
                  {solverState === "solving" && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/70 dark:bg-neutral-900/70">
                      <p className="font-medium">Solving</p>
                      <Spinner size={64} seconds={solverSecondsRemaining} />
                    </div>
                  )}
                  <div className={solverState === "solving" ? "pointer-events-none" : ""}>
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
            {activeTab === "coverage" && <BoardCoverageTab />}
            {activeTab === "heroquests" && <HeroQuestsTab jars={heroQuestJars} />}
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
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}
