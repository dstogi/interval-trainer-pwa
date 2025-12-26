import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

/* =========================
   Types
========================= */

type PhaseType = "WARMUP" | "WORK" | "REST" | "COOLDOWN";
type RunStatus = "IDLE" | "RUNNING" | "PAUSED" | "FINISHED";
type RestKind = "REP" | "SET" | null;

type TimingConfig = {
  warmupSec: number;
  workSec: number;
  restBetweenRepsSec: number;
  repsPerSet: number;
  restBetweenSetsSec: number;
  sets: number;
  cooldownSec: number;
};

type Exercise = {
  name: string;
  notes: string;
};

type CardKind = "TIME" | "REPS";

type TimeCard = {
  kind: "TIME";
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  exercise: Exercise;
  timing: TimingConfig;
};

type RepSet = {
  id: string;
  exercise: string;
  reps: number;
  weightKg: number; // Zusatzgewicht pro Wiederholung
};

type RepCard = {
  kind: "REPS";
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;

  sets: RepSet[];
  restBetweenSetsSec: number;
  targetSetSec?: number;
};

type IntervalCard = TimeCard | RepCard;

type Phase = {
  type: PhaseType;
  label: string;
  restKind: RestKind;
  durationSec: number;
  set: number;
  rep: number;
};

type Prefs = {
  sound: boolean;
  vibration: boolean;
  countdownBeeps: boolean;
};

type Screen =
  | { name: "HOME" }
  | { name: "EDIT"; id?: string; kind?: CardKind }
  | { name: "RUN"; id: string }
  | { name: "HISTORY" }
  | { name: "PROFILES" }
  | { name: "RANKING" };

type RunnerState = {
  status: RunStatus;
  phaseIndex: number;
  remainingSec: number;
  totalRemainingSec: number;
};

/* =========================
   Profiles + History Types
========================= */

type Profile = {
  id: string;
  name: string; // Person oder Gruppe
  createdAt: number;
};

type WorkoutLogKind = "TIME" | "REPS";

type TimeLogData = {
  exercise: string;
  plannedTotalSec: number;
  sets: number;
  repsPerSet: number;
  workSec: number;
  restBetweenSetsSec: number;
};

type RepLogData = {
  totalReps: number;
  totalKg: number; // bewegte kg = Σ(Wdh × Zusatzgewicht)
  setsCount: number;
  restBetweenSetsSec: number;
  targetSetSec?: number;
  breakdown: { exercise: string; reps: number; kg: number }[];
};

type WorkoutLogEntry = {
  id: string;
  createdAt: number;
  profileId: string;

  kind: WorkoutLogKind;
  cardId?: string;
  cardTitle: string;

  time?: TimeLogData;
  reps?: RepLogData;
};

/* =========================
   Share Payload (ohne Backend)
========================= */

type SharePayload =
  | { v: 1; type: "CARD"; card: IntervalCard; fromProfileName?: string }
  | { v: 1; type: "LOG"; entry: WorkoutLogEntry; profileName: string };

/* =========================
   Storage Keys
========================= */

const CARDS_KEY = "interval_trainer_cards_v1";
const PREFS_KEY = "interval_trainer_prefs_v1";

const PROFILES_KEY = "interval_trainer_profiles_v1";
const ACTIVE_PROFILE_KEY = "interval_trainer_active_profile_v1";
const HISTORY_KEY = "interval_trainer_history_v1";

/* =========================
   Small Helpers
========================= */

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
}

function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.min(max, Math.max(min, x));
}

function parseTimeToSec(input: string): number {
  const s = input.trim();
  if (!s) return 0;

  if (s.includes(":")) {
    const parts = s.split(":").map((p) => p.trim());
    if (parts.length !== 2) return 0;
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    if (!Number.isFinite(mm) || !Number.isFinite(ss)) return 0;
    return Math.max(0, Math.trunc(mm) * 60 + Math.trunc(ss));
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

// mm:ss -> sec, aber "leer" => null (für optionale Felder)
function parseMMSS(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  return parseTimeToSec(s);
}

function formatMMSS(totalSec: number): string {
  const sec = Math.max(0, Math.trunc(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

function safeFilePart(s: string): string {
  return (
    (s || "data")
      .toString()
      .trim()
      .replace(/[\s]+/g, "_")
      .replace(/[^\w\-]+/g, "")
      .slice(0, 40) || "data"
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

async function shareLink(opts: { title: string; text: string; url: string }) {
  // Mobile Share API
  if ("share" in navigator) {
    try {
      // @ts-expect-error share exists in modern browsers
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
      return;
    } catch {
      // user canceled -> fallback below
    }
  }

  const ok = await copyToClipboard(opts.url);
  if (ok) {
    alert("Link wurde in die Zwischenablage kopiert ✅");
  } else {
    window.prompt("Link kopieren:", opts.url);
  }
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscapeCell(value: any, delimiter = ";"): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const needsQuote = s.includes('"') || s.includes("\n") || s.includes("\r") || s.includes(delimiter);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function toCSV(rows: any[][], delimiter = ";"): string {
  return rows.map((r) => r.map((c) => csvEscapeCell(c, delimiter)).join(delimiter)).join("\n");
}

/* =========================
   Base64URL for Share Payload
========================= */

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(b64url: string): string {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function makeShareUrl(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  const enc = base64UrlEncode(json);
  return `${window.location.origin}${window.location.pathname}#share=${enc}`;
}

function decodeSharePayloadFromHash(): SharePayload | null {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#share=")) return null;
  const enc = hash.slice("#share=".length);
  try {
    const json = base64UrlDecode(enc);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== 1) return null;
    if (parsed.type === "CARD" && parsed.card) return parsed as SharePayload;
    if (parsed.type === "LOG" && parsed.entry && typeof parsed.profileName === "string") return parsed as SharePayload;
    return null;
  } catch {
    return null;
  }
}

function clearHashWithoutReload() {
  try {
    history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    window.location.hash = "";
  }
}

/* =========================
   Cards Helpers
========================= */

function isRepCard(card: IntervalCard): card is RepCard {
  return (card as any).kind === "REPS";
}

function repTotals(card: RepCard) {
  const totalReps = card.sets.reduce((sum, s) => sum + (s.reps || 0), 0);
  const totalKg = card.sets.reduce((sum, s) => sum + (s.reps || 0) * (s.weightKg || 0), 0);
  return { totalReps, totalKg };
}

function repBreakdown(card: RepCard) {
  const map = new Map<string, { reps: number; kg: number }>();
  for (const s of card.sets) {
    const key = (s.exercise || "—").trim() || "—";
    const prev = map.get(key) ?? { reps: 0, kg: 0 };
    prev.reps += s.reps || 0;
    prev.kg += (s.reps || 0) * (s.weightKg || 0);
    map.set(key, prev);
  }
  return Array.from(map.entries()).map(([exercise, v]) => ({ exercise, ...v }));
}

/* =========================
   TIME: Phasen bauen
========================= */

function buildPhases(card: TimeCard): Phase[] {
  const t = card.timing;
  const sets = Math.max(1, t.sets);
  const reps = Math.max(1, t.repsPerSet);

  const phases: Phase[] = [];

  if (t.warmupSec > 0) {
    phases.push({ type: "WARMUP", label: "WARMUP", restKind: null, durationSec: t.warmupSec, set: 0, rep: 0 });
  }

  for (let s = 1; s <= sets; s++) {
    for (let r = 1; r <= reps; r++) {
      if (t.workSec > 0) {
        phases.push({ type: "WORK", label: "ARBEIT", restKind: null, durationSec: t.workSec, set: s, rep: r });
      }

      if (r < reps && t.restBetweenRepsSec > 0) {
        phases.push({
          type: "REST",
          label: "PAUSE (Wdh)",
          restKind: "REP",
          durationSec: t.restBetweenRepsSec,
          set: s,
          rep: r,
        });
      }
    }

    if (s < sets && t.restBetweenSetsSec > 0) {
      phases.push({
        type: "REST",
        label: "PAUSE (Satz)",
        restKind: "SET",
        durationSec: t.restBetweenSetsSec,
        set: s,
        rep: reps,
      });
    }
  }

  if (t.cooldownSec > 0) {
    phases.push({ type: "COOLDOWN", label: "COOLDOWN", restKind: null, durationSec: t.cooldownSec, set: 0, rep: 0 });
  }

  if (phases.length === 0) {
    phases.push({ type: "WORK", label: "ARBEIT", restKind: null, durationSec: 20, set: 1, rep: 1 });
  }

  return phases;
}

function totalSessionSec(phases: Phase[]): number {
  return phases.reduce((acc, p) => acc + p.durationSec, 0);
}

function computeRemainingTotal(phases: Phase[], idx: number, remainingSec: number): number {
  let total = remainingSec;
  for (let i = idx + 1; i < phases.length; i++) total += phases[i].durationSec;
  return total;
}

/* =========================
   Cards Storage (normalisiert)
========================= */

function normalizeLoadedCard(raw: any): IntervalCard | null {
  if (!raw || typeof raw !== "object") return null;

  // REPS
  if (raw.kind === "REPS") {
    const setsRaw = Array.isArray(raw.sets) ? raw.sets : [];
    const sets: RepSet[] = setsRaw.map((s: any) => ({
      id: typeof s?.id === "string" ? s.id : makeId(),
      exercise: typeof s?.exercise === "string" ? s.exercise : "",
      reps: Number(s?.reps) || 0,
      weightKg: Number(s?.weightKg) || 0,
    }));

    return {
      kind: "REPS",
      id: typeof raw.id === "string" ? raw.id : makeId(),
      title: typeof raw.title === "string" ? raw.title : "Wdh‑Session",
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
      sets: sets.length ? sets : [{ id: makeId(), exercise: "", reps: 10, weightKg: 0 }],
      restBetweenSetsSec: typeof raw.restBetweenSetsSec === "number" ? raw.restBetweenSetsSec : 60,
      targetSetSec: typeof raw.targetSetSec === "number" ? raw.targetSetSec : undefined,
    };
  }

  // TIME (alte Karten können ohne "kind" kommen)
  if (raw.timing && raw.exercise) {
    const t = raw.timing ?? {};
    return {
      kind: "TIME",
      id: typeof raw.id === "string" ? raw.id : makeId(),
      title: typeof raw.title === "string" ? raw.title : "Interval",
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
      exercise: {
        name: typeof raw.exercise?.name === "string" ? raw.exercise.name : "",
        notes: typeof raw.exercise?.notes === "string" ? raw.exercise.notes : "",
      },
      timing: {
        warmupSec: Number(t.warmupSec) || 0,
        workSec: Number(t.workSec) || 20,
        restBetweenRepsSec: Number(t.restBetweenRepsSec) || 0,
        repsPerSet: Number(t.repsPerSet) || 1,
        restBetweenSetsSec: Number(t.restBetweenSetsSec) || 60,
        sets: Number(t.sets) || 4,
        cooldownSec: Number(t.cooldownSec) || 0,
      },
    };
  }

  return null;
}

function loadCards(): IntervalCard[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => normalizeLoadedCard(x)).filter((x): x is IntervalCard => Boolean(x));
  } catch {
    return [];
  }
}

function saveCards(cards: IntervalCard[]) {
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

/* =========================
   Prefs Storage
========================= */

function loadPrefs(): Prefs {
  const defaults: Prefs = { sound: true, vibration: true, countdownBeeps: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      sound: parsed.sound ?? defaults.sound,
      vibration: parsed.vibration ?? defaults.vibration,
      countdownBeeps: parsed.countdownBeeps ?? defaults.countdownBeeps,
    };
  } catch {
    return defaults;
  }
}

function savePrefs(prefs: Prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/* =========================
   Profiles Storage
========================= */

function makeDefaultProfile(): Profile {
  return { id: makeId(), name: "Ich", createdAt: Date.now() };
}

function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p === "object")
      .map((p) => ({
        id: typeof p.id === "string" ? p.id : makeId(),
        name: typeof p.name === "string" ? p.name : "Profil",
        createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
      })) as Profile[];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: Profile[]) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function loadActiveProfileId(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_PROFILE_KEY);
    return raw ? raw : null;
  } catch {
    return null;
  }
}

function saveActiveProfileId(id: string) {
  localStorage.setItem(ACTIVE_PROFILE_KEY, id);
}

/* =========================
   History Storage
========================= */

function loadHistory(): WorkoutLogEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkoutLogEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: WorkoutLogEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

/* =========================
   Sample / Random Cards
========================= */

function makeSampleCard(): TimeCard {
  const now = Date.now();
  return {
    kind: "TIME",
    id: makeId(),
    title: "HIIT Kurz",
    exercise: { name: "Liegestütze", notes: "" },
    timing: {
      warmupSec: 0,
      workSec: 20,
      restBetweenRepsSec: 0,
      repsPerSet: 1,
      restBetweenSetsSec: 60,
      sets: 4,
      cooldownSec: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeRandomCard(): TimeCard {
  const exercises = ["Liegestütze", "Kniebeugen", "Mountain Climbers", "Burpees", "Plank", "Ausfallschritte"];
  const name = exercises[Math.floor(Math.random() * exercises.length)];
  const sets = clampInt(3 + Math.floor(Math.random() * 4), 2, 8);
  const work = [20, 30, 40][Math.floor(Math.random() * 3)];
  const restSet = [30, 45, 60][Math.floor(Math.random() * 3)];
  const now = Date.now();
  return {
    kind: "TIME",
    id: makeId(),
    title: `Zufall – ${name}`,
    exercise: { name, notes: "" },
    timing: {
      warmupSec: 0,
      workSec: work,
      restBetweenRepsSec: 0,
      repsPerSet: 1,
      restBetweenSetsSec: restSet,
      sets,
      cooldownSec: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeRandomRepCard(): RepCard {
  const now = Date.now();
  const pool = ["Liegestütze", "Kniebeuge", "Dips", "Klimmzüge", "Rudern"];
  const base = pool[Math.floor(Math.random() * pool.length)];
  const sameExercise = Math.random() < 0.6;
  const setsCount = 4;

  const sets: RepSet[] = Array.from({ length: setsCount }, () => {
    const exercise = sameExercise ? base : pool[Math.floor(Math.random() * pool.length)];
    const reps = 6 + Math.floor(Math.random() * 10);
    const weightKg = Math.random() < 0.5 ? 0 : 2.5 * (1 + Math.floor(Math.random() * 8));
    return { id: makeId(), exercise, reps, weightKg };
  });

  return {
    kind: "REPS",
    id: makeId(),
    title: `Zufall – Wdh`,
    createdAt: now,
    updatedAt: now,
    sets,
    restBetweenSetsSec: 60,
    targetSetSec: 60,
  };
}

/* =========================
   Beep
========================= */

function beepOnce(freq: number, ms: number, volume = 0.2) {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctx) return;

  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + ms / 1000);

  setTimeout(() => {
    ctx.close().catch(() => {});
  }, ms + 50);
}

/* =========================
   Log Entry Builders
========================= */

function makeTimeLogEntry(profileId: string, card: TimeCard, plannedTotalSec: number): WorkoutLogEntry {
  return {
    id: makeId(),
    createdAt: Date.now(),
    profileId,
    kind: "TIME",
    cardId: card.id,
    cardTitle: card.title,
    time: {
      exercise: card.exercise.name,
      plannedTotalSec,
      sets: card.timing.sets,
      repsPerSet: card.timing.repsPerSet,
      workSec: card.timing.workSec,
      restBetweenSetsSec: card.timing.restBetweenSetsSec,
    },
  };
}

function makeRepLogEntry(profileId: string, card: RepCard): WorkoutLogEntry {
  const { totalReps, totalKg } = repTotals(card);
  const breakdown = repBreakdown(card);
  return {
    id: makeId(),
    createdAt: Date.now(),
    profileId,
    kind: "REPS",
    cardId: card.id,
    cardTitle: card.title,
    reps: {
      totalReps,
      totalKg,
      setsCount: card.sets.length,
      restBetweenSetsSec: card.restBetweenSetsSec,
      targetSetSec: card.targetSetSec,
      breakdown,
    },
  };
}

/* =========================
   App
========================= */

function initProfilesState(): { profiles: Profile[]; activeId: string } {
  const loaded = loadProfiles();
  const profiles = loaded.length ? loaded : [makeDefaultProfile()];

  const storedActive = loadActiveProfileId();
  const activeId = storedActive && profiles.some((p) => p.id === storedActive) ? storedActive : profiles[0].id;

  return { profiles, activeId };
}

function cloneImportedCard(raw: IntervalCard): IntervalCard {
  const now = Date.now();
  if (isRepCard(raw)) {
    return {
      kind: "REPS",
      id: makeId(),
      title: raw.title,
      createdAt: now,
      updatedAt: now,
      restBetweenSetsSec: Number(raw.restBetweenSetsSec) || 60,
      targetSetSec: typeof raw.targetSetSec === "number" ? raw.targetSetSec : undefined,
      sets: (Array.isArray(raw.sets) ? raw.sets : []).map((s) => ({
        id: makeId(),
        exercise: (s.exercise || "").toString(),
        reps: Number(s.reps) || 0,
        weightKg: Number(s.weightKg) || 0,
      })),
    };
  }

  return {
    kind: "TIME",
    id: makeId(),
    title: raw.title,
    createdAt: now,
    updatedAt: now,
    exercise: { name: raw.exercise?.name ?? "", notes: raw.exercise?.notes ?? "" },
    timing: {
      warmupSec: Number(raw.timing?.warmupSec) || 0,
      workSec: Number(raw.timing?.workSec) || 20,
      restBetweenRepsSec: Number(raw.timing?.restBetweenRepsSec) || 0,
      repsPerSet: Number(raw.timing?.repsPerSet) || 1,
      restBetweenSetsSec: Number(raw.timing?.restBetweenSetsSec) || 60,
      sets: Number(raw.timing?.sets) || 4,
      cooldownSec: Number(raw.timing?.cooldownSec) || 0,
    },
  };
}

export default function App() {
  const [profileInit] = useState(() => initProfilesState());
  const [profiles, setProfiles] = useState<Profile[]>(profileInit.profiles);
  const [activeProfileId, setActiveProfileId] = useState<string>(profileInit.activeId);

  const activeProfile = useMemo(() => profiles.find((p) => p.id === activeProfileId) ?? null, [profiles, activeProfileId]);

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  const [cards, setCards] = useState<IntervalCard[]>(() => {
    const loaded = loadCards();
    return loaded.length ? loaded : [makeSampleCard()];
  });

  const [history, setHistory] = useState<WorkoutLogEntry[]>(() => loadHistory());

  const [screen, setScreen] = useState<Screen>({ name: "HOME" });

  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => saveCards(cards), [cards]);
  useEffect(() => saveProfiles(profiles), [profiles]);
  useEffect(() => saveActiveProfileId(activeProfileId), [activeProfileId]);
  useEffect(() => saveHistory(history), [history]);

  function profileName(id: string) {
    return profiles.find((p) => p.id === id)?.name ?? "Unbekannt";
  }

  function ensureProfileByName(name: string): string {
    const wanted = (name || "Unbekannt").trim();
    if (!wanted) return activeProfileId;

    const existing = profiles.find((p) => p.name.trim().toLowerCase() === wanted.toLowerCase());
    if (existing) return existing.id;

    const p: Profile = { id: makeId(), name: wanted, createdAt: Date.now() };
    setProfiles((prev) => [p, ...prev]);
    return p.id;
  }

  const activeCard = useMemo(() => {
    if (screen.name === "RUN") return cards.find((c) => c.id === screen.id) ?? null;
    if (screen.name === "EDIT" && screen.id) return cards.find((c) => c.id === screen.id) ?? null;
    return null;
  }, [cards, screen]);

  function upsertCard(card: IntervalCard) {
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.id === card.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = card;
        return copy;
      }
      return [card, ...prev];
    });
  }

  function deleteCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  function duplicateCard(id: string) {
    const original = cards.find((c) => c.id === id);
    if (!original) return;

    const now = Date.now();

    if (isRepCard(original)) {
      const copy: RepCard = {
        ...original,
        id: makeId(),
        title: original.title + " (Kopie)",
        createdAt: now,
        updatedAt: now,
        sets: original.sets.map((s) => ({ ...s, id: makeId() })),
      };
      setCards((prev) => [copy, ...prev]);
      return;
    }

    const copy: TimeCard = {
      ...original,
      kind: "TIME",
      id: makeId(),
      title: original.title + " (Kopie)",
      createdAt: now,
      updatedAt: now,
    };
    setCards((prev) => [copy, ...prev]);
  }

  function addHistoryEntry(entry: WorkoutLogEntry) {
    setHistory((prev) => [entry, ...prev]);
  }

  function deleteHistoryEntry(id: string) {
    setHistory((prev) => prev.filter((e) => e.id !== id));
  }

  function clearHistoryForActiveProfile() {
    if (!activeProfileId) return;
    if (!window.confirm("Verlauf für aktuelles Profil wirklich löschen?")) return;
    setHistory((prev) => prev.filter((e) => e.profileId !== activeProfileId));
  }

  function addProfile(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const p: Profile = { id: makeId(), name: trimmed, createdAt: Date.now() };
    setProfiles((prev) => [p, ...prev]);
    setActiveProfileId(p.id);
  }

  function renameProfile(id: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }

  function removeProfile(id: string) {
    setProfiles((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((p) => p.id !== id);
      if (activeProfileId === id) setActiveProfileId(next[0]?.id ?? prev[0].id);
      return next;
    });
  }

  async function shareChallenge(card: IntervalCard) {
    const payload: SharePayload = {
      v: 1,
      type: "CARD",
      card,
      fromProfileName: activeProfile?.name ?? "Unbekannt",
    };

    const url = makeShareUrl(payload);

    await shareLink({
      title: "Interval Trainer – Challenge",
      text: `Challenge von ${activeProfile?.name ?? "Unbekannt"}: ${card.title}`,
      url,
    });
  }

  // Import aus #share=... beim App-Start
  useEffect(() => {
    const payload = decodeSharePayloadFromHash();
    if (!payload) return;

    // Hash sofort entfernen, sonst importiert man beim Reload erneut
    clearHashWithoutReload();

    if (payload.type === "CARD") {
      const from = payload.fromProfileName ? ` von ${payload.fromProfileName}` : "";
      const ok = window.confirm(`Challenge${from} importieren?\n\n"${payload.card.title}"`);
      if (!ok) return;

      const imported = cloneImportedCard(payload.card);
      setCards((prev) => [imported, ...prev]);
      alert("Challenge importiert ✅");
      setScreen({ name: "HOME" });
      return;
    }

    if (payload.type === "LOG") {
      const ok = window.confirm(`Ergebnis importieren?\n\nProfil: ${payload.profileName}\nSession: ${payload.entry.cardTitle}`);
      if (!ok) return;

      const pid = ensureProfileByName(payload.profileName);

      const incoming = payload.entry;
      const imported: WorkoutLogEntry = {
        ...incoming,
        id: makeId(),
        profileId: pid,
        createdAt: typeof incoming.createdAt === "number" ? incoming.createdAt : Date.now(),
      };

      setHistory((prev) => {
        const dup = prev.some(
          (e) =>
            e.profileId === imported.profileId &&
            e.kind === imported.kind &&
            e.createdAt === imported.createdAt &&
            e.cardTitle === imported.cardTitle
        );
        if (dup) return prev;
        return [imported, ...prev];
      });

      alert("Ergebnis importiert ✅");
      setScreen({ name: "HISTORY" });
      return;
    }
  }, [activeProfile?.name, activeProfileId, profiles]); // profiles nötig für ensureProfileByName

  return (
    <div className="app-shell">
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Interval Trainer</h2>

        {/* HOME */}
        {screen.name === "HOME" && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Profil:
                <select value={activeProfileId} onChange={(e) => setActiveProfileId(e.target.value)}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <button onClick={() => setScreen({ name: "HISTORY" })}>Verlauf</button>
              <button onClick={() => setScreen({ name: "RANKING" })}>Ranking</button>
              <button onClick={() => setScreen({ name: "PROFILES" })}>Profile</button>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setScreen({ name: "EDIT", kind: "TIME" })}>+ Zeit‑Karte</button>
              <button onClick={() => setScreen({ name: "EDIT", kind: "REPS" })}>+ Wdh‑Karte</button>

              <button
                onClick={() => {
                  const c = Math.random() < 0.5 ? makeRandomCard() : makeRandomRepCard();
                  upsertCard(c);
                }}
              >
                🎲 Zufalls‑Session
              </button>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
              {cards.map((card) => {
                if (isRepCard(card)) {
                  const { totalReps, totalKg } = repTotals(card);

                  return (
                    <div key={card.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontWeight: 700 }}>{card.title}</div>

                      <div style={{ fontSize: 13, marginTop: 6 }}>
                        {card.sets.length} Sätze · {totalReps} Wdh gesamt · {totalKg.toFixed(1)} kg bewegt (Zusatzgewicht)
                        {" · "}Pause {formatMMSS(card.restBetweenSetsSec)}
                        {card.targetSetSec ? ` · Zielzeit/Satz ${formatMMSS(card.targetSetSec)}` : ""}
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <button onClick={() => setScreen({ name: "RUN", id: card.id })}>Start</button>
                        <button onClick={() => setScreen({ name: "EDIT", id: card.id })}>Bearbeiten</button>
                        <button onClick={() => duplicateCard(card.id)}>Duplizieren</button>
                        <button onClick={() => deleteCard(card.id)}>Löschen</button>
                        <button onClick={() => shareChallenge(card)}>Challenge teilen</button>
                      </div>
                    </div>
                  );
                }

                const phases = buildPhases(card);
                const total = totalSessionSec(phases);

                return (
                  <div key={card.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                    <div style={{ fontWeight: 700 }}>{card.title}</div>
                    <div style={{ fontSize: 14, opacity: 0.8 }}>Übung: {card.exercise.name || "—"}</div>

                    <div style={{ fontSize: 13, marginTop: 6 }}>
                      {card.timing.sets} Sätze · {card.timing.repsPerSet} Wdh/Satz · Arbeit {formatMMSS(card.timing.workSec)}
                      {" · "}Satzpause {formatMMSS(card.timing.restBetweenSetsSec)}
                      {" · "}Gesamt {formatMMSS(total)}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button onClick={() => setScreen({ name: "RUN", id: card.id })}>Start</button>
                      <button onClick={() => setScreen({ name: "EDIT", id: card.id })}>Bearbeiten</button>
                      <button onClick={() => duplicateCard(card.id)}>Duplizieren</button>
                      <button onClick={() => deleteCard(card.id)}>Löschen</button>
                      <button onClick={() => shareChallenge(card)}>Challenge teilen</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>
              Tipp fürs iPhone: Safari → Share → <b>Zum Home‑Bildschirm</b>.
              <br />
              Tipp für Wettbewerb: „Challenge teilen“ → Link an Freunde schicken → Ergebnisse importieren → Ranking vergleichen.
            </div>
          </>
        )}

        {/* PROFILES */}
        {screen.name === "PROFILES" && (
          <ProfilesView
            profiles={profiles}
            activeProfileId={activeProfileId}
            onBack={() => setScreen({ name: "HOME" })}
            onSetActive={setActiveProfileId}
            onAdd={addProfile}
            onRename={renameProfile}
            onDelete={removeProfile}
          />
        )}

        {/* HISTORY */}
        {screen.name === "HISTORY" && (
          <HistoryView
            entries={history}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onChangeActiveProfile={setActiveProfileId}
            profileName={profileName}
            onBack={() => setScreen({ name: "HOME" })}
            onDeleteEntry={deleteHistoryEntry}
            onClearActiveProfile={clearHistoryForActiveProfile}
            cards={cards}
            prefs={prefs}
          />
        )}

        {/* RANKING */}
        {screen.name === "RANKING" && (
          <RankingView
            entries={history}
            profiles={profiles}
            onBack={() => setScreen({ name: "HOME" })}
          />
        )}

        {/* EDIT */}
        {screen.name === "EDIT" &&
          (() => {
            const editKind: CardKind =
              activeCard ? (isRepCard(activeCard) ? "REPS" : "TIME") : screen.kind ?? "TIME";

            if (editKind === "REPS") {
              const initial = activeCard && isRepCard(activeCard) ? activeCard : null;
              return (
                <RepEditor
                  initial={initial}
                  onCancel={() => setScreen({ name: "HOME" })}
                  onSave={(saved) => {
                    upsertCard(saved);
                    setScreen({ name: "HOME" });
                  }}
                />
              );
            }

            const initial = activeCard && !isRepCard(activeCard) ? activeCard : null;
            return (
              <Editor
                initial={initial}
                onCancel={() => setScreen({ name: "HOME" })}
                onSave={(saved) => {
                  upsertCard(saved);
                  setScreen({ name: "HOME" });
                }}
              />
            );
          })()}

        {/* RUN */}
        {screen.name === "RUN" && activeCard && (
          isRepCard(activeCard) ? (
            <RepRunner
              card={activeCard}
              profileId={activeProfileId}
              profileName={activeProfile?.name ?? "Unbekannt"}
              onSaveLog={addHistoryEntry}
              onBack={() => setScreen({ name: "HOME" })}
            />
          ) : (
            <Runner
              card={activeCard}
              prefs={prefs}
              onPrefsChange={setPrefs}
              profileId={activeProfileId}
              profileName={activeProfile?.name ?? "Unbekannt"}
              onSaveLog={addHistoryEntry}
              onBack={() => setScreen({ name: "HOME" })}
            />
          )
        )}
      </div>
    </div>
  );
}

/* =========================
   TIME Editor
========================= */

function Editor({
  initial,
  onCancel,
  onSave,
}: {
  initial: TimeCard | null;
  onCancel: () => void;
  onSave: (card: TimeCard) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [exercise, setExercise] = useState(initial?.exercise.name ?? "");
  const [notes, setNotes] = useState(initial?.exercise.notes ?? "");

  const [warmup, setWarmup] = useState(formatMMSS(initial?.timing.warmupSec ?? 0));
  const [work, setWork] = useState(formatMMSS(initial?.timing.workSec ?? 20));
  const [restRep, setRestRep] = useState(formatMMSS(initial?.timing.restBetweenRepsSec ?? 0));
  const [repsPerSet, setRepsPerSet] = useState<number>(initial?.timing.repsPerSet ?? 1);
  const [restSet, setRestSet] = useState(formatMMSS(initial?.timing.restBetweenSetsSec ?? 60));
  const [sets, setSets] = useState<number>(initial?.timing.sets ?? 4);
  const [cooldown, setCooldown] = useState(formatMMSS(initial?.timing.cooldownSec ?? 0));

  const [error, setError] = useState<string>("");

  function save() {
    setError("");

    const timing: TimingConfig = {
      warmupSec: parseTimeToSec(warmup),
      workSec: parseTimeToSec(work),
      restBetweenRepsSec: parseTimeToSec(restRep),
      repsPerSet: clampInt(repsPerSet, 1, 99),
      restBetweenSetsSec: parseTimeToSec(restSet),
      sets: clampInt(sets, 1, 99),
      cooldownSec: parseTimeToSec(cooldown),
    };

    if (!title.trim()) return setError("Bitte einen Titel eingeben.");
    if (!exercise.trim()) return setError("Bitte eine Übung eingeben (z.B. Liegestütze).");
    if (timing.workSec <= 0) return setError("Arbeitszeit muss > 0 sein.");

    const now = Date.now();
    const saved: TimeCard = {
      kind: "TIME",
      id: initial?.id ?? makeId(),
      title: title.trim(),
      exercise: { name: exercise.trim(), notes: notes.trim() },
      timing,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };

    onSave(saved);
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{initial ? "Karte bearbeiten" : "Neue Zeit‑Karte"}</h3>

      {error && (
        <div style={{ background: "#ffe5e5", padding: 10, borderRadius: 10, marginBottom: 10 }}>
          <b>Fehler:</b> {error}
        </div>
      )}

      <label style={{ display: "block", marginBottom: 8 }}>
        Titel
        <input style={{ width: "100%" }} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        Übung (z.B. Liegestütze)
        <input style={{ width: "100%" }} value={exercise} onChange={(e) => setExercise(e.target.value)} />
      </label>

      <label style={{ display: "block", marginBottom: 8 }}>
        Notizen (optional)
        <input style={{ width: "100%" }} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        <TimeField label="Warmup" value={warmup} onChange={setWarmup} />
        <TimeField label="Cooldown" value={cooldown} onChange={setCooldown} />

        <TimeField label="Arbeit (mm:ss)" value={work} onChange={setWork} />
        <TimeField label="Pause Wdh (mm:ss)" value={restRep} onChange={setRestRep} />

        <NumberField label="Wiederholungen pro Satz" value={repsPerSet} onChange={setRepsPerSet} />
        <NumberField label="Sätze" value={sets} onChange={setSets} />

        <TimeField label="Satzpause (mm:ss)" value={restSet} onChange={setRestSet} />
        <div />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={save}>Speichern</button>
        <button onClick={onCancel}>Abbrechen</button>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        Tipp: Zeitformat entweder <b>mm:ss</b> (z.B. 01:00) oder einfach Sekunden (z.B. 60).
      </div>
    </div>
  );
}

/* =========================
   REPS Editor
========================= */

function RepEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: RepCard | null;
  onCancel: () => void;
  onSave: (card: RepCard) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "Wdh‑Session");
  const [restSet, setRestSet] = useState(formatMMSS(initial?.restBetweenSetsSec ?? 60));
  const [targetSet, setTargetSet] = useState(formatMMSS(initial?.targetSetSec ?? 0));

  const [sets, setSets] = useState<RepSet[]>(
    initial?.sets ?? [
      { id: makeId(), exercise: "Liegestütze", reps: 10, weightKg: 0 },
      { id: makeId(), exercise: "Liegestütze", reps: 10, weightKg: 0 },
      { id: makeId(), exercise: "Liegestütze", reps: 10, weightKg: 0 },
      { id: makeId(), exercise: "Liegestütze", reps: 10, weightKg: 0 },
    ]
  );

  function resizeSets(n: number) {
    const nextN = Math.max(1, Math.min(50, n || 1));
    setSets((prev) => {
      if (prev.length === nextN) return prev;
      if (prev.length > nextN) return prev.slice(0, nextN);

      const last = prev[prev.length - 1] ?? { id: makeId(), exercise: "", reps: 10, weightKg: 0 };
      const extra = Array.from({ length: nextN - prev.length }, () => ({
        ...last,
        id: makeId(),
      }));
      return [...prev, ...extra];
    });
  }

  function updateSet(id: string, patch: Partial<RepSet>) {
    setSets((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeSet(id: string) {
    setSets((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.id !== id)));
  }

  const previewCard: RepCard = {
    kind: "REPS",
    id: initial?.id ?? "preview",
    title,
    createdAt: initial?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    sets,
    restBetweenSetsSec: parseMMSS(restSet) ?? 60,
    targetSetSec: (parseMMSS(targetSet) ?? 0) || undefined,
  };

  const { totalReps, totalKg } = repTotals(previewCard);

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
      <h3 style={{ marginTop: 0 }}>{initial ? "Wdh‑Karte bearbeiten" : "Neue Wdh‑Karte"}</h3>

      <label>
        Titel
        <input style={{ width: "100%" }} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label>
          Pause (mm:ss)
          <input value={restSet} onChange={(e) => setRestSet(e.target.value)} />
        </label>

        <label>
          Zielzeit/Satz (optional mm:ss)
          <input value={targetSet} onChange={(e) => setTargetSet(e.target.value)} />
        </label>

        <label>
          Anzahl Sätze
          <input
            type="number"
            min={1}
            value={sets.length}
            onChange={(e) => resizeSets(Number(e.target.value))}
            style={{ width: 90 }}
          />
        </label>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {sets.map((s, i) => (
          <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ width: 22, opacity: 0.7 }}>{i + 1}.</div>

            <input
              value={s.exercise}
              onChange={(e) => updateSet(s.id, { exercise: e.target.value })}
              placeholder="Übung"
              style={{ flex: "1 1 160px" }}
            />

            <input
              type="number"
              min={0}
              value={s.reps}
              onChange={(e) => updateSet(s.id, { reps: Number(e.target.value) })}
              style={{ width: 90 }}
              title="Wdh"
            />

            <input
              type="number"
              min={0}
              step={0.5}
              value={s.weightKg}
              onChange={(e) => updateSet(s.id, { weightKg: Number(e.target.value) })}
              style={{ width: 130 }}
              title="Zusatzgewicht (kg)"
            />

            <button onClick={() => removeSet(s.id)}>✕</button>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, opacity: 0.8 }}>
        Gesamt: <b>{totalReps}</b> Wdh · <b>{totalKg.toFixed(1)}</b> kg bewegt (Zusatzgewicht)
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onCancel}>Abbrechen</button>
        <button
          onClick={() => {
            const now = Date.now();
            const saved: RepCard = {
              kind: "REPS",
              id: initial?.id ?? makeId(),
              title: title.trim() || "Wdh‑Session",
              createdAt: initial?.createdAt ?? now,
              updatedAt: now,
              sets: sets.map((s) => ({
                ...s,
                exercise: (s.exercise || "").trim(),
                reps: Math.max(0, Number(s.reps) || 0),
                weightKg: Math.max(0, Number(s.weightKg) || 0),
              })),
              restBetweenSetsSec: parseMMSS(restSet) ?? 60,
              targetSetSec: (parseMMSS(targetSet) ?? 0) || undefined,
            };
            onSave(saved);
          }}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

/* =========================
   Small Fields
========================= */

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "block" }}>
      {label}
      <input style={{ width: "100%" }} value={value} onChange={(e) => onChange(e.target.value)} placeholder="mm:ss" />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label style={{ display: "block" }}>
      {label}
      <input
        style={{ width: "100%" }}
        type="number"
        min={1}
        max={99}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/* =========================
   TIME Runner
========================= */

function Runner({
  card,
  prefs,
  onPrefsChange,
  onBack,
  profileId,
  profileName,
  onSaveLog,
}: {
  card: TimeCard;
  prefs: Prefs;
  onPrefsChange: (p: Prefs) => void;
  onBack: () => void;

  profileId: string;
  profileName: string;
  onSaveLog: (entry: WorkoutLogEntry) => void;
}) {
  const phases = useMemo(() => buildPhases(card), [card]);
  const total = useMemo(() => totalSessionSec(phases), [phases]);

  const [runner, setRunner] = useState<RunnerState>(() => ({
    status: "IDLE",
    phaseIndex: 0,
    remainingSec: phases[0]?.durationSec ?? 0,
    totalRemainingSec: total,
  }));

  const [savedEntry, setSavedEntry] = useState<WorkoutLogEntry | null>(null);

  useEffect(() => setSavedEntry(null), [card.id, profileId]);

  useEffect(() => {
    setRunner({
      status: "IDLE",
      phaseIndex: 0,
      remainingSec: phases[0]?.durationSec ?? 0,
      totalRemainingSec: total,
    });
  }, [card.id, total, phases]);

  useEffect(() => {
    if (runner.status !== "RUNNING") return;

    const id = window.setInterval(() => {
      setRunner((prev) => {
        if (prev.status !== "RUNNING") return prev;

        if (prev.remainingSec > 1) {
          const nextRem = prev.remainingSec - 1;
          return { ...prev, remainingSec: nextRem, totalRemainingSec: computeRemainingTotal(phases, prev.phaseIndex, nextRem) };
        }

        const nextIndex = prev.phaseIndex + 1;
        if (nextIndex >= phases.length) {
          return { ...prev, status: "FINISHED", remainingSec: 0, totalRemainingSec: 0 };
        }

        const nextRem = phases[nextIndex].durationSec;
        return { ...prev, phaseIndex: nextIndex, remainingSec: nextRem, totalRemainingSec: computeRemainingTotal(phases, nextIndex, nextRem) };
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [runner.status, phases]);

  const phase = phases[runner.phaseIndex];

  const lastPhaseRef = useRef<number>(-1);
  useEffect(() => {
    if (runner.status !== "RUNNING") return;
    if (runner.phaseIndex === lastPhaseRef.current) return;
    lastPhaseRef.current = runner.phaseIndex;

    if (prefs.sound) beepOnce(880, 120);
    if (prefs.vibration && "vibrate" in navigator) navigator.vibrate([80, 40, 80]);
  }, [runner.phaseIndex, runner.status, prefs.sound, prefs.vibration]);

  const lastCountdownRef = useRef<number | null>(null);
  useEffect(() => {
    if (runner.status !== "RUNNING") return;
    if (!prefs.countdownBeeps) return;

    if (runner.remainingSec <= 3 && runner.remainingSec >= 1) {
      if (lastCountdownRef.current !== runner.remainingSec) {
        lastCountdownRef.current = runner.remainingSec;
        if (prefs.sound) beepOnce(440, 80, 0.12);
      }
    } else {
      lastCountdownRef.current = null;
    }
  }, [runner.remainingSec, runner.status, prefs.countdownBeeps, prefs.sound]);

  function startPauseResume() {
    setRunner((prev) => {
      if (prev.status === "IDLE" || prev.status === "FINISHED") {
        const idx = 0;
        const rem = phases[0]?.durationSec ?? 0;
        return { status: "RUNNING", phaseIndex: idx, remainingSec: rem, totalRemainingSec: computeRemainingTotal(phases, idx, rem) };
      }
      if (prev.status === "RUNNING") return { ...prev, status: "PAUSED" };
      if (prev.status === "PAUSED") return { ...prev, status: "RUNNING" };
      return prev;
    });
  }

  function skip() {
    setRunner((prev) => {
      const nextIndex = prev.phaseIndex + 1;
      if (nextIndex >= phases.length) return { ...prev, status: "FINISHED", remainingSec: 0, totalRemainingSec: 0 };
      const nextRem = phases[nextIndex].durationSec;
      return { ...prev, status: "RUNNING", phaseIndex: nextIndex, remainingSec: nextRem, totalRemainingSec: computeRemainingTotal(phases, nextIndex, nextRem) };
    });
  }

  function stop() {
    setRunner({ status: "IDLE", phaseIndex: 0, remainingSec: phases[0]?.durationSec ?? 0, totalRemainingSec: total });
  }

  function saveToHistory() {
    if (savedEntry) return;
    const entry = makeTimeLogEntry(profileId, card, total);
    onSaveLog(entry);
    setSavedEntry(entry);
  }

  async function shareResult() {
    const entry = savedEntry ?? makeTimeLogEntry(profileId, card, total);
    if (!savedEntry) {
      onSaveLog(entry);
      setSavedEntry(entry);
    }

    const payload: SharePayload = { v: 1, type: "LOG", entry, profileName };
    const url = makeShareUrl(payload);

    await shareLink({
      title: "Interval Trainer – Ergebnis",
      text: `${profileName}: ${card.title} (${formatMMSS(total)})`,
      url,
    });
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Profil: <b>{profileName}</b>
      </div>
      <h3 style={{ marginTop: 6 }}>{card.title}</h3>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.8 }}>{phase.label}</div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{card.exercise.name}</div>

        <div style={{ fontSize: 44, fontWeight: 900, marginTop: 10 }}>{formatMMSS(runner.remainingSec)}</div>

        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          {phase.set > 0 ? (
            <>
              Satz {phase.set}/{card.timing.sets} · Wdh {phase.rep}/{card.timing.repsPerSet}
            </>
          ) : (
            <>—</>
          )}
        </div>

        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
          Gesamt verbleibend: {formatMMSS(runner.totalRemainingSec)}
          {" · "}Gesamt: {formatMMSS(total)}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={startPauseResume}>
            {runner.status === "RUNNING" ? "Pause" : runner.status === "PAUSED" ? "Weiter" : "Start"}
          </button>
          <button onClick={skip} disabled={runner.status === "IDLE"}>
            Skip
          </button>
          <button onClick={stop}>Stop</button>
          <button onClick={onBack}>Zurück</button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={prefs.sound} onChange={(e) => onPrefsChange({ ...prefs, sound: e.target.checked })} />
          Sound
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={prefs.vibration} onChange={(e) => onPrefsChange({ ...prefs, vibration: e.target.checked })} />
          Vibration (Android)
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={prefs.countdownBeeps}
            onChange={(e) => onPrefsChange({ ...prefs, countdownBeeps: e.target.checked })}
          />
          3‑2‑1 Beeps
        </label>
      </div>

      {runner.status === "FINISHED" && (
        <div style={{ marginTop: 12, background: "#e8ffe8", padding: 10, borderRadius: 10 }}>
          ✅ Fertig!
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!savedEntry ? (
              <button onClick={saveToHistory}>In Verlauf speichern</button>
            ) : (
              <span style={{ fontWeight: 700 }}>Gespeichert ✅</span>
            )}
            <button onClick={shareResult}>Ergebnis teilen</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   REPS Runner
========================= */

function RepRunner({
  card,
  onBack,
  profileId,
  profileName,
  onSaveLog,
}: {
  card: RepCard;
  onBack: () => void;

  profileId: string;
  profileName: string;
  onSaveLog: (entry: WorkoutLogEntry) => void;
}) {
  type Stage = "READY" | "SET" | "REST" | "DONE";
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<Stage>("READY");
  const [running, setRunning] = useState(false);
  const [t, setT] = useState(0);

  const [savedEntry, setSavedEntry] = useState<WorkoutLogEntry | null>(null);
  useEffect(() => setSavedEntry(null), [card.id, profileId]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setT((prev) => {
        if (stage === "REST") return Math.max(0, prev - 1);
        return prev + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, stage]);

  const current = card.sets[idx];
  const { totalReps, totalKg } = repTotals(card);

  function startWorkout() {
    setIdx(0);
    setStage("SET");
    setT(0);
    setRunning(true);
  }

  function stopSet() {
    setStage("REST");
    setT(card.restBetweenSetsSec);
    setRunning(true);
  }

  function goNextAfterRest() {
    if (idx >= card.sets.length - 1) {
      setRunning(false);
      setStage("DONE");
      return;
    }
    setIdx((i) => i + 1);
    setStage("SET");
    setT(0);
    setRunning(true);
  }

  useEffect(() => {
    if (stage === "REST" && running && t === 0) {
      goNextAfterRest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, stage, running]);

  const breakdown = repBreakdown(card);

  function saveToHistory() {
    if (savedEntry) return;
    const entry = makeRepLogEntry(profileId, card);
    onSaveLog(entry);
    setSavedEntry(entry);
  }

  async function shareResult() {
    const entry = savedEntry ?? makeRepLogEntry(profileId, card);
    if (!savedEntry) {
      onSaveLog(entry);
      setSavedEntry(entry);
    }

    const payload: SharePayload = { v: 1, type: "LOG", entry, profileName };
    const url = makeShareUrl(payload);

    await shareLink({
      title: "Interval Trainer – Ergebnis",
      text: `${profileName}: ${card.title} (${totalReps} Wdh, ${totalKg.toFixed(1)} kg)`,
      url,
    });
  }

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
      <button onClick={onBack}>← Zurück</button>

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Profil: <b>{profileName}</b>
      </div>
      <div style={{ fontWeight: 800, fontSize: 18 }}>{card.title}</div>

      <div style={{ fontSize: 13, opacity: 0.8 }}>
        Gesamt: {totalReps} Wdh · {totalKg.toFixed(1)} kg bewegt (Zusatzgewicht)
      </div>

      {stage === "READY" && <button onClick={startWorkout}>Start</button>}

      {stage === "SET" && current && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700 }}>
            Satz {idx + 1}/{card.sets.length}
          </div>

          <div style={{ marginTop: 6 }}>
            <b>{current.exercise || "—"}</b> · {current.reps} Wdh · {current.weightKg} kg Zusatzgewicht
          </div>

          <div style={{ marginTop: 10, fontSize: 28, fontVariantNumeric: "tabular-nums" }}>{formatMMSS(t)}</div>

          {card.targetSetSec ? <div style={{ fontSize: 13, opacity: 0.8 }}>Zielzeit: {formatMMSS(card.targetSetSec)}</div> : null}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={stopSet}>Stop (Satz fertig)</button>
          </div>
        </div>
      )}

      {stage === "REST" && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700 }}>Pause</div>

          <div style={{ marginTop: 10, fontSize: 28, fontVariantNumeric: "tabular-nums" }}>{formatMMSS(t)}</div>

          <button onClick={() => setT(0)} style={{ marginTop: 12 }}>
            Skip
          </button>
        </div>
      )}

      {stage === "DONE" && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800 }}>Fertig ✅</div>

          <div style={{ marginTop: 8 }}>
            Gesamt: <b>{totalReps}</b> Wdh · <b>{totalKg.toFixed(1)}</b> kg bewegt (Zusatzgewicht)
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
            {breakdown.map((b) => (
              <div key={b.exercise}>
                {b.exercise}: {b.reps} Wdh · {b.kg.toFixed(1)} kg
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {!savedEntry ? (
              <button onClick={saveToHistory}>In Verlauf speichern</button>
            ) : (
              <span style={{ fontWeight: 700 }}>Gespeichert ✅</span>
            )}
            <button onClick={shareResult}>Ergebnis teilen</button>
            <button onClick={startWorkout}>Nochmal</button>
            <button onClick={onBack}>Zurück</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================
   Profiles View
========================= */

function ProfilesView({
  profiles,
  activeProfileId,
  onSetActive,
  onAdd,
  onRename,
  onDelete,
  onBack,
}: {
  profiles: Profile[];
  activeProfileId: string;
  onSetActive: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const [newName, setNewName] = useState("");

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
      <button onClick={onBack}>← Zurück</button>

      <h3 style={{ marginTop: 0 }}>Profile</h3>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          placeholder="Neues Profil (z.B. Denis, Team A)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: "1 1 220px" }}
        />
        <button
          onClick={() => {
            onAdd(newName);
            setNewName("");
          }}
        >
          Hinzufügen
        </button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {profiles.map((p) => (
          <div key={p.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 800 }}>
              {p.name} {p.id === activeProfileId ? "✅" : ""}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Erstellt: {formatDateTime(p.createdAt)}</div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {p.id !== activeProfileId ? <button onClick={() => onSetActive(p.id)}>Aktiv setzen</button> : <button disabled>Aktiv</button>}

              <button
                onClick={() => {
                  const next = window.prompt("Neuer Name:", p.name);
                  if (next && next.trim()) onRename(p.id, next.trim());
                }}
              >
                Umbenennen
              </button>

              <button
                onClick={() => {
                  if (profiles.length <= 1) return;
                  if (!window.confirm("Profil löschen? (Verlauf bleibt gespeichert.)")) return;
                  onDelete(p.id);
                }}
                disabled={profiles.length <= 1}
              >
                Löschen
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Hinweis: Profile sind „Person oder Gruppe“. Du kannst Freunde als Profile anlegen und deren Ergebnisse per Link importieren.
      </div>
    </div>
  );
}

/* =========================
   History View
========================= */

function HistoryView({
  entries,
  profiles,
  activeProfileId,
  onChangeActiveProfile,
  profileName,
  onBack,
  onDeleteEntry,
  onClearActiveProfile,
  cards,
  prefs,
}: {
  entries: WorkoutLogEntry[];
  profiles: Profile[];
  activeProfileId: string;
  onChangeActiveProfile: (id: string) => void;
  profileName: (id: string) => string;
  onBack: () => void;
  onDeleteEntry: (id: string) => void;
  onClearActiveProfile: () => void;
  cards: IntervalCard[];
  prefs: Prefs;
}) {
  const filtered = useMemo(() => {
    return entries
      .filter((e) => e.profileId === activeProfileId)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [entries, activeProfileId]);

  const stats = useMemo(() => {
    const now = Date.now();
    const from = now - 7 * 24 * 60 * 60 * 1000;

    const last7 = filtered.filter((e) => e.createdAt >= from);

    const timeSec = last7.reduce((sum, e) => sum + (e.kind === "TIME" ? e.time?.plannedTotalSec ?? 0 : 0), 0);
    const repsTotal = last7.reduce((sum, e) => sum + (e.kind === "REPS" ? e.reps?.totalReps ?? 0 : 0), 0);
    const kgTotal = last7.reduce((sum, e) => sum + (e.kind === "REPS" ? e.reps?.totalKg ?? 0 : 0), 0);

    const bestKg = filtered.reduce((max, e) => Math.max(max, e.kind === "REPS" ? e.reps?.totalKg ?? 0 : 0), 0);

    return { count7: last7.length, timeSec, repsTotal, kgTotal, bestKg };
  }, [filtered]);

  type ExercisePR = {
    exercise: string;
    bestKg: number;
    bestKgAt: number;
    bestReps: number;
    bestRepsAt: number;
    bestAvgKg: number;
    bestAvgKgAt: number;
  };

  const prs = useMemo(() => {
    const map = new Map<string, ExercisePR>();

    for (const e of filtered) {
      if (e.kind !== "REPS") continue;
      const br = e.reps?.breakdown;
      if (!Array.isArray(br)) continue;

      for (const b of br) {
        const ex = (b.exercise || "—").trim() || "—";
        const kg = Number((b as any).kg) || 0;
        const reps = Number((b as any).reps) || 0;
        const avg = reps > 0 ? kg / reps : 0;

        const pr =
          map.get(ex) ??
          ({
            exercise: ex,
            bestKg: 0,
            bestKgAt: 0,
            bestReps: 0,
            bestRepsAt: 0,
            bestAvgKg: 0,
            bestAvgKgAt: 0,
          } as ExercisePR);

        if (kg > pr.bestKg) {
          pr.bestKg = kg;
          pr.bestKgAt = e.createdAt;
        }
        if (reps > pr.bestReps) {
          pr.bestReps = reps;
          pr.bestRepsAt = e.createdAt;
        }
        if (avg > pr.bestAvgKg) {
          pr.bestAvgKg = avg;
          pr.bestAvgKgAt = e.createdAt;
        }

        map.set(ex, pr);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.bestKg - a.bestKg || b.bestReps - a.bestReps);
  }, [filtered]);

  const hasRepsPRs = prs.length > 0;

  function exportBackupJSON() {
    const stamp = new Date().toISOString().slice(0, 10);
    const backup = {
      app: "interval-trainer",
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles,
      activeProfileId,
      cards,
      prefs,
      history: entries,
    };

    downloadTextFile(`interval-trainer-backup-${stamp}.json`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
  }

  function exportHistoryCSV() {
    const stamp = new Date().toISOString().slice(0, 10);
    const prof = safeFilePart(profileName(activeProfileId));

    const rows: any[][] = [];
    rows.push([
      "datetime_iso",
      "datetime_local",
      "profile",
      "kind",
      "title",
      "exercise",
      "planned_total_sec",
      "planned_total_mmss",
      "sets",
      "reps_per_set",
      "work_sec",
      "rest_between_sets_sec",
      "target_set_sec",
      "total_reps",
      "total_kg",
    ]);

    for (const e of filtered) {
      const iso = new Date(e.createdAt).toISOString();
      const local = formatDateTime(e.createdAt);
      const profName = profileName(e.profileId);

      if (e.kind === "TIME" && e.time) {
        const t = e.time;
        const totalReps = (t.sets ?? 0) * (t.repsPerSet ?? 0);

        rows.push([
          iso,
          local,
          profName,
          "TIME",
          e.cardTitle,
          t.exercise ?? "",
          t.plannedTotalSec ?? "",
          typeof t.plannedTotalSec === "number" ? formatMMSS(t.plannedTotalSec) : "",
          t.sets ?? "",
          t.repsPerSet ?? "",
          t.workSec ?? "",
          t.restBetweenSetsSec ?? "",
          "",
          totalReps,
          "",
        ]);
      } else if (e.kind === "REPS" && e.reps) {
        const r = e.reps;
        const names = Array.isArray(r.breakdown)
          ? Array.from(new Set(r.breakdown.map((x) => (x.exercise || "").trim()).filter(Boolean)))
          : [];
        const exerciseField = names.length === 1 ? names[0] : names.length > 1 ? "Multi" : "";

        rows.push([
          iso,
          local,
          profName,
          "REPS",
          e.cardTitle,
          exerciseField,
          "",
          "",
          r.setsCount ?? "",
          "",
          "",
          r.restBetweenSetsSec ?? "",
          r.targetSetSec ?? "",
          r.totalReps ?? "",
          typeof r.totalKg === "number" ? r.totalKg.toFixed(1) : "",
        ]);
      } else {
        rows.push([iso, local, profName, e.kind, e.cardTitle, "", "", "", "", "", "", "", "", "", ""]);
      }
    }

    const csv = toCSV(rows, ";");
    downloadTextFile(`interval-trainer-history-${prof}-${stamp}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportExercisesCSV() {
    const stamp = new Date().toISOString().slice(0, 10);
    const prof = safeFilePart(profileName(activeProfileId));

    const rows: any[][] = [];
    rows.push(["datetime_iso", "datetime_local", "profile", "title", "exercise", "reps", "kg"]);

    for (const e of filtered) {
      if (e.kind !== "REPS") continue;
      const br = e.reps?.breakdown;
      if (!Array.isArray(br)) continue;

      const iso = new Date(e.createdAt).toISOString();
      const local = formatDateTime(e.createdAt);
      const profName = profileName(e.profileId);

      for (const b of br) {
        rows.push([iso, local, profName, e.cardTitle, (b.exercise || "").trim(), b.reps ?? 0, typeof b.kg === "number" ? b.kg.toFixed(1) : b.kg ?? 0]);
      }
    }

    const csv = toCSV(rows, ";");
    downloadTextFile(`interval-trainer-exercises-${prof}-${stamp}.csv`, csv, "text/csv;charset=utf-8");
  }

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
      <button onClick={onBack}>← Zurück</button>

      <h3 style={{ marginTop: 0 }}>Verlauf</h3>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Profil:
          <select value={activeProfileId} onChange={(e) => onChangeActiveProfile(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <button onClick={exportBackupJSON}>Backup JSON</button>
        <button onClick={exportHistoryCSV} disabled={filtered.length === 0}>
          Export CSV (Sessions)
        </button>
        <button onClick={exportExercisesCSV} disabled={!hasRepsPRs}>
          Export CSV (Übungen)
        </button>

        <button onClick={onClearActiveProfile}>Verlauf löschen (Profil)</button>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800 }}>7‑Tage Übersicht ({profileName(activeProfileId)})</div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
          Sessions: <b>{stats.count7}</b>
          {" · "}Zeit geplant: <b>{formatMMSS(stats.timeSec)}</b>
          {" · "}Wdh: <b>{stats.repsTotal}</b>
          {" · "}kg bewegt (Zusatz): <b>{stats.kgTotal.toFixed(1)}</b>
        </div>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
          Bestwert (REPS): <b>{stats.bestKg.toFixed(1)}</b> kg bewegt in einer Session
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 800 }}>Bestwerte pro Übung (REPS – Zusatzgewicht)</div>

        {!hasRepsPRs ? (
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
            Noch keine REPS‑Einträge mit Übungs‑Breakdown gespeichert.
            <br />
            Tipp: Eine REPS‑Session beenden → <b>„In Verlauf speichern“</b>.
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
            {prs.slice(0, 20).map((pr) => (
              <div key={pr.exercise} style={{ borderTop: "1px dashed #ddd", paddingTop: 8 }}>
                <div style={{ fontWeight: 800 }}>{pr.exercise}</div>
                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
                  Best kg bewegt: <b>{pr.bestKg.toFixed(1)}</b> kg {pr.bestKgAt ? <span style={{ opacity: 0.7 }}>({formatDateTime(pr.bestKgAt)})</span> : null}
                  <br />
                  Best Wdh: <b>{pr.bestReps}</b> {pr.bestRepsAt ? <span style={{ opacity: 0.7 }}>({formatDateTime(pr.bestRepsAt)})</span> : null}
                  <br />
                  Best Ø Zusatzgewicht: <b>{pr.bestAvgKg.toFixed(1)}</b> kg/Wdh{" "}
                  {pr.bestAvgKgAt ? <span style={{ opacity: 0.7 }}>({formatDateTime(pr.bestAvgKgAt)})</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          Noch keine Einträge. Starte eine Session und klicke am Ende auf <b>„In Verlauf speichern“</b>.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((e) => (
            <div key={e.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{formatDateTime(e.createdAt)}</div>

              <div style={{ fontWeight: 800, marginTop: 4 }}>
                {e.kind === "TIME" ? "⏱️" : "🏋️"} {e.cardTitle}
              </div>

              {e.kind === "TIME" && e.time ? (
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                  Übung: <b>{e.time.exercise}</b> · Plan: <b>{formatMMSS(e.time.plannedTotalSec)}</b>
                  <br />
                  {e.time.sets} Sätze · {e.time.repsPerSet} Wdh/Satz · Arbeit {formatMMSS(e.time.workSec)}
                </div>
              ) : null}

              {e.kind === "REPS" && e.reps ? (
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                  {e.reps.setsCount} Sätze · <b>{e.reps.totalReps}</b> Wdh · <b>{e.reps.totalKg.toFixed(1)}</b> kg bewegt (Zusatzgewicht)
                </div>
              ) : null}

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    if (!window.confirm("Eintrag löschen?")) return;
                    onDeleteEntry(e.id);
                  }}
                >
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Hinweis: „kg bewegt“ = Σ(Wdh × Zusatzgewicht). CSV nutzt <b>;</b> als Trennzeichen.
      </div>
    </div>
  );
}

/* =========================
   Ranking View (Wettbewerb)
========================= */

function RankingView({
  entries,
  profiles,
  onBack,
}: {
  entries: WorkoutLogEntry[];
  profiles: Profile[];
  onBack: () => void;
}) {
  type RangeKey = "7D" | "30D" | "ALL";
  const [range, setRange] = useState<RangeKey>("7D");

  const fromTs = useMemo(() => {
    const now = Date.now();
    if (range === "7D") return now - 7 * 24 * 60 * 60 * 1000;
    if (range === "30D") return now - 30 * 24 * 60 * 60 * 1000;
    return 0;
  }, [range]);

  const filtered = useMemo(() => {
    if (range === "ALL") return entries;
    return entries.filter((e) => e.createdAt >= fromTs);
  }, [entries, range, fromTs]);

  type Row = {
    profileId: string;
    name: string;
    sessions: number;
    timeSec: number;
    totalReps: number;
    totalKg: number;
  };

  const rows = useMemo(() => {
    const map = new Map<string, Row>();

    for (const p of profiles) {
      map.set(p.id, { profileId: p.id, name: p.name, sessions: 0, timeSec: 0, totalReps: 0, totalKg: 0 });
    }

    for (const e of filtered) {
      const r = map.get(e.profileId);
      if (!r) continue;

      r.sessions += 1;

      if (e.kind === "TIME" && e.time) {
        r.timeSec += e.time.plannedTotalSec ?? 0;
      }
      if (e.kind === "REPS" && e.reps) {
        r.totalReps += e.reps.totalReps ?? 0;
        r.totalKg += e.reps.totalKg ?? 0;
      }
    }

    return Array.from(map.values());
  }, [filtered, profiles]);

  const topKg = useMemo(() => rows.slice().sort((a, b) => b.totalKg - a.totalKg || b.sessions - a.sessions), [rows]);
  const topReps = useMemo(() => rows.slice().sort((a, b) => b.totalReps - a.totalReps || b.sessions - a.sessions), [rows]);
  const topTime = useMemo(() => rows.slice().sort((a, b) => b.timeSec - a.timeSec || b.sessions - a.sessions), [rows]);
  const topSessions = useMemo(() => rows.slice().sort((a, b) => b.sessions - a.sessions || b.totalKg - a.totalKg), [rows]);

  async function nudgeText(msg: string) {
    await shareLink({
      title: "Interval Trainer – Push",
      text: msg,
      url: `${window.location.origin}${window.location.pathname}`,
    });
  }

  function rangeLabel() {
    if (range === "7D") return "7 Tage";
    if (range === "30D") return "30 Tage";
    return "All‑Time";
  }

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
      <button onClick={onBack}>← Zurück</button>

      <h3 style={{ marginTop: 0 }}>Ranking</h3>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, opacity: 0.8 }}>Zeitraum:</span>
        <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          <option value="7D">7 Tage</option>
          <option value="30D">30 Tage</option>
          <option value="ALL">All‑Time</option>
        </select>

        <button
          onClick={() =>
            nudgeText(`🏁 Ranking (${rangeLabel()}): Wer ist diese Woche #1? 😄\nÖffne die App und teile eine Challenge!`)
          }
        >
          Push senden
        </button>
      </div>

      <Leaderboard
        title={`🏋️ kg bewegt (Zusatzgewicht) – ${rangeLabel()}`}
        rows={topKg}
        value={(r) => `${r.totalKg.toFixed(1)} kg`}
      />
      <Leaderboard title={`🔢 Wiederholungen – ${rangeLabel()}`} rows={topReps} value={(r) => `${r.totalReps} Wdh`} />
      <Leaderboard title={`⏱️ Zeit (geplant) – ${rangeLabel()}`} rows={topTime} value={(r) => `${formatMMSS(r.timeSec)}`} />
      <Leaderboard title={`✅ Sessions – ${rangeLabel()}`} rows={topSessions} value={(r) => `${r.sessions}`} />

      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Tipp: Importiere Ergebnisse von Freunden über „Ergebnis teilen“ → Link öffnen → Import bestätigen. Danach erscheinen sie im Ranking.
      </div>
    </div>
  );
}

function Leaderboard({
  title,
  rows,
  value,
}: {
  title: string;
  rows: { profileId: string; name: string }[];
  value: (r: any) => string;
}) {
  const top = rows.slice(0, 10);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
      <div style={{ fontWeight: 800 }}>{title}</div>

      {top.length === 0 ? (
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>Noch keine Daten.</div>
      ) : (
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          {top.map((r, i) => (
            <div key={r.profileId} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 700 }}>
                {i + 1}. {r.name}
              </div>
              <div style={{ fontVariantNumeric: "tabular-nums" }}>{value(r)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
