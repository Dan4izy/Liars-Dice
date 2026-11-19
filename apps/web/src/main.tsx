import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom'
import { createAuthClient } from 'better-auth/react'
import { ru } from './ru'
import styles from './screen.module.css'

const auth = createAuthClient()
type Profile = { id: string; name: string; email: string }
type Mode = 'signIn' | 'signUp' | 'resetRequest' | 'resend' | 'reset'
const pips = {
  five: ['tl', 'tr', 'center', 'bl', 'br'],
  two: ['tl', 'br'],
} as const

async function getProfile(): Promise<Profile | null> {
  const result = await fetch('/api/me', { cache: 'no-store' })
  if (result.status === 401) return null
  if (!result.ok) throw new Error('Profile unavailable')
  return (await result.json()).profile
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const invite = /^\/r\/([A-Za-z0-9]{8})$/.exec(location.pathname)?.[1]
  const callbackURL = invite ? '/r/' + invite : '/'
  const resetToken = new URLSearchParams(location.search).get('token')
  const [mode, setMode] = useState<Mode>(location.pathname === '/reset' ? 'reset' : 'signIn')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [checking, setChecking] = useState(true)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(new URLSearchParams(location.search).has('error') ? ru.invalidToken : '')
  const [email, setEmail] = useState('')

  useEffect(() => {
    let disposed = false
    getProfile().then(value => { if (!disposed) setProfile(value) })
      .catch(() => { if (!disposed) setError(ru.genericError) })
      .finally(() => { if (!disposed) setChecking(false) })
    return () => { disposed = true }
  }, [])

  function changeMode(next: Mode) {
    setMode(next)
    setNotice('')
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = new FormData(event.currentTarget)
    const password = String(input.get('password') ?? '')
    setPending(true)
    setNotice('')
    setError('')
    try {
      const response = await (mode === 'signIn' ? auth.signIn.email({ email, password, callbackURL })
        : mode === 'signUp' ? auth.signUp.email({ name: String(input.get('name')), email, password, callbackURL })
        : mode === 'resend' ? auth.sendVerificationEmail({ email, callbackURL })
        : mode === 'resetRequest' ? auth.requestPasswordReset({ email, redirectTo: '/reset' })
        : auth.resetPassword({ newPassword: password, token: resetToken ?? '' }))
      if (response.error) {
        const { code, status } = response.error
        setError(ru.errors[code ?? ''] ?? (status === 429 ? ru.errors.TOO_MANY_REQUESTS : ru.genericError))
        return
      }
      if (mode === 'signIn') {
        const user = await getProfile()
        if (!user) throw new Error('Session unavailable')
        setProfile(user)
      } else if (mode === 'reset') {
        setProfile(null)
        setMode('signIn')
        setNotice(ru.resetDone)
        navigate('/', { replace: true })
      } else {
        setNotice(mode === 'resetRequest' ? ru.resetSent : ru.verifySent)
      }
    } catch {
      setError(ru.genericError)
    } finally {
      setPending(false)
    }
  }

  async function logout() {
    setPending(true)
    setError('')
    try {
      const { error } = await auth.signOut()
      if (error) throw new Error('Logout failed')
      setProfile(null)
      changeMode('signIn')
    } catch {
      setError(ru.genericError)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className={styles.layout}>
      <section className={styles.intro} aria-labelledby="brand">
        <div className={styles.dice} aria-hidden="true">
          {Object.entries(pips).map(([face, dots]) => (
            <span key={face} className={styles[face as keyof typeof pips]}>
              {dots.map(dot => <i key={dot} className={styles[dot]} />)}
            </span>
          ))}
        </div>
        <h1 id="brand">{ru.brand}</h1>
        <p className={styles.tagline}>{ru.tagline}</p>
        <p className={styles.rules}>{ru.rules}</p>
      </section>
      <section className={styles.card} aria-labelledby="account-title">
        <h2 id="account-title">{checking ? ru.checking : profile && mode !== 'reset' ? ru.profile : ru[mode]}</h2>
        {invite && <p className={styles.invite}>{ru.invite} <strong>{invite}</strong></p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
        {!checking && (profile && mode !== 'reset' ? (
          <div className={styles.profile}>
            <strong>{profile.name}</strong>
            <span>{profile.email}</span>
            <span className={styles.notice}>{ru.verified}</span>
            <button disabled={pending} onClick={logout}>{ru.logout}</button>
          </div>
        ) : (
          <>
            <form key={mode} onSubmit={submit}>
              {mode === 'signUp' && <label>{ru.name}<input name="name" required minLength={2} maxLength={48} autoComplete="nickname" /></label>}
              {mode !== 'reset' && <label>{ru.email}<input type="email" name="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>}
              {(mode === 'signIn' || mode === 'signUp' || mode === 'reset') && (
                <label>{mode === 'reset' ? ru.newPassword : ru.password}
                  <input type="password" name="password" required minLength={8} maxLength={128}
                    autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} />
                </label>
              )}
              <button disabled={pending || (mode === 'reset' && !resetToken)}>
                {pending ? ru.submitting : mode === 'resend' || mode === 'resetRequest' ? ru.send : ru[mode]}
              </button>
            </form>
            <div className={styles.links}>
              {mode !== 'signIn' && <button disabled={pending} onClick={() => {
                if (mode === 'reset') navigate('/', { replace: true })
                changeMode('signIn')
              }}>{ru.signIn}</button>}
              {mode === 'signIn' && <button disabled={pending} onClick={() => changeMode('signUp')}>{ru.signUp}</button>}
              {mode !== 'resetRequest' && <button disabled={pending} onClick={() => {
                if (mode === 'reset') navigate('/', { replace: true })
                changeMode('resetRequest')
              }}>{ru.resetRequest}</button>}
              {(mode === 'signIn' || mode === 'signUp') && <button disabled={pending} onClick={() => changeMode('resend')}>{ru.resend}</button>}
            </div>
          </>
        ))}
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>)
