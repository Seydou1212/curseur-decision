import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { rpc, supabaseConfigured } from './supabase'
import { LEVELS, DOMAINS, DEFAULT_DECISIONS } from './decisions'

// ⚠️ Tous les sous-composants sont définis HORS de App
// (sinon perte de focus à chaque re-rendu, comme sur jury-cqp).

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
const lv = n => `var(--l${n})`
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))
const plural = (n, s, p) => (n > 1 ? p : s)
const domainName = id => DOMAINS.find(D => D.id === id)?.name || 'Autres'
const lcfirst = s => s.charAt(0).toLowerCase() + s.slice(1)

// Niveaux de la séance : ceux enregistrés en base, sinon ceux de decisions.js
function sessionLevels(custom) {
  return LEVELS.map((L, i) => {
    const c = Array.isArray(custom) ? custom[i] : null
    return { n: L.n, who: c?.who || L.who, title: c?.title || L.title, text: c ? c.text || '' : L.text }
  })
}

// Niveaux voisins qui ont le même « qui décide » : [{ who, ns: [1, 2] }, ...]
function levelGroups(levels) {
  const groups = []
  levels.forEach(L => {
    const last = groups[groups.length - 1]
    if (last && last.who === L.who) last.ns.push(L.n)
    else groups.push({ who: L.who, ns: [L.n] })
  })
  return groups
}

function rangeLabel(ns) {
  if (ns.length === 1) return `niveau ${ns[0]}`
  if (ns.length === 2) return `niveaux ${ns[0]} et ${ns[1]}`
  return `niveaux ${ns[0]} à ${ns[ns.length - 1]}`
}

const PHASES = [
  { id: 'preparation', label: 'Préparation', hint: 'Discussion. Les associés voient la liste, sans voter.' },
  { id: 'vote', label: 'Vote ouvert', hint: 'Les associés votent. La liste est verrouillée.' },
  { id: 'resultats', label: 'Résultats', hint: 'Les résultats sont visibles par tous.' },
]

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key))
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return null
  }
}

function newToken() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function getVoterToken(code) {
  const key = `curseur-token-${code}`
  let t = store(key)
  if (!t) { t = newToken(); store(key, t) }
  return t
}

function sameAnswers(a, b) {
  if (!a || !b) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every(k => a[k] === b[k])
}

// Garde seulement les réponses dont la clé passe le test `keep`.
// Renvoie le même objet si rien n'a changé.
function pruneAnswers(obj, keep) {
  if (!obj) return obj
  const out = {}
  let changed = false
  for (const k of Object.keys(obj)) {
    if (keep(k)) out[k] = obj[k]
    else changed = true
  }
  return changed ? out : obj
}

// Décisions de l'atelier d'un côté, les autres par domaine (dans l'ordre de DOMAINS)
function groupDecisions(list) {
  const tests = list.filter(d => d.test)
  const known = new Set(DOMAINS.map(D => D.id))
  const groups = DOMAINS.map(D => ({ id: D.id, name: D.name, list: list.filter(d => !d.test && d.domain === D.id) }))
  const other = list.filter(d => !d.test && !known.has(d.domain))
  if (other.length) groups.push({ id: '_autres', name: 'Autres', list: other })
  return { tests, groups: groups.filter(g => g.list.length) }
}

// Statistiques à partir d'un tableau [n1, n2, n3, n4, n5]
function stats(counts) {
  const c = counts || [0, 0, 0, 0, 0]
  const vals = []
  c.forEach((k, i) => { for (let j = 0; j < k; j++) vals.push(i + 1) })
  const n = vals.length
  if (!n) return { counts: c, n, median: null, gap: 0 }
  const median = n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2
  return { counts: c, n, median, gap: vals[n - 1] - vals[0] }
}

function parseRoute() {
  const h = window.location.hash.replace(/^#\/?/, '')
  const [path, query = ''] = h.split('?')
  const parts = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query)
  if (parts[0] === 's' && parts[1]) {
    return { name: parts[2] === 'animateur' ? 'admin' : 'vote', code: parts[1].toUpperCase(), key: params.get('k') }
  }
  return { name: 'home' }
}

function useRoute() {
  const [route, setRoute] = useState(parseRoute)
  useEffect(() => {
    const onHash = () => { setRoute(parseRoute()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}

// Appelle fn tout de suite puis toutes les `ms` millisecondes tant que active
function usePolling(fn, ms, active) {
  const saved = useRef(fn)
  useEffect(() => { saved.current = fn }, [fn])
  useEffect(() => {
    if (!active) return
    let stop = false
    const tick = () => { if (!stop) saved.current() }
    tick()
    const id = setInterval(tick, ms)
    return () => { stop = true; clearInterval(id) }
  }, [ms, active])
}

// Bouton à confirmation en deux temps : renvoie [armé ?, fonction à appeler au clic]
function useTwoStep(ms = 4000) {
  const [armed, setArmed] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const arm = useCallback(id => {
    clearTimeout(timer.current)
    setArmed(id)
    if (id !== null) timer.current = setTimeout(() => setArmed(null), ms)
  }, [ms])
  return [armed, arm]
}

const joinUrl = code => `${window.location.origin}${window.location.pathname}#/s/${code}`

// ---------------------------------------------------------------------
// Composants communs
// ---------------------------------------------------------------------
function Header({ title = 'Curseur de décision', lede }) {
  return (
    <header className="top">
      <div className="wrap">
        <p className="org">Hauteur & Sécurité, réunion d'associés</p>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
    </header>
  )
}

function Tabs({ tabs, active, onChange }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <div className="wrap" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onChange(t.id)}>{t.label}</button>
        ))}
      </div>
    </nav>
  )
}

// Couleur d'un groupe : le niveau 3 (orange) s'il en fait partie, sinon le plus haut
const groupColor = ns => lv(ns.includes(3) ? 3 : ns[ns.length - 1])

function Legend({ levels }) {
  return (
    <div className="legend" aria-hidden="true">
      {levelGroups(levels).map(g => (
        <div key={g.ns[0]} style={{ gridColumn: `span ${g.ns.length}`, borderColor: groupColor(g.ns) }}>
          {g.who}<small>{rangeLabel(g.ns)}</small>
        </div>
      ))}
    </div>
  )
}

function Rail({ decision, levels, value, onPick, disabled }) {
  const fillStyle = value ? { width: `${(value - 1) * 20}%`, background: lv(value) } : { width: 0 }
  return (
    <div className={`dec ${disabled ? 'locked' : ''}`}>
      <p className="q">{decision.label}</p>
      <div className="rail" role="radiogroup" aria-label={decision.label} aria-disabled={disabled || undefined}>
        <span className="track" />
        <span className="fill" style={fillStyle} />
        {levels.map(L => (
          <button
            key={L.n}
            type="button"
            className="stop"
            role="radio"
            aria-checked={value === L.n}
            aria-label={`Niveau ${L.n} : ${L.who}, ${L.title}`}
            style={{ '--lv': lv(L.n) }}
            disabled={disabled}
            onClick={() => onPick(decision.id, L.n)}
          >{L.n}</button>
        ))}
      </div>
      <p className="picked">
        {value ? <>Niveau {value} : <b>{levels[value - 1].who}, {lcfirst(levels[value - 1].title)}</b></> : disabled ? '' : 'Pas encore de choix'}
      </p>
    </div>
  )
}

function DecisionList({ decisions, levels, answers, onPick, disabled }) {
  const { tests, groups } = groupDecisions(decisions)
  const domainBlocks = groups.map(g => (
    <div key={g.id}>
      <h3>{g.name}</h3>
      {g.list.map(d => <Rail key={d.id} decision={d} levels={levels} value={answers[d.id]} onPick={onPick} disabled={disabled} />)}
    </div>
  ))
  if (!decisions.length) return <div className="note quiet">Aucune décision pour l'instant.</div>
  return (
    <>
      <Legend levels={levels} />
      {tests.length > 0 ? (
        <>
          <h2>{tests.length > 1 ? `Les ${tests.length} décisions de l'atelier` : "La décision de l'atelier"}</h2>
          <p className="sub">Réponds au moins à {plural(tests.length, 'celle-ci', 'celles-ci')}.</p>
          {tests.map(d => <Rail key={d.id} decision={d} levels={levels} value={answers[d.id]} onPick={onPick} disabled={disabled} />)}
          {groups.length > 0 && (
            <details className="more">
              <summary>Toutes les autres décisions</summary>
              {domainBlocks}
            </details>
          )}
        </>
      ) : domainBlocks}
    </>
  )
}

function ResultCard({ decision, counts }) {
  const st = stats(counts)
  const max = Math.max(1, ...st.counts)
  let badge = <span className="badge">{st.n ? '1 vote' : 'Aucun vote'}</span>
  if (st.n >= 2) badge = st.gap >= 2
    ? <span className="badge warn">À débattre</span>
    : <span className="badge ok">Consensus</span>
  return (
    <div className="res">
      <div className="res-head"><p className="q">{decision.label}</p>{badge}</div>
      <div className="hist" role="img" aria-label={`Répartition : ${st.counts.map((c, i) => `niveau ${i + 1}, ${c}`).join(' ; ')}`}>
        {st.counts.map((c, i) => {
          const n = i + 1
          return (
            <div className="col" key={n} style={{ '--lv': lv(n) }}>
              <div className="plot">
                <span className={`n ${c ? '' : 'zero'}`}>{c}</span>
                <span className="b" style={{ height: c ? Math.round((c / max) * 58) : 0 }} />
              </div>
              <span className={`lab ${decision.prop === n ? 'prop' : ''}`} title={decision.prop === n ? 'Niveau proposé' : undefined}>{n}</span>
            </div>
          )
        })}
      </div>
      <div className="res-foot">
        {st.n > 0 && <span>Médiane <b>{fmt(st.median)}</b></span>}
        {decision.prop && <span>Proposé <b>{decision.prop}</b></span>}
        {st.n > 0 && <span>Écart <b>{st.gap}</b> {plural(st.gap, 'niveau', 'niveaux')}</span>}
        {st.n > 0 && <span>{st.n} {plural(st.n, 'vote', 'votes')}</span>}
      </div>
    </div>
  )
}

function Results({ decisions, counts, voters }) {
  const [scope, setScope] = useState('tests')
  const [sortGap, setSortGap] = useState(true)
  const c = counts || {}
  const { tests, groups } = groupDecisions(decisions)
  const hasTests = tests.length > 0
  const showAll = scope === 'all' || !hasTests

  let body
  if (!voters) {
    body = <div className="note quiet">Aucun vote pour l'instant.</div>
  } else if (sortGap) {
    const list = (showAll ? decisions : tests)
      .map(d => ({ d, s: stats(c[d.id]) }))
      .sort((a, b) => (b.s.gap - a.s.gap) || (b.s.n - a.s.n))
    body = list.map(({ d }) => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)
  } else if (showAll) {
    body = (
      <>
        {hasTests && <h3>Décisions de l'atelier</h3>}
        {tests.map(d => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)}
        {groups.map(g => (
          <div key={g.id}>
            <h3>{g.name}</h3>
            {g.list.map(d => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)}
          </div>
        ))}
      </>
    )
  } else {
    body = tests.map(d => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)
  }

  return (
    <>
      <div className="toolbar">
        <span className="count">{voters} {plural(voters, 'votant', 'votants')}</span>
        {hasTests && groups.length > 0 && (
          <div className="seg" role="group" aria-label="Décisions affichées">
            <button aria-pressed={scope === 'tests'} onClick={() => setScope('tests')}>Atelier</button>
            <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Toutes</button>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={sortGap} onChange={e => setSortGap(e.target.checked)} /> Les plus partagées en premier
        </label>
      </div>
      <p className="key"><i /> niveau proposé dans la ventilation</p>
      {body}
    </>
  )
}

function LevelForm({ level, busy, onSubmit, onCancel }) {
  const [who, setWho] = useState(level.who)
  const [title, setTitle] = useState(level.title)
  const [text, setText] = useState(level.text)
  const submit = e => {
    e.preventDefault()
    if (who.trim() && title.trim()) onSubmit({ who: who.trim(), title: title.trim(), text: text.trim() })
  }
  return (
    <form className="ed-form" onSubmit={submit}>
      <div className="ed-fields">
        <label className="field grow">
          <span>Qui décide</span>
          <input value={who} maxLength={40} autoFocus onChange={e => setWho(e.target.value)} />
        </label>
        <label className="field grow wide">
          <span>Titre</span>
          <input value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
        </label>
      </div>
      <label className="field" style={{ marginTop: '.7rem' }}>
        <span>Explication</span>
        <textarea className="plain" rows={2} value={text} maxLength={300} onChange={e => setText(e.target.value)} />
      </label>
      <div className="actions">
        <button className="btn" type="submit" disabled={busy || !who.trim() || !title.trim()}>Enregistrer</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  )
}

function LevelRow({ L, canEdit, editing, busy, onEdit, onSave, onCancel }) {
  if (editing) {
    return (
      <div className="lvl editing" style={{ '--lv': lv(L.n) }}>
        <div className="num">{L.n}</div>
        <LevelForm level={L} busy={busy} onSubmit={onSave} onCancel={onCancel} />
      </div>
    )
  }
  return (
    <div className="lvl" style={{ '--lv': lv(L.n) }}>
      <div className="num">{L.n}</div>
      <div><span className="who">{L.who}</span><h4>{L.title}</h4>{L.text && <p>{L.text}</p>}</div>
      {canEdit && <button className="icon-btn" type="button" aria-label={`Modifier le niveau ${L.n}`} title="Modifier" disabled={busy} onClick={onEdit}>✎</button>}
    </div>
  )
}

// edit (animateur seulement) : { state: 'editable' | 'phase' | 'votes', custom, busy, onSave(niveaux | null) }
function LevelsRef({ levels, edit }) {
  const [editing, setEditing] = useState(null)
  const [armed, arm] = useTwoStep()
  const canEdit = edit?.state === 'editable'
  useEffect(() => { if (!canEdit) { setEditing(null); arm(null) } }, [canEdit, arm])

  const save = n => async values => {
    const next = levels.map(L => (L.n === n ? values : { who: L.who, title: L.title, text: L.text }))
    if (await edit.onSave(next)) setEditing(null)
  }
  const reset = async () => {
    if (!armed) { arm(true); return }
    arm(null)
    await edit.onSave(null)
  }

  return (
    <>
      <h2 style={{ marginTop: '.4rem' }}>Les 5 niveaux</h2>
      {edit?.state === 'phase' && <p className="sub">Les niveaux se modifient en phase de préparation, avant le vote.</p>}
      {edit?.state === 'votes' && <p className="sub">Des votes sont enregistrés : les niveaux ne se modifient plus.</p>}
      {levels.map(L => (
        <LevelRow
          key={L.n}
          L={L}
          canEdit={canEdit}
          editing={editing === L.n}
          busy={edit?.busy}
          onEdit={() => setEditing(L.n)}
          onSave={save(L.n)}
          onCancel={() => setEditing(null)}
        />
      ))}
      {canEdit && edit.custom && (
        <div className="actions">
          <button className={`btn danger ${armed ? 'arm' : ''}`} type="button" disabled={edit.busy} onClick={reset}>
            {armed ? 'Confirmer : revenir aux niveaux par défaut' : 'Revenir aux niveaux par défaut'}
          </button>
        </div>
      )}
      <h2>Règles transverses</h2>
      <div className="rule"><h4>Conflit d'intérêts</h4><p>Toute décision qui concerne personnellement le Président-directeur (rémunération, conditions de travail, contrat avec une structure où il a des intérêts) monte au minimum au niveau 4.</p></div>
      <div className="rule"><h4>Urgence</h4><p>En cas d'urgence, le directeur ou le Président peut agir au-delà de son niveau, avec information des associés sous 48 h.</p></div>
      <div className="rule"><h4>Avis facultatif</h4><p>Pour les décisions de niveau 3, le Président peut, s'il le juge utile, solliciter l'avis d'associés ou de responsables de son choix. Cet avis est consultatif et ne change pas le niveau de décision.</p></div>
      <h2>Hors curseur</h2>
      <div className="rule"><p>Certaines décisions relèvent de l'AG par la loi ou les statuts : approbation des comptes, répartition des excédents, modification des statuts, élection du Président, admission des associés. Elles ne passent pas par le curseur.</p></div>
    </>
  )
}

// ---------------------------------------------------------------------
// Page d'accueil
// ---------------------------------------------------------------------
function Home() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sessions = store('curseur-admin-sessions') || []

  const join = e => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (c.length < 4) { setError('Le code fait 5 caractères.'); return }
    window.location.hash = `#/s/${c}`
  }

  const create = async () => {
    setBusy(true); setError('')
    try {
      const p_decisions = DEFAULT_DECISIONS.map(({ id, label, domain, prop, test }) => ({ id, label, domain, prop: prop ?? null, test: !!test }))
      const res = await rpc('curseur_create_session', { p_decisions })
      const list = [{ code: res.code, key: res.admin_key, at: new Date().toISOString() }, ...sessions].slice(0, 10)
      store('curseur-admin-sessions', list)
      window.location.hash = `#/s/${res.code}/animateur?k=${res.admin_key}`
    } catch (err) {
      setError(`La séance n'a pas pu être créée : ${err.message}`)
      setBusy(false)
    }
  }

  return (
    <>
      <Header lede="Pour chaque décision, place le curseur au niveau qui te semble juste. Les votes sont anonymes : seuls les totaux sont affichés." />
      <main><div className="wrap">
        {error && <div className="note error">{error}</div>}
        <div className="card">
          <h2>Rejoindre une séance</h2>
          <p className="sub">Saisis le code affiché à l'écran.</p>
          <form className="join" onSubmit={join}>
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 5))}
              placeholder="CODE"
              aria-label="Code de la séance"
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button className="btn" type="submit">Rejoindre</button>
          </form>
        </div>
        <div className="card">
          <h2>Animer une séance</h2>
          <p className="sub">Crée une séance : tu obtiens un code et un QR code à projeter, la liste des décisions à ajuster avec les associés, et un lien animateur pour ouvrir le vote et révéler les résultats.</p>
          <button className="btn ghost" onClick={create} disabled={busy}>{busy ? 'Création…' : 'Créer une séance'}</button>
          {sessions.length > 0 && (
            <>
              <h3>Tes séances sur cet appareil</h3>
              <ul className="links">
                {sessions.map(s => (
                  <li key={s.code}>
                    <a href={`#/s/${s.code}/animateur?k=${s.key}`}>{s.code}</a>{' '}
                    <span className="sub">créée le {new Date(s.at).toLocaleDateString('fr-FR')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div></main>
    </>
  )
}

// ---------------------------------------------------------------------
// Page de vote (associés)
// ---------------------------------------------------------------------
function VotePage({ code }) {
  const [tab, setTab] = useState('vote')
  const [status, setStatus] = useState('loading') // loading | ok | missing | error
  const [phase, setPhase] = useState(null)
  const [decisions, setDecisions] = useState([])
  const [levels, setLevels] = useState(() => sessionLevels(null))
  const [answers, setAnswers] = useState({})
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [results, setResults] = useState(null)
  const token = useRef(getVoterToken(code))
  const draftKey = `curseur-draft-${code}`
  const answersRef = useRef(answers)
  answersRef.current = answers
  const labelsRef = useRef(null) // libellés vus au dernier rafraîchissement
  const phaseRef = useRef(null)

  const applySession = useCallback(s => {
    if (!s || !s.exists) return
    setPhase(s.phase)
    setDecisions(s.decisions)
    setLevels(sessionLevels(s.levels))
  }, [])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const s = await rpc('curseur_session', { p_code: code })
        if (cancel) return
        if (!s.exists) { setStatus('missing'); return }
        const mine = await rpc('curseur_my_vote', { p_code: code, p_token: token.current })
        if (cancel) return
        // Brouillon local (choix pas encore enregistrés) prioritaire sur le vote enregistré
        const draft = store(draftKey)
        if (mine) setSaved({ ...mine })
        setAnswers({ ...(draft && typeof draft === 'object' ? draft : mine || {}) })
        applySession(s)
        setStatus('ok')
      } catch (err) {
        if (!cancel) { setError(err.message); setStatus('error') }
      }
    })()
    return () => { cancel = true }
  }, [code, draftKey, applySession])

  // La liste et la phase se rafraîchissent toutes les 3 secondes
  const loadSession = useCallback(async () => {
    try { applySession(await rpc('curseur_session', { p_code: code })) } catch { /* on réessaie au prochain tour */ }
  }, [code, applySession])
  usePolling(loadSession, 3000, status === 'ok')

  // Conserve les choix en cours, même après un rechargement de la page
  useEffect(() => { if (status === 'ok') store(draftKey, answers) }, [answers, status, draftKey])

  // Quand la liste change : on retire les choix sur les décisions supprimées
  // ou dont le libellé a changé (leurs votes ont été effacés en base)
  useEffect(() => {
    if (status !== 'ok') return
    const now = new Map(decisions.map(d => [d.id, d.label]))
    const prev = labelsRef.current
    labelsRef.current = now
    const keep = k => now.has(k) && !(prev && prev.has(k) && prev.get(k) !== now.get(k))
    const next = pruneAnswers(answersRef.current, keep)
    if (next !== answersRef.current) {
      setAnswers(next)
      if (prev) setNotice("Une décision sur laquelle tu avais choisi un niveau a été modifiée ou retirée. Vérifie tes choix.")
    }
    setSaved(s => pruneAnswers(s, keep))
  }, [decisions, status])

  // Passage aux résultats : on les affiche directement
  useEffect(() => {
    if (phase === 'resultats' && phaseRef.current && phaseRef.current !== 'resultats') setTab('results')
    phaseRef.current = phase
  }, [phase])

  const loadResults = useCallback(async () => {
    try { setResults(await rpc('curseur_results', { p_code: code })) } catch { /* on réessaie au prochain tour */ }
  }, [code])
  usePolling(loadResults, 4000, status === 'ok' && tab === 'results')

  const onPick = useCallback((id, n) => {
    setAnswers(prev => {
      const next = { ...prev }
      if (next[id] === n) delete next[id]; else next[id] = n
      return next
    })
    setError('')
    setNotice('')
  }, [])

  const save = async () => {
    setSaving(true); setError('')
    try {
      const snapshot = { ...answers }
      await rpc('curseur_cast_vote', { p_code: code, p_token: token.current, p_answers: snapshot })
      setSaved(snapshot)
      setNotice('')
    } catch (err) {
      setError(`Le vote n'a pas pu être enregistré : ${err.message}`)
    }
    setSaving(false)
  }

  if (status === 'loading') return <><Header /><main><div className="wrap"><p className="sub">Chargement de la séance {code}…</p></div></main></>
  if (status === 'missing' || status === 'error') {
    return (
      <><Header /><main><div className="wrap">
        <div className="note error">{status === 'missing' ? `Aucune séance ne correspond au code ${code}. Vérifie le code affiché à l'écran.` : `Impossible de charger la séance : ${error}`}</div>
        <a className="btn ghost" href="#/">Revenir à l'accueil</a>
      </div></main></>
    )
  }

  const open = phase === 'vote'
  const tests = decisions.filter(d => d.test)
  const t = tests.filter(d => answers[d.id]).length
  const all = decisions.filter(d => answers[d.id]).length
  const unchanged = sameAnswers(answers, saved)
  let barText = tests.length
    ? `${t} / ${tests.length} ${plural(tests.length, "décision de l'atelier", "décisions de l'atelier")}${all > t ? `, ${all - t} ${plural(all - t, 'autre', 'autres')}` : ''}`
    : `${all} / ${decisions.length} ${plural(decisions.length, 'décision', 'décisions')}`
  if (phase === 'preparation') barText = "Le vote n'est pas encore ouvert"
  else if (phase === 'resultats') barText = 'Le vote est clos'
  else if (error) barText = error
  else if (saving) barText = 'Enregistrement…'
  else if (unchanged && all) barText = 'Ton vote est enregistré'

  return (
    <>
      <Header lede={`Séance ${code}. Ton vote est anonyme : seuls les totaux sont affichés, et tu peux le modifier jusqu'à la clôture.`} />
      <Tabs
        tabs={[{ id: 'vote', label: 'Voter' }, { id: 'results', label: 'Résultats' }, { id: 'levels', label: 'Les 5 niveaux' }]}
        active={tab}
        onChange={id => { setTab(id); window.scrollTo(0, 0) }}
      />
      <main><div className="wrap">
        {tab === 'vote' && (
          <>
            {phase === 'preparation' && <div className="note">Discussion en cours. La liste peut encore changer, elle se met à jour toute seule. Le vote s'ouvrira quand l'animateur le décidera.</div>}
            {phase === 'resultats' && <div className="note quiet">Le vote est clos. Les résultats sont dans l'onglet Résultats.</div>}
            {notice && <div className="note error">{notice}</div>}
            <DecisionList decisions={decisions} levels={levels} answers={answers} onPick={onPick} disabled={!open} />
          </>
        )}
        {tab === 'results' && (
          !results ? <p className="sub">Chargement…</p>
          : results.counts
            ? <Results decisions={decisions} counts={results.counts} voters={results.voters} />
            : <div className="note quiet">{results.voters} {plural(results.voters, 'associé a voté', 'associés ont voté')}. Les résultats s'afficheront ici quand l'animateur les révélera.</div>
        )}
        {tab === 'levels' && <LevelsRef levels={levels} />}
      </div></main>
      {tab === 'vote' && (
        <div className="bar-bottom"><div className="wrap">
          <p>{barText}</p>
          <button className="btn" onClick={save} disabled={!open || !all || saving || unchanged}>
            {saved && Object.keys(saved).length ? 'Mettre à jour mon vote' : 'Enregistrer mon vote'}
          </button>
        </div></div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------
// Page animateur : édition des décisions
// ---------------------------------------------------------------------
function PhaseControl({ phase, onSet, busy }) {
  return (
    <div className="phases" role="group" aria-label="Phase de la séance">
      {PHASES.map((p, i) => (
        <button key={p.id} type="button" aria-pressed={phase === p.id} disabled={busy} onClick={() => phase !== p.id && onSet(p.id)}>
          <span className="step">{i + 1}</span>
          <span className="ph-label">{p.label}</span>
          <small>{p.hint}</small>
        </button>
      ))}
    </div>
  )
}

function DecisionForm({ initial, levels, votes = 0, submitLabel, onSubmit, onCancel, busy, autoFocus }) {
  const [label, setLabel] = useState(initial.label)
  const [domain, setDomain] = useState(initial.domain)
  const [prop, setProp] = useState(initial.prop ? String(initial.prop) : '')
  const [test, setTest] = useState(initial.test)
  const [confirm, setConfirm] = useState(false)
  const formRef = useRef(null)
  const labelChanged = label.trim().replace(/\s+/g, ' ') !== initial.label
  const needsConfirm = votes > 0 && labelChanged

  const submit = async e => {
    e.preventDefault()
    if (!label.trim()) return
    if (needsConfirm && !confirm) { setConfirm(true); return }
    const ok = await onSubmit({ label: label.trim(), domain, prop: prop ? Number(prop) : null, test })
    if (ok && !initial.label) { setLabel(''); setConfirm(false) }
  }

  return (
    <form className="ed-form" onSubmit={submit} ref={formRef}>
      <label className="field">
        <span>Décision</span>
        <textarea
          rows={2}
          value={label}
          maxLength={300}
          autoFocus={autoFocus}
          placeholder="Ex. : Changer de logiciel de gestion"
          onChange={e => { setLabel(e.target.value); setConfirm(false) }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); formRef.current.requestSubmit() } }}
        />
      </label>
      <div className="ed-fields">
        <label className="field">
          <span>Domaine</span>
          <select value={domain} onChange={e => setDomain(e.target.value)}>
            {DOMAINS.map(D => <option key={D.id} value={D.id}>{D.name}</option>)}
            {!DOMAINS.some(D => D.id === domain) && <option value={domain}>{domainName(domain)}</option>}
          </select>
        </label>
        <label className="field">
          <span>Niveau proposé</span>
          <select value={prop} onChange={e => setProp(e.target.value)}>
            <option value="">Aucun</option>
            {levels.map(L => <option key={L.n} value={L.n}>{L.n} : {L.who}, {lcfirst(L.title)}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={test} onChange={e => setTest(e.target.checked)} /> Décision de l'atelier
        </label>
      </div>
      {confirm && (
        <p className="warn-line">Le libellé change : {votes} {plural(votes, 'vote enregistré sur cette décision sera effacé', 'votes enregistrés sur cette décision seront effacés')}.</p>
      )}
      <div className="actions">
        <button className={`btn ${confirm ? 'danger arm' : ''}`} type="submit" disabled={busy || !label.trim()}>
          {confirm ? 'Confirmer et effacer les votes' : submitLabel}
        </button>
        {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  )
}

function EditorRow({ d, levels, first, last, editable, showProps, showDomain, busy, editing, armed, onEdit, onCancel, onSave, onMove, onDelete }) {
  if (editing) {
    return (
      <div className="ed-row editing">
        <DecisionForm initial={d} levels={levels} votes={d.votes} submitLabel="Enregistrer" onSubmit={onSave} onCancel={onCancel} busy={busy} autoFocus />
      </div>
    )
  }
  return (
    <div className="ed-row">
      <div className="ed-main">
        <p className="ed-label">{d.label}</p>
        <p className="ed-meta">
          {showDomain && <span className="tag">{domainName(d.domain)}</span>}
          {showProps && d.prop && <span className="pill" style={{ '--lv': lv(d.prop) }}>Proposé {d.prop}</span>}
          {d.votes > 0 && <span className="tag">{d.votes} {plural(d.votes, 'vote', 'votes')}</span>}
        </p>
        {armed && d.votes > 0 && <p className="warn-line">{d.votes} {plural(d.votes, 'vote sera effacé', 'votes seront effacés')}.</p>}
      </div>
      {editable && (
        <div className="ed-tools">
          <button className="icon-btn" type="button" aria-label="Monter" title="Monter" disabled={busy || first} onClick={() => onMove(-1)}>↑</button>
          <button className="icon-btn" type="button" aria-label="Descendre" title="Descendre" disabled={busy || last} onClick={() => onMove(1)}>↓</button>
          <button className="icon-btn" type="button" aria-label="Modifier" title="Modifier" disabled={busy} onClick={onEdit}>✎</button>
          <button className={`btn danger small ${armed ? 'arm' : ''}`} type="button" disabled={busy} onClick={onDelete}>
            {armed ? 'Confirmer' : 'Supprimer'}
          </button>
        </div>
      )}
    </div>
  )
}

function Editor({ decisions, levels, phase, busy, act, onPhase }) {
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [showProps, setShowProps] = useState(() => store('curseur-show-props') === true)
  const [armed, arm] = useTwoStep()
  const editable = phase === 'preparation'
  const { tests, groups } = groupDecisions(decisions)

  useEffect(() => { store('curseur-show-props', showProps) }, [showProps])
  useEffect(() => { if (!editable) { setEditing(null); setAdding(false); arm(null) } }, [editable, arm])

  const save = d => async values => {
    const ok = await act('curseur_update_decision', { p_key: d.id, p_label: values.label, p_domain: values.domain, p_prop: values.prop, p_test: values.test })
    if (ok) setEditing(null)
    return ok
  }
  const add = values => act('curseur_add_decision', { p_label: values.label, p_domain: values.domain, p_prop: values.prop, p_test: values.test })
  const remove = d => async () => {
    if (armed !== d.id) { arm(d.id); return }
    arm(null)
    await act('curseur_delete_decision', { p_key: d.id })
  }

  const block = (list, withDomain) => list.map((d, i) => (
    <EditorRow
      key={d.id}
      d={d}
      levels={levels}
      first={i === 0}
      last={i === list.length - 1}
      editable={editable}
      showProps={showProps}
      showDomain={withDomain}
      busy={busy}
      editing={editing === d.id}
      armed={armed === d.id}
      onEdit={() => { setEditing(d.id); arm(null) }}
      onCancel={() => setEditing(null)}
      onSave={save(d)}
      onMove={dir => act('curseur_move_decision', { p_key: d.id, p_dir: dir })}
      onDelete={remove(d)}
    />
  ))

  return (
    <div className="editor">
      <div className="toolbar">
        <span className="count">{decisions.length} {plural(decisions.length, 'décision', 'décisions')}</span>
        <label className="check">
          <input type="checkbox" checked={showProps} onChange={e => setShowProps(e.target.checked)} /> Afficher les niveaux proposés
        </label>
      </div>
      {showProps && <div className="note">Niveaux proposés visibles : ne projette pas cet écran tant que la case est cochée.</div>}
      {!editable && (
        <div className="note quiet">
          La liste est verrouillée pendant le vote et les résultats.
          <div className="actions"><button className="btn ghost" type="button" disabled={busy} onClick={() => onPhase('preparation')}>Repasser en préparation</button></div>
        </div>
      )}

      {!decisions.length && <div className="note quiet">Aucune décision. Ajoute la première ci-dessous.</div>}
      {tests.length > 0 && (
        <>
          <h2>Décisions de l'atelier</h2>
          {block(tests, true)}
        </>
      )}
      {groups.map(g => (
        <div key={g.id}>
          <h2>{g.name}</h2>
          {block(g.list, false)}
        </div>
      ))}

      {editable && (
        adding ? (
          <div className="card add-card">
            <h2>Ajouter une décision</h2>
            <DecisionForm
              levels={levels}
              initial={{ label: '', domain: DOMAINS[0].id, prop: null, test: false }}
              submitLabel="Ajouter"
              onSubmit={add}
              onCancel={() => setAdding(false)}
              busy={busy}
              autoFocus
            />
          </div>
        ) : (
          <div className="actions">
            <button className="btn ghost" type="button" onClick={() => { setAdding(true); setEditing(null) }}>+ Ajouter une décision</button>
            <button className="btn" type="button" disabled={busy || !decisions.length} onClick={() => onPhase('vote')}>Ouvrir le vote</button>
          </div>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Page animateur
// ---------------------------------------------------------------------
function AdminPage({ code, adminKey }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState('session')
  const [armedReset, armReset] = useTwoStep()
  const url = joinUrl(code)

  const load = useCallback(async () => {
    try {
      const params = { p_code: code, p_admin_key: adminKey || null }
      const [res, s] = await Promise.all([rpc('curseur_results', params), rpc('curseur_session', params)])
      setData({ ...res, phase: s.phase, decisions: s.decisions || [], levels: sessionLevels(s.levels), levelsCustom: !!s.levels, levelsLocked: !!s.levels_locked })
      setLoadError('')
    } catch (err) { setLoadError(err.message) }
  }, [code, adminKey])
  usePolling(load, 3000, true)

  // Action animateur : renvoie true si elle a réussi
  const act = useCallback(async (fn, params = {}) => {
    setBusy(true); setError('')
    try {
      await rpc(fn, { p_code: code, p_admin_key: adminKey, ...params })
      await load()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }, [code, adminKey, load])

  const setPhase = useCallback(p => act('curseur_set_phase', { p_phase: p }), [act])

  const reset = async () => {
    if (!armedReset) { armReset(true); return }
    armReset(null)
    await act('curseur_reset')
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* rien */ }
  }

  if (!data) return <><Header title="Animation" /><main><div className="wrap">{loadError ? <div className="note error">{loadError}</div> : <p className="sub">Chargement…</p>}</div></main></>
  if (!data.exists || !data.is_admin) {
    return (
      <><Header title="Animation" /><main><div className="wrap">
        <div className="note error">{data.exists ? "Ce lien animateur n'est pas valide pour cette séance." : `Aucune séance ne correspond au code ${code}.`}</div>
        <a className="btn ghost" href="#/">Revenir à l'accueil</a>
      </div></main></>
    )
  }

  return (
    <>
      <Header title="Animation" lede="Garde ce lien pour toi : c'est lui qui permet de modifier la liste, d'ouvrir le vote et de révéler les résultats." />
      <Tabs
        tabs={[{ id: 'session', label: 'Séance' }, { id: 'decisions', label: 'Décisions' }, { id: 'results', label: 'Résultats' }, { id: 'levels', label: 'Les 5 niveaux' }]}
        active={tab}
        onChange={id => { setTab(id); window.scrollTo(0, 0) }}
      />
      <main><div className={`wrap ${tab === 'decisions' ? 'wide' : ''}`}>
        {error && <div className="note error">{error}</div>}
        {loadError && <div className="note error">Connexion perdue : {loadError}</div>}
        {tab === 'session' && (
          <>
            <div className="panel">
              <div className="qr"><QRCodeSVG value={url} size={180} /></div>
              <div>
                <p className="sub" style={{ margin: 0 }}>Pour voter, scannez le QR code ou saisissez le code</p>
                <p className="bigcode">{code}</p>
                <p className="url">{url}</p>
                <div className="actions">
                  <button className="btn ghost" onClick={copy}>{copied ? 'Lien copié' : 'Copier le lien'}</button>
                  <a className="btn ghost" href={url} target="_blank" rel="noreferrer">Voter moi aussi</a>
                </div>
              </div>
            </div>
            <div className="card">
              <h2>Phase de la séance</h2>
              <PhaseControl phase={data.phase} onSet={setPhase} busy={busy} />
              <p className="voters">{data.voters} {plural(data.voters, 'votant', 'votants')}</p>
              <p className="sub">Le compteur se met à jour toutes les 3 secondes.</p>
              <div className="actions">
                <button className={`btn danger ${armedReset ? 'arm' : ''}`} onClick={reset} disabled={busy}>
                  {armedReset ? 'Confirmer : effacer tous les votes' : 'Effacer tous les votes'}
                </button>
              </div>
            </div>
          </>
        )}
        {tab === 'decisions' && <Editor decisions={data.decisions} levels={data.levels} phase={data.phase} busy={busy} act={act} onPhase={setPhase} />}
        {tab === 'results' && (
          <>
            {data.phase !== 'resultats' && <div className="note">Tu es seul à voir ces résultats. Passe en phase Résultats depuis l'onglet Séance quand tout le monde a voté.</div>}
            <Results decisions={data.decisions} counts={data.counts} voters={data.voters} />
          </>
        )}
        {tab === 'levels' && (
          <LevelsRef
            levels={data.levels}
            edit={{
              state: data.phase !== 'preparation' ? 'phase' : data.levelsLocked ? 'votes' : 'editable',
              custom: data.levelsCustom,
              busy,
              onSave: next => act('curseur_set_levels', { p_levels: next }),
            }}
          />
        )}
      </div></main>
    </>
  )
}

function ConfigMissing() {
  return (
    <><Header /><main><div className="wrap">
      <div className="note error">L'application n'est pas reliée à Supabase. Renseigne VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (fichier .env en local, variables d'environnement sur Vercel), puis redéploie.</div>
    </div></main></>
  )
}

// ---------------------------------------------------------------------
export default function App() {
  const route = useRoute()
  if (!supabaseConfigured) return <ConfigMissing />
  if (route.name === 'vote') return <VotePage key={route.code} code={route.code} />
  if (route.name === 'admin') return <AdminPage key={route.code} code={route.code} adminKey={route.key} />
  return <Home />
}
