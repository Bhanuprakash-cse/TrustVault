
import { useEffect, useState } from 'react'
import './App.css'

const API = '/api'

function App() {
  const [mode, setMode] = useState('login')
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('trustvault_user'))
    } catch {
      return null
    }
  })
  const [token, setToken] = useState(
    () => sessionStorage.getItem('trustvault_token') || '',
  )
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const [documents, setDocuments] = useState([])
  const [search, setSearch] = useState('')
  const [file, setFile] = useState(null)
  const [documentName, setDocumentName] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [auditLogs, setAuditLogs] = useState([])
  const [auditResult, setAuditResult] = useState('all')
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setLoading(true)

    const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
    const body =
      mode === 'login' ? { email, password } : { name, email, password }

    try {
      const response = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.message || 'Request failed.')

      if (mode === 'register') {
        setMode('login')
        setPassword('')
        setMessage('Account created successfully. Please log in.')
      } else {
        sessionStorage.setItem('trustvault_token', data.token)
        sessionStorage.setItem('trustvault_user', JSON.stringify(data.user))
        setToken(data.token)
        setUser(data.user)
        setMessage('')
      }
    } catch (error) {
      setMessage(error.message || 'Could not connect to the server.')
    } finally {
      setLoading(false)
    }
  }

  async function loadDocuments(query = '') {
    if (!token) return

    setBusy(true)
    setMessage('')

    try {
      const endpoint = query.trim()
        ? `/documents/search?q=${encodeURIComponent(query.trim())}`
        : null

      if (!endpoint) {
        setDocuments([])
        setMessage('Enter a search term to find your documents.')
        return
      }

      const response = await fetch(`${API}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      if (response.status === 401) {
        logout()
        throw new Error('Your session expired. Please log in again.')
      }
      if (!response.ok) throw new Error(data.message || 'Search failed.')

      setDocuments(data.documents || [])
      setMessage(`${data.count ?? 0} document(s) found.`)
    } catch (error) {
      setMessage(error.message || 'Could not load documents.')
    } finally {
      setBusy(false)
    }
  }


  async function loadAuditLogs() {
  if (!token || user?.role !== 'admin') return

  setAuditLoading(true)
  setAuditError('')

  try {
    const params = new URLSearchParams({ limit: '20' })

    if (auditResult !== 'all') {
      params.set('result', auditResult)
    }

    const response = await fetch(
      `${API}/admin/audit-logs?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )

    const data = await response.json()

    if (response.status === 401) {
      logout()
      throw new Error('Your session expired. Please log in again.')
    }

    if (!response.ok) {
      throw new Error(data.message || 'Could not load audit logs.')
    }

    setAuditLogs(data.logs || [])
  } catch (error) {
    setAuditError(error.message || 'Could not load audit logs.')
  } finally {
    setAuditLoading(false)
  }
}

useEffect(() => {
  if (user?.role === 'admin' && token) {
    loadAuditLogs()
  }
}, [user, token, auditResult])


  async function uploadDocument(event) {
    event.preventDefault()
    if (!file) {
      setMessage('Please choose a file first.')
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', documentName.trim())
    formData.append('category', category.trim())

    setBusy(true)
    setMessage('')

    try {
      const response = await fetch(`${API}/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const data = await response.json()

      if (response.status === 401) {
        logout()
        throw new Error('Your session expired. Please log in again.')
      }
      if (!response.ok) throw new Error(data.message || 'Upload failed.')

      setMessage('Document uploaded successfully!')
      setFile(null)
      setDocumentName('')
      setCategory('')
      event.target.reset()
      if (search.trim()) await loadDocuments(search)
    } catch (error) {
      setMessage(error.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadDocument(document) {
    setBusy(true)
    setMessage('')

    try {
      const response = await fetch(
        `${API}/documents/${document.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      if (response.status === 401) {
        logout()
        throw new Error('Your session expired. Please log in again.')
      }
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Download failed.')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.name || `document-${document.id}`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`Downloaded "${document.name}".`)
    } catch (error) {
      setMessage(error.message || 'Download failed.')
    } finally {
      setBusy(false)
    }
  }

  function logout() {
    sessionStorage.removeItem('trustvault_token')
    sessionStorage.removeItem('trustvault_user')
    setToken('')
    setUser(null)
    setDocuments([])
    setMessage('')
    setMode('login')
  }

  if (user && token) {
    return (
      <main className="dashboard-page">
        <header className="topbar">
          <div className="dashboard-brand">
            <span className="brand-icon small">TV</span>
            <span>TrustVault</span>
          </div>
          <div className="user-controls">
            <span>{user.name}</span>
            <span className="role-label">{user.role}</span>
            <button className="secondary-button" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <section className="dashboard-content">
          <div className="welcome-section">
            <p className="eyebrow">SECURE DOCUMENT WORKSPACE</p>
            <h1>Welcome, {user.name}!</h1>
            <p>Upload, find, and securely download your documents.</p>
          </div>

          {message && <p className="dashboard-message" role="status">{message}</p>}

          <div className="dashboard-grid">
            <section className="panel">
              <h2>Upload a document</h2>
              <p className="panel-description">PDF, TXT, JPEG, or PNG · Max 5 MB</p>
              <form className="upload-form" onSubmit={uploadDocument}>
                <label>
                  Document file
                  <input
                    type="file"
                    accept=".pdf,.txt,.jpg,.jpeg,.png,application/pdf,text/plain,image/jpeg,image/png"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                    required
                  />
                </label>
                <label>
                  Document name
                  <input
                    value={documentName}
                    onChange={(event) => setDocumentName(event.target.value)}
                    placeholder="Optional document name"
                    maxLength={255}
                  />
                </label>
                <label>
                  Category
                  <input
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    placeholder="e.g. Resume, Reports"
                    maxLength={100}
                  />
                </label>
                <button className="primary-button" disabled={busy} type="submit">
                  {busy ? 'Please wait...' : 'Upload securely'}
                </button>
              </form>
            </section>

            <section className="panel">
              <h2>Find your documents</h2>
              <p className="panel-description">
                Search by document name or category.
              </p>
              <form
                className="search-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  loadDocuments(search)
                }}
              >
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search documents..."
                  maxLength={100}
                  required
                />
                <button className="primary-button" disabled={busy} type="submit">
                  Search
                </button>
              </form>

              <div className="document-list">
                {documents.map((document) => (
                  <article className="document-item" key={document.id}>
                    <div className="document-info">
                      <strong>{document.name}</strong>
                      <span>
                        {document.category || 'Uncategorized'} ·{' '}
                        {document.mime_type || 'File'}
                      </span>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => downloadDocument(document)}
                    >
                      Download
                    </button>
                  </article>
                ))}
                {documents.length === 0 && (
                  <p className="empty-state">
                    Search for a document to see matching results.
                  </p>
                )}
              </div>
            </section>
          </div>

          
{user.role === 'admin' && (
  <section className="panel admin-panel">
    <h2>Audit Activity</h2>
    <p className="panel-description">
      Review recent document access and security events.
    </p>

    <div className="search-form">
      <label>
        Filter by result
        <select
          value={auditResult}
          onChange={(event) => setAuditResult(event.target.value)}
        >
          <option value="all">All events</option>
          <option value="success">Successful</option>
          <option value="denied">Denied</option>
        </select>
      </label>

      <button
        type="button"
        className="secondary-button"
        onClick={loadAuditLogs}
        disabled={auditLoading}
      >
        {auditLoading ? 'Loading...' : 'Refresh logs'}
      </button>
    </div>

    {auditError && (
      <p className="dashboard-message" role="alert">
        {auditError}
      </p>
    )}

    {!auditError && (
      <p className="panel-description">
        {auditLoading
          ? 'Loading audit events...'
          : `${auditLogs.length} event(s) shown`}
      </p>
    )}

    <div className="audit-list">
      {auditLogs.map((log) => (
        <article className="audit-item" key={log.id}>
          <div className="audit-heading">
            <strong>{log.action || 'Unknown action'}</strong>
            <span
              className={`audit-result ${
                log.result === 'denied' ? 'denied' : 'success'
              }`}
            >
              {log.result || 'unknown'}
            </span>
          </div>

          <p>
            User ID: {log.actor_user_id ?? 'N/A'}
            {' · '}
            Document ID: {log.document_id ?? 'N/A'}
          </p>

          <p className="audit-details">
            Details: {typeof log.details === 'string'
              ? log.details
              : JSON.stringify(log.details ?? {})}
          </p>

          <small>
            {log.created_at
              ? new Date(log.created_at).toLocaleString()
              : 'Timestamp unavailable'}
          </small>
        </article>
      ))}

      {!auditLoading && !auditError && auditLogs.length === 0 && (
        <p className="empty-state">
          No audit events found for this filter.
        </p>
      )}
    </div>
  </section>
)}


          <p className="footer-note">
            TrustVault · Access-controlled documents · Audit trail enabled
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-icon">TV</div>
        <h1>TrustVault</h1>
        <p className="subtitle">Secure document sharing with a real audit trail.</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => { setMode('login'); setMessage('') }}
          >
            Login
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => { setMode('register'); setMessage('') }}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              Full name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                autoComplete="name"
                required
              />
            </label>
          )}
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
              maxLength={72}
              required
            />
          </label>
          {message && <p className="status-message" role="status">{message}</p>}
          <button className="submit-button" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in securely' : 'Create account'}
          </button>
        </form>
        <p className="security-note">🔒 Your documents are protected by authenticated access.</p>
      </section>
    </main>
  )
}

export default App
