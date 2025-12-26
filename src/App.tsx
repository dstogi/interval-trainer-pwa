import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

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

type IntervalCard = {
  id: string;
  title: string;
  exercise: Exercise;
  timing: TimingConfig;
  createdAt: number;
  updatedAt: number;
};

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

const CARDS_KEY = "interval_trainer_cards_v1";
const PREFS_KEY = "interval_trainer_prefs_v1";

function makeId(): string {
  try {
    // modern browsers
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

function formatMMSS(totalSec: number): string {
  const sec = Math.max(0, Math.trunc(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function buildPhases(card: IntervalCard): Phase[] {
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

      // Pause zwischen Wiederholungen (außer nach letzter Wdh im Satz)
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

    // Satzpause (außer nach letztem Satz)
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

  // Falls alles 0 war: Notfall-Phase, damit Runner nicht crasht
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

function loadCards(): IntervalCard[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as IntervalCard[];
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

function makeSampleCard(): IntervalCard {
  const now = Date.now();
  return {
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

function makeRandomCard(): IntervalCard {
  const exercises = ["Liegestütze", "Kniebeugen", "Mountain Climbers", "Burpees", "Plank", "Ausfallschritte"];
  const name = exercises[Math.floor(Math.random() * exercises.length)];
  const sets = clampInt(3 + Math.floor(Math.random() * 4), 2, 8); // 3..6
  const work = [20, 30, 40][Math.floor(Math.random() * 3)];
  const restSet = [30, 45, 60][Math.floor(Math.random() * 3)];
  const now = Date.now();
  return {
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

type Screen =
  | { name: "HOME" }
  | { name: "EDIT"; id?: string }
  | { name: "RUN"; id: string };

type RunnerState = {
  status: RunStatus;
  phaseIndex: number;
  remainingSec: number;
  totalRemainingSec: number;
};

function beepOnce(freq: number, ms: number, volume = 0.2) {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctx) return;

  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  // soft envelope
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + ms / 1000);

  // close context after beep
  setTimeout(() => {
    ctx.close().catch(() => {});
  }, ms + 50);
}

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
    const copy: IntervalCard = {
      ...original,
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
            <button onClick={() => setScreen({ name: "EDIT" })}>+ Neue Karte</button>
            <button
              onClick={() => {
                const c = makeRandomCard();
                upsertCard(c);
              }}
            >
              🎲 Zufalls‑Session
            </button>
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
            {cards.map((card) => {
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

      {screen.name === "EDIT" && (
        <Editor
          initial={activeCard}
          onCancel={() => setScreen({ name: "HOME" })}
          onSave={(saved) => {
            upsertCard(saved);
            setScreen({ name: "HOME" });
          }}
        />
      )}

      {screen.name === "RUN" && activeCard && (
        <Runner
          card={activeCard}
          prefs={prefs}
          onPrefsChange={setPrefs}
          onBack={() => setScreen({ name: "HOME" })}
        />
      )}
    </div>
  </div>
);
}
function Editor({
  initial,
  onCancel,
  onSave,
}: {
  initial: IntervalCard | null;
  onCancel: () => void;
  onSave: (card: IntervalCard) => void;
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
    const saved: IntervalCard = {
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
      <h3 style={{ marginTop: 0 }}>{initial ? "Karte bearbeiten" : "Neue Karte"}</h3>

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

function Runner({
  card,
  prefs,
  onPrefsChange,
  onBack,
}: {
  card: IntervalCard;
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

  // Reset when card changes
  useEffect(() => {
    setRunner({
      status: "IDLE",
      phaseIndex: 0,
      remainingSec: phases[0]?.durationSec ?? 0,
      totalRemainingSec: total,
    });
  }, [card.id, total, phases]);

  // Tick each second while running
  useEffect(() => {
    if (runner.status !== "RUNNING") return;

    const id = window.setInterval(() => {
      setRunner((prev) => {
        if (prev.status !== "RUNNING") return prev;

        // count down
        if (prev.remainingSec > 1) {
          const nextRem = prev.remainingSec - 1;
          return {
            ...prev,
            remainingSec: nextRem,
            totalRemainingSec: computeRemainingTotal(phases, prev.phaseIndex, nextRem),
          };
        }

        // move to next phase
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

  // Cues (beep/vibrate) on phase change
  const lastPhaseRef = useRef<number>(-1);
  useEffect(() => {
    if (runner.status !== "RUNNING") return;
    if (runner.phaseIndex === lastPhaseRef.current) return;
    lastPhaseRef.current = runner.phaseIndex;

    if (prefs.sound) beepOnce(880, 120);
    if (prefs.vibration && "vibrate" in navigator) navigator.vibrate([80, 40, 80]);
  }, [runner.phaseIndex, runner.status, prefs.sound, prefs.vibration]);

  // Countdown beeps (last 3 seconds)
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
