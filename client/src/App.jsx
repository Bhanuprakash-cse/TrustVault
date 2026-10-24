
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

  const [adminStats, setAdminStats] = useState(null)
  const [adminDocuments, setAdminDocuments] = useState([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminBusyId, setAdminBusyId] = useState(null)
  const [viewers, setViewers] = useState([])
  const [sharingDocumentId, setSharingDocumentId] = useState(null)
  const [documentPermissions, setDocumentPermissions] = useState([])
  const [selectedViewerId, setSelectedViewerId] = useState('')
  const [selectedPermission, setSelectedPermission] = useState('read')
  const [sharingBusy, setSharingBusy] = useState(false)
  const [sharingError, setSharingError] = useState('')

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
    const trimmedQuery = query.trim()
    const endpoint = trimmedQuery
      ? `/documents/search?q=${encodeURIComponent(trimmedQuery)}`
      : '/documents'

    const response = await fetch(`${API}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()

    if (response.status === 401) {
      logout()
      throw new Error('Your session expired. Please log in again.')
    }

    if (!response.ok) {
      throw new Error(data.message || 'Could not load documents.')
    }

    setDocuments(data.documents || [])
    setMessage(
      trimmedQuery
        ? `${data.count ?? 0} document(s) found.`
        : `${data.count ?? 0} document(s) available.`
    )
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


async function loadAdminData() {
  if (!token || user?.role !== 'admin') return

  setAdminLoading(true)
  setAdminError('')

  try {
    const headers = { Authorization: `Bearer ${token}` }

    const [statsResponse, documentsResponse] = await Promise.all([
      fetch(`${API}/admin/dashboard`, { headers }),
      fetch(`${API}/admin/documents`, { headers }),
    ])

    if (statsResponse.status === 401 || documentsResponse.status === 401) {
      logout()
      throw new Error('Your session expired. Please log in again.')
    }

    const statsData = await statsResponse.json()
    const documentsData = await documentsResponse.json()

    if (!statsResponse.ok) {
      throw new Error(statsData.message || 'Could not load dashboard.')
    }

    if (!documentsResponse.ok) {
      throw new Error(documentsData.message || 'Could not load documents.')
    }

    setAdminStats(statsData.stats)
    setAdminDocuments(documentsData.documents || [])
  } catch (error) {
    setAdminError(error.message || 'Could not load admin data.')
  } finally {
    setAdminLoading(false)
  }
}

async function downloadAdminDocument(document) {
  setAdminBusyId(document.id)
  setAdminError('')

  try {
    const response = await fetch(
      `${API}/admin/documents/${document.id}/download`,
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
    window.document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    setAdminError(error.message || 'Download failed.')
  } finally {
    setAdminBusyId(null)
  }
}

async function deleteAdminDocument(document) {
  const confirmed = window.confirm(
    `Permanently delete "${document.name}"? This cannot be undone.`,
  )

  if (!confirmed) return

  setAdminBusyId(document.id)
  setAdminError('')

  try {
    const response = await fetch(
      `${API}/admin/documents/${document.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    )

    if (response.status === 401) {
      logout()
      throw new Error('Your session expired. Please log in again.')
    }

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Document deletion failed.')
    }

    setMessage(`Deleted "${document.name}".`)
    await loadAdminData()
    await loadAuditLogs()
  } catch (error) {
    setAdminError(error.message || 'Document deletion failed.')
  } finally {
    setAdminBusyId(null)
  }
}



async function loadViewers() {
  setSharingError('')

  try {
    const response = await fetch(`${API}/admin/viewers`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Could not load viewers.')
    }

    setViewers(data.viewers || [])
  } catch (error) {
    setSharingError(error.message || 'Could not load viewers.')
  }
}

async function loadDocumentPermissions(documentId) {
  setSharingDocumentId(documentId)
  setDocumentPermissions([])
  setSelectedViewerId('')
  setSelectedPermission('read')
  setSharingError('')
  setSharingBusy(true)

  try {
    const response = await fetch(
      `${API}/admin/documents/${documentId}/permissions`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Could not load permissions.')
    }

    setDocumentPermissions(data.permissions || [])
    await loadViewers()
  } catch (error) {
    setSharingError(error.message || 'Could not load permissions.')
  } finally {
    setSharingBusy(false)
  }
}

async function grantDocumentPermission(event) {
  event.preventDefault()

  if (!sharingDocumentId || !selectedViewerId) {
    setSharingError('Please select a viewer.')
    return
  }

  setSharingBusy(true)
  setSharingError('')

  try {
    const response = await fetch(
      `${API}/documents/${sharingDocumentId}/permissions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: Number(selectedViewerId),
          permission: selectedPermission,
        }),
      },
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Could not grant permission.')
    }

    setMessage('Document permission saved successfully.')
    await loadDocumentPermissions(sharingDocumentId)
  } catch (error) {
    setSharingError(error.message || 'Could not grant permission.')
  } finally {
    setSharingBusy(false)
  }
}

async function revokeDocumentPermission(userId) {
  if (!sharingDocumentId) return

  if (!window.confirm('Revoke this viewerâ€™s document access?')) return

  setSharingBusy(true)
  setSharingError('')

  try {
    const response = await fetch(
      `${API}/documents/${sharingDocumentId}/permissions/${userId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    )

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'Could not revoke permission.')
    }

    setMessage('Document access revoked successfully.')
    await loadDocumentPermissions(sharingDocumentId)
  } catch (error) {
    setSharingError(error.message || 'Could not revoke permission.')
  } finally {
    setSharingBusy(false)
  }
}



useEffect(() => {
  if (!token || !user) return

  if (user.role === 'admin') {
    loadAdminData()
    loadAuditLogs()
  } else {
    loadDocuments()
  }
}, [user, token])




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
      await loadDocuments(search)
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
  <span className="brand-icon small" aria-hidden="true">
    <svg
      viewBox="0 0 24 24"
      width="23"
      height="23"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
      <rect x="9" y="10" width="6" height="5" rx="1" />
      <path d="M10 10V8a2 2 0 0 1 4 0v2" />
    </svg>
  </span>
  <span className="brand-name">TrustVault</span>
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
              <p className="panel-description">PDF, TXT, JPEG, or PNG Â· Max 5 MB</p>
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
                        {document.category || 'Uncategorized'} Â·{' '}
                        {document.mime_type || 'File'}
                      </span>
                    </div>


                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => downloadDocument(document)}
                      disabled={busy}
                    >
                      {busy ? 'Downloading...' : 'Download'}
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
  <>
    <section className="admin-stats">
      <article className="panel stat-card">
        <span>Total users</span>
        <h2>{adminStats?.totalUsers ?? 'â€”'}</h2>
      </article>

      <article className="panel stat-card">
        <span>Total documents</span>
        <h2>{adminStats?.totalDocuments ?? 'â€”'}</h2>
      </article>

      <article className="panel stat-card">
        <span>Audit events</span>
        <h2>{adminStats?.totalAuditEvents ?? 'â€”'}</h2>
      </article>

      <article className="panel stat-card">
        <span>Denied events</span>
        <h2>{adminStats?.deniedEvents ?? 'â€”'}</h2>
      </article>
    </section>

    <section className="panel admin-panel">
      <div className="admin-section-heading">
        <div>
          <h2>Document Management</h2>
          <p className="panel-description">
            View, download, and manage all stored documents.
          </p>
        </div>

        <button
          className="secondary-button"
          disabled={adminLoading}
          onClick={loadAdminData}
        >
          {adminLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {adminError && (
        <p className="dashboard-message" role="alert">
          {adminError}
        </p>
      )}

      {adminLoading && adminDocuments.length === 0 ? (
        <p className="empty-state">Loading documents...</p>
      ) : adminDocuments.length === 0 ? (
        <p className="empty-state">No documents found.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Owner</th>
                <th>Size</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {adminDocuments.map((document) => (
                <tr key={document.id}>
                  <td>
                    <strong>{document.name}</strong>
                    <small>
                      {document.category || 'Uncategorized'}
                    </small>
                  </td>

                  <td>
                    <span>{document.owner_name || 'Unknown'}</span>
                    <small>{document.owner_email || 'â€”'}</small>
                  </td>

                  <td>
                    {document.size_bytes == null
                      ? 'â€”'
                      : `${(Number(document.size_bytes) / 1024).toFixed(1)} KB`}
                  </td>

                  <td>
                    <div className="admin-actions">
                      <button
                        className="secondary-button"
                        disabled={adminBusyId !== null}
                        onClick={() => downloadAdminDocument(document)}
                      >
                        {adminBusyId === document.id
                          ? 'Working...'
                          : 'Download'}
                      </button>

                      <button
                        className="danger-button"
                        disabled={adminBusyId !== null}
                        onClick={() => deleteAdminDocument(document)}
                      >
                        Delete
                      </button>
                      <button
                      className="secondary-button"
                      disabled={adminBusyId !== null || sharingBusy}
                      onClick={() => loadDocumentPermissions(document.id)}
                    >
                      Share / Permissions
                    </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

{sharingDocumentId !== null && (
  <section className="panel admin-panel">
    <div className="admin-section-heading">
      <div>
        <h2>Document Sharing</h2>
        <p className="panel-description">
          Manage viewer access for document ID {sharingDocumentId}.
        </p>
      </div>

      <button
        className="secondary-button"
        onClick={() => setSharingDocumentId(null)}
      >
        Close
      </button>
    </div>

    {sharingError && (
      <p className="dashboard-message" role="alert">
        {sharingError}
      </p>
    )}

    <form className="upload-form" onSubmit={grantDocumentPermission}>
      <label>
        Viewer account
        <select
          value={selectedViewerId}
          onChange={(event) => setSelectedViewerId(event.target.value)}
          required
        >
          <option value="">Select a viewer</option>
          {viewers.map((viewer) => (
            <option key={viewer.id} value={viewer.id}>
              {viewer.name} â€” {viewer.email}
            </option>
          ))}
        </select>
      </label>

      <label>
        Permission level
        <select
          value={selectedPermission}
          onChange={(event) => setSelectedPermission(event.target.value)}
        >
          <option value="read">Read</option>
          <option value="edit">Edit</option>
        </select>
      </label>

      <button
        className="primary-button"
        type="submit"
        disabled={sharingBusy}
      >
        {sharingBusy ? 'Please wait...' : 'Grant / Update Access'}
      </button>
    </form>

    <h3>Current permissions</h3>

    {sharingBusy ? (
      <p className="empty-state">Loading permissions...</p>
    ) : documentPermissions.length === 0 ? (
      <p className="empty-state">No viewers currently have access.</p>
    ) : (
      <div className="document-list">
        {documentPermissions.map((permission) => (
          <article
            className="document-item"
            key={permission.user_id}
          >
            <div className="document-info">
              <strong>{permission.viewer_name}</strong>
              <span>{permission.viewer_email}</span>
              <span>Permission: {permission.permission}</span>
            </div>

            <button
              className="danger-button"
              disabled={sharingBusy}
              onClick={() => revokeDocumentPermission(permission.user_id)}
            >
              Revoke
            </button>
          </article>
        ))}
      </div>
    )}
  </section>
)}

  </>
)}



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
            {' Â· '}
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
            TrustVault Â· Access-controlled documents Â· Audit trail enabled
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
        <p className="security-note">ðŸ”’ Your documents are protected by authenticated access.</p>
      </section>
    </main>
  )
}

export default App
