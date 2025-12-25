import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type PhaseType = 'WARMUP' | 'WORK' | 'REST' | 'COOLDOWN'
type RunStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'FINISHED'

type IntervalCard = {
  id: string
  title: string
  exercise: string
  notes: string

  warmupSec: number
  workSec: number
  restBetweenRepsSec: number
  repsPerSet: number
  restBetweenSetsSec: number
  sets: number
  cooldownSec: number

  createdAt: number
  updatedAt: number
}

type Step = {
  phase: PhaseType
  durationSec: number
  label: string
  setIndex?: number // 1-based
  repIndex?: number // 1-based
}

const STORAGE_KEY = 'interval_trainer_cards_v1'

function newId(): string {
  // Modern browsers:
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function parseDuration(input: string): number | null {
  const s = input.trim()
  if (!s) return 0
  if (s.includes(':')) {
    const parts = s.split(':').map(p => p.trim())
    if (parts.some(p => p === '')) return null
    const nums = parts.map(p => Number(p))
    if (nums.some(n => !Number.isFinite(n) || n < 0)) return null

    // support mm:ss or hh:mm:ss
    if (nums.length === 2) {
      const [mm, ss] = nums
      return clampInt(mm * 60 + ss, 0, 24 * 3600)
    }
    if (nums.length === 3) {
      const [hh, mm, ss] = nums
      return clampInt(hh * 3600 + mm * 60 + ss, 0, 24 * 3600)
    }
    return null
  }

  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return clampInt(n, 0, 24 * 3600)
}

function formatMMSS(totalSec: number): string {
  const sec = Math.max(0, Math.trunc(totalSec))
  const mm = Math.floor(sec / 60)
  const ss = sec % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function phaseLabel(phase: PhaseType): string {
  switch (phase) {
    case 'WARMUP':
      return 'WARMUP'
    case 'WORK':
      return 'ARBEIT'
    case 'REST':
      return 'PAUSE'
    case 'COOLDOWN':
      return 'COOLDOWN'
  }
}

function buildPlan(card: IntervalCard): Step[] {
  const steps: Step[] = []

  if (card.warmupSec > 0) {
    steps.push({ phase: 'WARMUP', durationSec: card.warmupSec, label: 'Aufwärmen' })
  }

  for (let set = 1; set <= card.sets; set++) {
    for (let rep = 1; rep <= card.repsPerSet; rep++) {
      // WORK
      steps.push({
        phase: 'WORK',
        durationSec: card.workSec,
        label: card.exercise || 'Übung',
        setIndex: set,
        repIndex: rep
      })

      // REST between reps (only if there is another rep in the same set)
      const hasNextRep = rep < card.repsPerSet
      if (hasNextRep && card.restBetweenRepsSec > 0) {
        steps.push({
          phase: 'REST',
          durationSec: card.restBetweenRepsSec,
          label: 'Pause (Wdh)',
          setIndex: set,
          repIndex: rep
        })
      }
    }

    // REST between sets (only if there is another set)
    const hasNextSet = set < card.sets
    if (hasNextSet && card.restBetweenSetsSec > 0) {
      steps.push({
        phase: 'REST',
        durationSec: card.restBetweenSetsSec,
        label: 'Satzpause',
        setIndex: set
      })
    }
  }

  if (card.cooldownSec > 0) {
    steps.push({ phase: 'COOLDOWN', durationSec: card.cooldownSec, label: 'Cooldown' })
  }

  // Filter out any zero-duration steps just in case
  return steps.filter(s => s.durationSec > 0)
}

function totalFromPlan(plan: Step[]): number {
  return plan.reduce((sum, s) => sum + s.durationSec, 0)
}

function sampleCard(): IntervalCard {
  const now = Date.now()
  return {
    id: newId(),
    title: 'HIIT Kurz',
    exercise: 'Liegestütze',
    notes: '',
    warmupSec: 0,
    workSec: 20,
    restBetweenRepsSec: 0,
    repsPerSet: 1,
    restBetweenSetsSec: 60,
    sets: 4,
    cooldownSec: 0,
    createdAt: now,
    updatedAt: now
  }
}

function randomCard(): IntervalCard {
  const exercises = [
    'Liegestütze',
    'Kniebeugen',
    'Burpees',
    'Mountain Climbers',
    'Plank',
    'Jumping Jacks',
    'High Knees'
  ]

  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
  const now = Date.now()

  // Two classic presets, chosen randomly
  const preset = Math.random() < 0.5 ? 'TABATA' : 'HIIT'

  if (preset === 'TABATA') {
    return {
      id: newId(),
      title: 'Tabata',
      exercise: pick(exercises),
      notes: '8 Runden',
      warmupSec: 0,
      workSec: 20,
      restBetweenRepsSec: 0,
      repsPerSet: 1,
      restBetweenSetsSec: 10,
      sets: 8,
      cooldownSec: 0,
      createdAt: now,
      updatedAt: now
    }
  }

  const work = [20, 30, 40, 45][Math.floor(Math.random() * 4)]
  const rest = [30, 45, 60, 75][Math.floor(Math.random() * 4)]
  const sets = [4, 5, 6, 7][Math.floor(Math.random() * 4)]

  return {
    id: newId(),
    title: 'HIIT Random',
    exercise: pick(exercises),
    notes: '',
    warmupSec: 0,
    workSec: work,
    restBetweenRepsSec: 0,
    repsPerSet: 1,
    restBetweenSetsSec: rest,
    sets,
    cooldownSec: 0,
    createdAt: now,
    updatedAt: now
  }
}

function loadCards(): IntervalCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [sampleCard()]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [sampleCard()]
    const cards = parsed
      .map((x: any) => {
        if (!x || typeof x !== 'object') return null
        const c: IntervalCard = {
          id: String(x.id ?? newId()),
          title: String(x.title ?? 'Training'),
          exercise: String(x.exercise ?? ''),
          notes: String(x.notes ?? ''),
          warmupSec: clampInt(Number(x.warmupSec ?? 0), 0, 24 * 3600),
          workSec: clampInt(Number(x.workSec ?? 20), 1, 24 * 3600),
          restBetweenRepsSec: clampInt(Number(x.restBetweenRepsSec ?? 0), 0, 24 * 3600),
          repsPerSet: clampInt(Number(x.repsPerSet ?? 1), 1, 999),
          restBetweenSetsSec: clampInt(Number(x.restBetweenSetsSec ?? 0), 0, 24 * 3600),
          sets: clampInt(Number(x.sets ?? 1), 1, 999),
          cooldownSec: clampInt(Number(x.cooldownSec ?? 0), 0, 24 * 3600),
          createdAt: clampInt(Number(x.createdAt ?? Date.now()), 0, Number.MAX_SAFE_INTEGER),
          updatedAt: clampInt(Number(x.updatedAt ?? Date.now()), 0, Number.MAX_SAFE_INTEGER)
        }
        return c
      })
      .filter(Boolean) as IntervalCard[]

    return cards.length ? cards : [sampleCard()]
  } catch {
    return [sampleCard()]
  }
}

function saveCards(cards: IntervalCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards))
}

type Screen =
  | { name: 'home' }
  | { name: 'edit'; cardId: string | null } // null => new
  | { name: 'run'; cardId: string }

export default function App() {
  const [cards, setCards] = useState<IntervalCard[]>(() => loadCards())
  const [screen, setScreen] = useState<Screen>({ name: 'home' })

  useEffect(() => {
    saveCards(cards)
  }, [cards])

  const currentCard =
    screen.name === 'edit'
      ? screen.cardId
        ? cards.find(c => c.id === screen.cardId) ?? null
        : null
      : screen.name === 'run'
        ? cards.find(c => c.id === screen.cardId) ?? null
        : null

  function upsertCard(card: IntervalCard) {
    setCards(prev => {
      const idx = prev.findIndex(c => c.id === card.id)
      const next = [...prev]
      if (idx >= 0) next[idx] = card
      else next.unshift(card)
      return next
    })
  }

  function deleteCard(cardId: string) {
    setCards(prev => prev.filter(c => c.id !== cardId))
  }

  function duplicateCard(cardId: string) {
    const c = cards.find(x => x.id === cardId)
    if (!c) return
    const now = Date.now()
    const copy: IntervalCard = {
      ...c,
      id: newId(),
      title: c.title + ' (Kopie)',
      createdAt: now,
      updatedAt: now
    }
    setCards(prev => [copy, ...prev])
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="topbarTitle">Interval Trainer</div>
        <div className="topbarRight">
          {screen.name !== 'home' && (
            <button className="btn ghost" onClick={() => setScreen({ name: 'home' })}>
              Zurück
            </button>
          )}
        </div>
      </header>

      <main className="content">
        {screen.name === 'home' && (
          <HomeView
            cards={cards}
            onNew={() => setScreen({ name: 'edit', cardId: null })}
            onEdit={(id) => setScreen({ name: 'edit', cardId: id })}
            onStart={(id) => setScreen({ name: 'run', cardId: id })}
            onDelete={(id) => {
              const c = cards.find(x => x.id === id)
              const ok = window.confirm(`Karte löschen?\n\n${c?.title ?? ''}`)
              if (ok) deleteCard(id)
            }}
            onDuplicate={(id) => duplicateCard(id)}
            onRandom={() => {
              const c = randomCard()
              upsertCard(c)
              setScreen({ name: 'edit', cardId: c.id })
            }}
          />
        )}

        {screen.name === 'edit' && (
          <EditorView
            existing={currentCard}
            onCancel={() => setScreen({ name: 'home' })}
            onSave={(saved) => {
              upsertCard(saved)
              setScreen({ name: 'home' })
            }}
          />
        )}

        {screen.name === 'run' && currentCard && (
          <RunnerView
            card={currentCard}
            onEdit={() => setScreen({ name: 'edit', cardId: currentCard.id })}
            onBack={() => setScreen({ name: 'home' })}
          />
        )}

        {screen.name === 'run' && !currentCard && (
          <div className="card">
            <h2>Fehler</h2>
            <p>Karte nicht gefunden.</p>
            <button className="btn" onClick={() => setScreen({ name: 'home' })}>
              Zurück
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function HomeView(props: {
  cards: IntervalCard[]
  onNew: () => void
  onRandom: () => void
  onEdit: (id: string) => void
  onStart: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
}) {
  return (
    <div className="stack">
      <div className="row between wrap">
        <h1 className="h1">Deine Karten</h1>
        <div className="row gap">
          <button className="btn ghost" onClick={props.onRandom} title="Erstellt eine zufällige Session">
            🎲 Zufall
          </button>
          <button className="btn" onClick={props.onNew}>
            + Neu
          </button>
        </div>
      </div>

      {props.cards.length === 0 && (
        <div className="card">
          <p>Noch keine Karten. Erstelle eine neue.</p>
        </div>
      )}

      {props.cards.map(card => {
        const plan = buildPlan(card)
        const total = totalFromPlan(plan)

        return (
          <div className="card" key={card.id}>
            <div className="row between">
              <div>
                <div className="title">{card.title}</div>
                <div className="sub">{card.exercise ? `Übung: ${card.exercise}` : 'Übung: (leer)'}</div>
              </div>
              <div className="pill">{formatMMSS(total)}</div>
            </div>

            <div className="meta">
              <div>Arbeit: <b>{formatMMSS(card.workSec)}</b></div>
              <div>Sätze: <b>{card.sets}</b> · Wdh/Satz: <b>{card.repsPerSet}</b></div>
              <div>Pause Wdh: <b>{formatMMSS(card.restBetweenRepsSec)}</b> · Satzpause: <b>{formatMMSS(card.restBetweenSetsSec)}</b></div>
              <div>Warmup: <b>{formatMMSS(card.warmupSec)}</b> · Cooldown: <b>{formatMMSS(card.cooldownSec)}</b></div>
            </div>

            <div className="row gap wrap">
              <button className="btn" onClick={() => props.onStart(card.id)}>
                Start
              </button>
              <button className="btn ghost" onClick={() => props.onEdit(card.id)}>
                Bearbeiten
              </button>
              <button className="btn ghost" onClick={() => props.onDuplicate(card.id)}>
                Duplizieren
              </button>
              <button className="btn danger" onClick={() => props.onDelete(card.id)}>
                Löschen
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EditorView(props: {
  existing: IntervalCard | null
  onCancel: () => void
  onSave: (card: IntervalCard) => void
}) {
  const existing = props.existing
  const now = Date.now()

  const [title, setTitle] = useState(existing?.title ?? 'Neue Karte')
  const [exercise, setExercise] = useState(existing?.exercise ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')

  const [warmup, setWarmup] = useState(formatMMSS(existing?.warmupSec ?? 0))
  const [work, setWork] = useState(formatMMSS(existing?.workSec ?? 20))
  const [restRep, setRestRep] = useState(formatMMSS(existing?.restBetweenRepsSec ?? 0))
  const [repsPerSet, setRepsPerSet] = useState<number>(existing?.repsPerSet ?? 1)
  const [restSet, setRestSet] = useState(formatMMSS(existing?.restBetweenSetsSec ?? 60))
  const [sets, setSets] = useState<number>(existing?.sets ?? 4)
  const [cooldown, setCooldown] = useState(formatMMSS(existing?.cooldownSec ?? 0))

  const [error, setError] = useState<string>('')

  const previewTotal = useMemo(() => {
    const w = parseDuration(work)
    if (w === null || w <= 0) return null
    const card: IntervalCard = {
      id: existing?.id ?? 'preview',
      title,
      exercise,
      notes,
      warmupSec: parseDuration(warmup) ?? 0,
      workSec: w,
      restBetweenRepsSec: parseDuration(restRep) ?? 0,
      repsPerSet: clampInt(repsPerSet, 1, 999),
      restBetweenSetsSec: parseDuration(restSet) ?? 0,
      sets: clampInt(sets, 1, 999),
      cooldownSec: parseDuration(cooldown) ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    return totalFromPlan(buildPlan(card))
  }, [title, exercise, notes, warmup, work, restRep, repsPerSet, restSet, sets, cooldown, existing, now])

  function onSave() {
    setError('')

    const warm = parseDuration(warmup)
    const wo = parseDuration(work)
    const rr = parseDuration(restRep)
    const rs = parseDuration(restSet)
    const cool = parseDuration(cooldown)

    if (warm === null) return setError('Warmup ist ungültig. Nutze mm:ss oder Sekunden.')
    if (wo === null || wo <= 0) return setError('Arbeit muss > 0 sein (mm:ss oder Sekunden).')
    if (rr === null) return setError('Pause (Wdh) ist ungültig.')
    if (rs === null) return setError('Satzpause ist ungültig.')
    if (cool === null) return setError('Cooldown ist ungültig.')

    const card: IntervalCard = {
      id: existing?.id ?? newId(),
      title: title.trim() || 'Training',
      exercise: exercise.trim(),
      notes: notes.trim(),
      warmupSec: warm,
      workSec: wo,
      restBetweenRepsSec: rr,
      repsPerSet: clampInt(repsPerSet, 1, 999),
      restBetweenSetsSec: rs,
      sets: clampInt(sets, 1, 999),
      cooldownSec: cool,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }

    props.onSave(card)
  }

  return (
    <div className="stack">
      <h1 className="h1">{existing ? 'Karte bearbeiten' : 'Neue Karte'}</h1>

      <div className="card">
        <div className="grid2">
          <label className="field">
            <span>Titel</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label className="field">
            <span>Übung (z.B. Liegestütze)</span>
            <input value={exercise} onChange={(e) => setExercise(e.target.value)} />
          </label>

          <label className="field full">
            <span>Notizen (optional)</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <label className="field">
            <span>Warmup (mm:ss oder Sekunden)</span>
            <input value={warmup} onChange={(e) => setWarmup(e.target.value)} />
          </label>

          <label className="field">
            <span>Arbeit (mm:ss oder Sekunden)</span>
            <input value={work} onChange={(e) => setWork(e.target.value)} />
          </label>

          <label className="field">
            <span>Pause zwischen Wiederholungen</span>
            <input value={restRep} onChange={(e) => setRestRep(e.target.value)} />
          </label>

          <label className="field">
            <span>Wiederholungen pro Satz</span>
            <input
              type="number"
              min={1}
              max={999}
              value={repsPerSet}
              onChange={(e) => setRepsPerSet(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Satzpause</span>
            <input value={restSet} onChange={(e) => setRestSet(e.target.value)} />
          </label>

          <label className="field">
            <span>Sätze</span>
            <input
              type="number"
              min={1}
              max={999}
              value={sets}
              onChange={(e) => setSets(Number(e.target.value))}
            />
          </label>

          <label className="field">
            <span>Cooldown</span>
            <input value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
          </label>
        </div>

        <div className="row between wrap" style={{ marginTop: 12 }}>
          <div className="sub">
            Gesamt: <b>{previewTotal === null ? '—' : formatMMSS(previewTotal)}</b>
          </div>
          <div className="row gap">
            <button className="btn ghost" onClick={props.onCancel}>
              Abbrechen
            </button>
            <button className="btn" onClick={onSave}>
              Speichern
            </button>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}

function RunnerView(props: { card: IntervalCard; onBack: () => void; onEdit: () => void }) {
  const plan = useMemo(() => buildPlan(props.card), [props.card])
  const totalSec = useMemo(() => totalFromPlan(plan), [plan])

  // Precompute suffix sums for "total remaining"
  const suffix = useMemo(() => {
    const arr = new Array(plan.length + 1).fill(0)
    for (let i = plan.length - 1; i >= 0; i--) {
      arr[i] = arr[i + 1] + plan[i].durationSec
    }
    return arr
  }, [plan])

  const [status, setStatus] = useState<RunStatus>('IDLE')
  const [stepIndex, setStepIndex] = useState<number>(0)
  const [remainingSec, setRemainingSec] = useState<number>(plan[0]?.durationSec ?? 0)

  const statusRef = useRef<RunStatus>('IDLE')
  const stepIndexRef = useRef<number>(0)
  const remainingRef = useRef<number>(remainingSec)
  const endAtMsRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { stepIndexRef.current = stepIndex }, [stepIndex])
  useEffect(() => { remainingRef.current = remainingSec }, [remainingSec])

  // Reset when card changes
  useEffect(() => {
    setStatus('IDLE')
    setStepIndex(0)
    setRemainingSec(plan[0]?.durationSec ?? 0)
    statusRef.current = 'IDLE'
    stepIndexRef.current = 0
    remainingRef.current = plan[0]?.durationSec ?? 0
    endAtMsRef.current = null
  }, [props.card.id, plan])

  function goToStep(i: number) {
    const next = Math.max(0, Math.min(i, plan.length - 1))
    const dur = plan[next]?.durationSec ?? 0
    setStepIndex(next)
    setRemainingSec(dur)
    stepIndexRef.current = next
    remainingRef.current = dur

    if (statusRef.current === 'RUNNING') {
      endAtMsRef.current = Date.now() + dur * 1000
    } else {
      endAtMsRef.current = null
    }
  }

  function finish() {
    setStatus('FINISHED')
    statusRef.current = 'FINISHED'
    endAtMsRef.current = null
    setRemainingSec(0)
    remainingRef.current = 0
  }

  function nextStep() {
    const i = stepIndexRef.current + 1
    if (i >= plan.length) {
      finish()
      return
    }
    goToStep(i)
  }

  function startOrResume() {
    if (plan.length === 0) return
    if (statusRef.current === 'FINISHED') {
      setStatus('IDLE')
      statusRef.current = 'IDLE'
      goToStep(0)
    }

    const rem = remainingRef.current
    setStatus('RUNNING')
    statusRef.current = 'RUNNING'
    endAtMsRef.current = Date.now() + rem * 1000
  }

  function pause() {
    setStatus('PAUSED')
    statusRef.current = 'PAUSED'
    endAtMsRef.current = null
  }

  function skip() {
    if (statusRef.current === 'FINISHED') return
    nextStep()
  }

  // Tick loop
  useEffect(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }

    timerRef.current = window.setInterval(() => {
      if (statusRef.current !== 'RUNNING') return
      const endAt = endAtMsRef.current
      if (!endAt) return

      const now = Date.now()
      const msLeft = endAt - now
      const secLeft = Math.max(0, Math.ceil(msLeft / 1000))

      if (secLeft !== remainingRef.current) {
        setRemainingSec(secLeft)
        remainingRef.current = secLeft
      }

      if (secLeft <= 0) {
        nextStep()
      }
    }, 200)

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const step = plan[stepIndex] ?? null

  const overallRemaining =
    status === 'FINISHED'
      ? 0
      : remainingSec + (suffix[stepIndex + 1] ?? 0)

  const statusButton =
    status === 'RUNNING' ? (
      <button className="btn" onClick={pause}>Pause</button>
    ) : (
      <button className="btn" onClick={startOrResume}>
        {status === 'PAUSED' ? 'Weiter' : status === 'FINISHED' ? 'Nochmal' : 'Start'}
      </button>
    )

  return (
    <div className="stack">
      <div className="card">
        <div className="row between wrap">
          <div>
            <div className="title">{props.card.title}</div>
            <div className="sub">{props.card.exercise || 'Übung'}</div>
          </div>
          <div className="pill">{formatMMSS(overallRemaining)}</div>
        </div>

        <div className="runner">
          <div className="phase">{step ? phaseLabel(step.phase) : 'FERTIG'}</div>
          <div className="big">{formatMMSS(remainingSec)}</div>

          {step && (
            <div className="sub">
              {step.label}
              {typeof step.setIndex === 'number' && (
                <> · Satz {step.setIndex}/{props.card.sets}</>
              )}
              {typeof step.repIndex === 'number' && (
                <> · Wdh {step.repIndex}/{props.card.repsPerSet}</>
              )}
            </div>
          )}

          <div className="row gap wrap center" style={{ marginTop: 12 }}>
            {statusButton}
            <button className="btn ghost" onClick={skip} disabled={status === 'FINISHED'}>
              Skip
            </button>
            <button className="btn ghost" onClick={props.onEdit}>
              Bearbeiten
            </button>
          </div>

          <div className="row gap wrap center" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={props.onBack}>
              Zurück
            </button>
          </div>

          <div className="sub" style={{ marginTop: 10 }}>
            Gesamt: {formatMMSS(totalSec)}
          </div>
        </div>
      </div>
    </div>
  )
}

