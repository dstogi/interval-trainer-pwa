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
  // optional, damit alte gespeicherte Cards (ohne kind) weiterhin funktionieren:
  kind?: "TIME";
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
  weightKg: number;
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

type Phase = {
  type: PhaseType;
  label: string;
  restKind: RestKind;
  durationSec: number;
  set: number; // 1..sets, or 0 for warmup/cooldown
  rep: number; // 1..reps, or 0 for warmup/cooldown
};

type Prefs = {
  sound: boolean;
  vibration: boolean;
  countdownBeeps: boolean;
};

type Screen =
  | { name: "HOME" }
  | { name: "EDIT"; id?: string; kind?: CardKind }
  | { name: "RUN"; id: string };

type RunnerState = {
  status: RunStatus;
  phaseIndex: number;
  remainingSec: number;
  totalRemainingSec: number;
};

/* =========================
   Storage / Helpers
========================= */

const CARDS_KEY = "interval_trainer_cards_v1";
const PREFS_KEY = "interval_trainer_prefs_v1";

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

/**
 * parseMMSS: wie parseTimeToSec, aber gibt null zurück wenn leer
 * -> praktisch für optional Felder (z.B. Zielzeit im RepEditor)
 */
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

/* =========================
   TIME: Phasen bauen
   WICHTIG: nur für TimeCard!
========================= */

function buildPhases(card: TimeCard): Phase[] {
  const t = card.timing;
  const sets = Math.max(1, t.sets);
  const reps = Math.max(1, t.repsPerSet);

  const phases: Phase[] = [];

  if (t.warmupSec > 0) {
    phases.push({
      type: "WARMUP",
      label: "WARMUP",
      restKind: null,
      durationSec: t.warmupSec,
      set: 0,
      rep: 0,
    });
  }

  for (let s = 1; s <= sets; s++) {
    for (let r = 1; r <= reps; r++) {
      if (t.workSec > 0) {
        phases.push({
          type: "WORK",
          label: "ARBEIT",
          restKind: null,
          durationSec: t.workSec,
          set: s,
          rep: r,
        });
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
    phases.push({
      type: "COOLDOWN",
      label: "COOLDOWN",
      restKind: null,
      durationSec: t.cooldownSec,
      set: 0,
      rep: 0,
    });
  }

  if (phases.length === 0) {
    phases.push({
      type: "WORK",
      label: "ARBEIT",
      restKind: null,
      durationSec: 20,
      set: 1,
      rep: 1,
    });
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
    return parsed
      .map((x) => normalizeLoadedCard(x))
      .filter((x): x is IntervalCard => Boolean(x));
  } catch {
    return [];
  }
}

function saveCards(cards: IntervalCard[]) {
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

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
   Sample / Random
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
   App
========================= */

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  const [cards, setCards] = useState<IntervalCard[]>(() => {
    const loaded = loadCards();
    return loaded.length ? loaded : [makeSampleCard()];
  });

  const [screen, setScreen] = useState<Screen>({ name: "HOME" });

  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => saveCards(cards), [cards]);

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

  return (
    <div className="app-shell">
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Interval Trainer</h2>

        {screen.name === "HOME" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                // REPS
                if (isRepCard(card)) {
                  const { totalReps, totalKg } = repTotals(card);

                  return (
                    <div key={card.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                      <div style={{ fontWeight: 700 }}>{card.title}</div>

                      <div style={{ fontSize: 13, marginTop: 6 }}>
                        {card.sets.length} Sätze · {totalReps} Wdh gesamt · {totalKg.toFixed(1)} kg bewegt
                        {" · "}Pause {formatMMSS(card.restBetweenSetsSec)}
                        {card.targetSetSec ? ` · Zielzeit/Satz ${formatMMSS(card.targetSetSec)}` : ""}
                      </div>

                      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                        <button onClick={() => setScreen({ name: "RUN", id: card.id })}>Start</button>
                        <button onClick={() => setScreen({ name: "EDIT", id: card.id })}>Bearbeiten</button>
                        <button onClick={() => duplicateCard(card.id)}>Duplizieren</button>
                        <button onClick={() => deleteCard(card.id)}>Löschen</button>
                      </div>
                    </div>
                  );
                }

                // TIME
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
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>
              Tipp fürs iPhone: Safari → Share → <b>Zum Home‑Bildschirm</b>.
            </div>
          </>
        )}

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

        {screen.name === "RUN" && activeCard && (
          isRepCard(activeCard) ? (
            <RepRunner card={activeCard} onBack={() => setScreen({ name: "HOME" })} />
          ) : (
            <Runner
              card={activeCard}
              prefs={prefs}
              onPrefsChange={setPrefs}
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

    if (!title.trim()) {
      setError("Bitte einen Titel eingeben.");
      return;
    }
    if (!exercise.trim()) {
      setError("Bitte eine Übung eingeben (z.B. Liegestütze).");
      return;
    }
    if (timing.workSec <= 0) {
      setError("Arbeitszeit muss > 0 sein.");
      return;
    }

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
              style={{ width: 110 }}
              title="kg"
            />

            <button onClick={() => removeSet(s.id)}>✕</button>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, opacity: 0.8 }}>
        Gesamt: <b>{totalReps}</b> Wdh · <b>{totalKg.toFixed(1)}</b> kg bewegt
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
}: {
  card: TimeCard;
  prefs: Prefs;
  onPrefsChange: (p: Prefs) => void;
  onBack: () => void;
}) {
  const phases = useMemo(() => buildPhases(card), [card]);
  const total = useMemo(() => totalSessionSec(phases), [phases]);

  const [runner, setRunner] = useState<RunnerState>(() => ({
    status: "IDLE",
    phaseIndex: 0,
    remainingSec: phases[0]?.durationSec ?? 0,
    totalRemainingSec: total,
  }));

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
          return {
            ...prev,
            remainingSec: nextRem,
            totalRemainingSec: computeRemainingTotal(phases, prev.phaseIndex, nextRem),
          };
        }

        const nextIndex = prev.phaseIndex + 1;
        if (nextIndex >= phases.length) {
          return { ...prev, status: "FINISHED", remainingSec: 0, totalRemainingSec: 0 };
        }

        const nextRem = phases[nextIndex].durationSec;
        return {
          ...prev,
          phaseIndex: nextIndex,
          remainingSec: nextRem,
          totalRemainingSec: computeRemainingTotal(phases, nextIndex, nextRem),
        };
      });
    }, 1000);

    return () => window.clearInterval(id);
  }, [runner.status, runner.phaseIndex, phases]);

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
        return {
          status: "RUNNING",
          phaseIndex: idx,
          remainingSec: rem,
          totalRemainingSec: computeRemainingTotal(phases, idx, rem),
        };
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
      return {
        ...prev,
        status: "RUNNING",
        phaseIndex: nextIndex,
        remainingSec: nextRem,
        totalRemainingSec: computeRemainingTotal(phases, nextIndex, nextRem),
      };
    });
  }

  function stop() {
    setRunner({
      status: "IDLE",
      phaseIndex: 0,
      remainingSec: phases[0]?.durationSec ?? 0,
      totalRemainingSec: total,
    });
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{card.title}</h3>

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
          <input
            type="checkbox"
            checked={prefs.sound}
            onChange={(e) => onPrefsChange({ ...prefs, sound: e.target.checked })}
          />
          Sound
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={prefs.vibration}
            onChange={(e) => onPrefsChange({ ...prefs, vibration: e.target.checked })}
          />
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
}: {
  card: RepCard;
  onBack: () => void;
}) {
  type Stage = "READY" | "SET" | "REST" | "DONE";
  const [idx, setIdx] = useState(0);
  const [stage, setStage] = useState<Stage>("READY");
  const [running, setRunning] = useState(false);
  const [t, setT] = useState(0);

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

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
      <button onClick={onBack}>← Zurück</button>

      <div style={{ fontWeight: 800, fontSize: 18 }}>{card.title}</div>
      <div style={{ fontSize: 13, opacity: 0.8 }}>
        Gesamt: {totalReps} Wdh · {totalKg.toFixed(1)} kg bewegt
      </div>

      {stage === "READY" && <button onClick={startWorkout}>Start</button>}

      {stage === "SET" && current && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700 }}>
            Satz {idx + 1}/{card.sets.length}
          </div>

          <div style={{ marginTop: 6 }}>
            <b>{current.exercise || "—"}</b> · {current.reps} Wdh · {current.weightKg} kg
          </div>

          <div style={{ marginTop: 10, fontSize: 28, fontVariantNumeric: "tabular-nums" }}>
            {formatMMSS(t)}
          </div>

          {card.targetSetSec ? (
            <div style={{ fontSize: 13, opacity: 0.8 }}>Zielzeit: {formatMMSS(card.targetSetSec)}</div>
          ) : null}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={stopSet}>Stop (Satz fertig)</button>
          </div>
        </div>
      )}

      {stage === "REST" && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700 }}>Pause</div>

          <div style={{ marginTop: 10, fontSize: 28, fontVariantNumeric: "tabular-nums" }}>
            {formatMMSS(t)}
          </div>

          <button onClick={() => setT(0)} style={{ marginTop: 12 }}>
            Skip
          </button>
        </div>
      )}

      {stage === "DONE" && (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800 }}>Fertig ✅</div>

          <div style={{ marginTop: 8 }}>
            Gesamt: <b>{totalReps}</b> Wdh · <b>{totalKg.toFixed(1)}</b> kg bewegt
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.85 }}>
            {breakdown.map((b) => (
              <div key={b.exercise}>
                {b.exercise}: {b.reps} Wdh · {b.kg.toFixed(1)} kg
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={startWorkout}>Nochmal</button>
            <button onClick={onBack}>Zurück</button>
          </div>
        </div>
      )}
    </div>
  );
}
