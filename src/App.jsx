import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { rpc, supabaseConfigured } from './supabase'
import { LEVELS, DOMAINS, DECISIONS, TESTS } from './decisions'

// ⚠️ Tous les sous-composants sont définis HORS de App
// (sinon perte de focus à chaque re-rendu, comme sur jury-cqp).

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
const lv = n => `var(--l${n})`
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))
const plural = (n, s, p) => (n > 1 ? p : s)

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

function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      <div className="d">Directeur<small>niveaux 1 et 2</small></div>
      <div className="p">Président<small>niveaux 3 et 4</small></div>
      <div className="a">Associés<small>niveau 5</small></div>
    </div>
  )
}

function Rail({ decision, value, onPick }) {
  const fillStyle = value ? { width: `${(value - 1) * 20}%`, background: lv(value) } : { width: 0 }
  return (
    <div className="dec">
      <p className="q">{decision.label}</p>
      <div className="rail" role="radiogroup" aria-label={decision.label}>
        <span className="track" />
        <span className="fill" style={fillStyle} />
        {LEVELS.map(L => (
          <button
            key={L.n}
            type="button"
            className="stop"
            role="radio"
            aria-checked={value === L.n}
            aria-label={`Niveau ${L.n} : ${L.who}, ${L.title}`}
            style={{ '--lv': lv(L.n) }}
            onClick={() => onPick(decision.id, L.n)}
          >{L.n}</button>
        ))}
      </div>
      <p className="picked">
        {value ? <>Niveau {value} : <b>{LEVELS[value - 1].picked}</b></> : 'Pas encore de choix'}
      </p>
    </div>
  )
}

function DecisionList({ answers, onPick }) {
  return (
    <>
      <Legend />
      <h2>Les 6 décisions de l'atelier</h2>
      <p className="sub">Réponds au moins à celles-ci.</p>
      {TESTS.map(d => <Rail key={d.id} decision={d} value={answers[d.id]} onPick={onPick} />)}
      <details className="more">
        <summary>Toutes les autres décisions</summary>
        {DOMAINS.map(D => {
          const list = DECISIONS.filter(d => !d.test && d.domain === D.id)
          if (!list.length) return null
          return (
            <div key={D.id}>
              <h3>{D.name}</h3>
              {list.map(d => <Rail key={d.id} decision={d} value={answers[d.id]} onPick={onPick} />)}
            </div>
          )
        })}
      </details>
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
        <span>Proposé <b>{decision.prop}</b></span>
        {st.n > 0 && <span>Écart <b>{st.gap}</b> {plural(st.gap, 'niveau', 'niveaux')}</span>}
        {st.n > 0 && <span>{st.n} {plural(st.n, 'vote', 'votes')}</span>}
      </div>
    </div>
  )
}

function Results({ counts, voters }) {
  const [scope, setScope] = useState('tests')
  const [sortGap, setSortGap] = useState(true)
  const c = counts || {}

  let body
  if (!voters) {
    body = <div className="note quiet">Aucun vote pour l'instant.</div>
  } else if (sortGap) {
    const list = (scope === 'tests' ? TESTS : DECISIONS)
      .map(d => ({ d, s: stats(c[d.id]) }))
      .sort((a, b) => (b.s.gap - a.s.gap) || (b.s.n - a.s.n))
    body = list.map(({ d }) => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)
  } else if (scope === 'all') {
    body = (
      <>
        <h3>Décisions de l'atelier</h3>
        {TESTS.map(d => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)}
        {DOMAINS.map(D => (
          <div key={D.id}>
            <h3>{D.name}</h3>
            {DECISIONS.filter(d => !d.test && d.domain === D.id).map(d => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)}
          </div>
        ))}
      </>
    )
  } else {
    body = TESTS.map(d => <ResultCard key={d.id} decision={d} counts={c[d.id]} />)
  }

  return (
    <>
      <div className="toolbar">
        <span className="count">{voters} {plural(voters, 'votant', 'votants')}</span>
        <div className="seg" role="group" aria-label="Décisions affichées">
          <button aria-pressed={scope === 'tests'} onClick={() => setScope('tests')}>Atelier</button>
          <button aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Toutes</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={sortGap} onChange={e => setSortGap(e.target.checked)} /> Les plus partagées en premier
        </label>
      </div>
      <p className="key"><i /> niveau proposé dans la ventilation</p>
      {body}
    </>
  )
}

function LevelsRef() {
  return (
    <>
      <h2 style={{ marginTop: '.4rem' }}>Une personne, deux casquettes</h2>
      <div className="rule">
        <p className="test-q">« J'applique un cadre déjà validé, ou je fixe ce cadre ? »</p>
        <p>Appliquer le cadre (budget voté, plan de formation, grille tarifaire), c'est la casquette du directeur. Engager la SCOP au-delà de ce cadre, c'est la casquette du Président, avec les contrôles qui vont avec.</p>
      </div>
      <h2>Les 5 niveaux</h2>
      {LEVELS.map(L => (
        <div className="lvl" key={L.n} style={{ '--lv': lv(L.n) }}>
          <div className="num">{L.n}</div>
          <div><span className="who">{L.who}</span><h4>{L.title}</h4><p>{L.text}</p></div>
        </div>
      ))}
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
      const res = await rpc('curseur_create_session')
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
          <p className="sub">Crée une séance : tu obtiens un code et un QR code à projeter, et un lien animateur pour suivre et révéler les résultats.</p>
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
  const [answers, setAnswers] = useState({})
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState(null)
  const token = useRef(getVoterToken(code))

  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const info = await rpc('curseur_session_info', { p_code: code })
        if (cancel) return
        if (!info.exists) { setStatus('missing'); return }
        const mine = await rpc('curseur_my_vote', { p_code: code, p_token: token.current })
        if (cancel) return
        if (mine) { setAnswers({ ...mine }); setSaved({ ...mine }) }
        setStatus('ok')
      } catch (err) {
        if (!cancel) { setError(err.message); setStatus('error') }
      }
    })()
    return () => { cancel = true }
  }, [code])

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
  }, [])

  const save = async () => {
    setSaving(true); setError('')
    try {
      const snapshot = { ...answers }
      await rpc('curseur_cast_vote', { p_code: code, p_token: token.current, p_answers: snapshot })
      setSaved(snapshot)
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

  const t = TESTS.filter(d => answers[d.id]).length
  const all = DECISIONS.filter(d => answers[d.id]).length
  const unchanged = sameAnswers(answers, saved)
  let barText = `${t} / ${TESTS.length} décisions de l'atelier${all > t ? `, ${all - t} ${plural(all - t, 'autre', 'autres')}` : ''}`
  if (error) barText = error
  else if (saving) barText = 'Enregistrement…'
  else if (unchanged && all) barText = 'Ton vote est enregistré'

  return (
    <>
      <Header lede={`Séance ${code}. Ton vote est anonyme : seuls les totaux sont affichés, et tu peux le modifier jusqu'à la fin.`} />
      <Tabs
        tabs={[{ id: 'vote', label: 'Voter' }, { id: 'results', label: 'Résultats' }, { id: 'levels', label: 'Les 5 niveaux' }]}
        active={tab}
        onChange={id => { setTab(id); window.scrollTo(0, 0) }}
      />
      <main><div className="wrap">
        {tab === 'vote' && <DecisionList answers={answers} onPick={onPick} />}
        {tab === 'results' && (
          !results ? <p className="sub">Chargement…</p>
          : results.counts
            ? <Results counts={results.counts} voters={results.voters} />
            : <div className="note quiet">{results.voters} {plural(results.voters, 'associé a voté', 'associés ont voté')}. Les résultats s'afficheront ici quand l'animateur les révélera.</div>
        )}
        {tab === 'levels' && <LevelsRef />}
      </div></main>
      {tab === 'vote' && (
        <div className="bar-bottom"><div className="wrap">
          <p>{barText}</p>
          <button className="btn" onClick={save} disabled={!all || saving || unchanged}>
            {saved ? 'Mettre à jour mon vote' : 'Enregistrer mon vote'}
          </button>
        </div></div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------
// Page animateur
// ---------------------------------------------------------------------
function AdminPage({ code, adminKey }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [armed, setArmed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState('session')
  const armTimer = useRef(null)
  const url = joinUrl(code)

  const load = useCallback(async () => {
    try { setData(await rpc('curseur_results', { p_code: code, p_admin_key: adminKey || null })) }
    catch (err) { setError(err.message) }
  }, [code, adminKey])
  usePolling(load, 3000, true)

  const toggleReveal = async () => {
    try { await rpc('curseur_set_reveal', { p_code: code, p_admin_key: adminKey, p_revealed: !data.revealed }); load() }
    catch (err) { setError(err.message) }
  }

  const reset = async () => {
    if (!armed) {
      setArmed(true)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setArmed(false), 4000)
      return
    }
    setArmed(false)
    try { await rpc('curseur_reset', { p_code: code, p_admin_key: adminKey }); load() }
    catch (err) { setError(err.message) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* rien */ }
  }

  if (!data) return <><Header title="Animation" /><main><div className="wrap">{error ? <div className="note error">{error}</div> : <p className="sub">Chargement…</p>}</div></main></>
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
      <Header title="Animation" lede="Garde ce lien pour toi : c'est lui qui permet de suivre et de révéler les résultats." />
      <Tabs
        tabs={[{ id: 'session', label: 'Séance' }, { id: 'results', label: 'Résultats' }, { id: 'levels', label: 'Les 5 niveaux' }]}
        active={tab}
        onChange={id => { setTab(id); window.scrollTo(0, 0) }}
      />
      <main><div className="wrap">
        {error && <div className="note error">{error}</div>}
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
              <p className="voters">{data.voters} {plural(data.voters, 'votant', 'votants')}</p>
              <p className="sub">Le compteur se met à jour toutes les 3 secondes.</p>
              <div className="actions">
                <button className={`btn ${data.revealed ? 'ghost' : ''}`} onClick={toggleReveal}>
                  {data.revealed ? 'Masquer les résultats aux associés' : 'Révéler les résultats à tous'}
                </button>
                <button className={`btn danger ${armed ? 'arm' : ''}`} onClick={reset}>
                  {armed ? 'Confirmer : effacer tous les votes' : 'Effacer tous les votes'}
                </button>
              </div>
            </div>
          </>
        )}
        {tab === 'results' && (
          <>
            {!data.revealed && <div className="note">Tu es seul à voir ces résultats. Révèle-les depuis l'onglet Séance quand tout le monde a voté.</div>}
            <Results counts={data.counts} voters={data.voters} />
          </>
        )}
        {tab === 'levels' && <LevelsRef />}
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
