import { useState } from 'react'
import axios from 'axios'
import './App.css'

function getVerificationInfo(verification) {
  if (verification?.is_verified) return { cardClass: 'verified', badgeClass: 'badge-success', label: '✅ DOĞRULANDI' };
  if (verification?.found_metadata) return { cardClass: 'mismatch', badgeClass: 'badge-warning', label: '⚠️ UYUŞMAZLIK' };
  return { cardClass: 'failed', badgeClass: 'badge-error', label: '❌ BULUNAMADI' };
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

function App() {
  const [activeTab, setActiveTab] = useState('file')
  const [file, setFile] = useState(null)
  const [textInput, setTextInput] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0]
    setFile(selectedFile || null)
    setError(null)
    setResult(null)
  }

  const handleTextChange = (e) => {
    setTextInput(e.target.value)
    setError(null)
    setResult(null)
  }

  const handleClearText = () => {
    setTextInput('')
    setError(null)
    setResult(null)
  }

  const formatFileSize = (bytes = 0) => {
    if (!bytes) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  const handleUpload = async () => {
    if (activeTab === 'file' && !file) {
      setError('Lütfen bir dosya seçin!')
      return
    }
    if (activeTab === 'text' && !textInput.trim()) {
      setError('Lütfen analiz edilecek metni girin!')
      return
    }
    if (activeTab === 'file' && file && file.size > 15 * 1024 * 1024) {
      setError('Dosya boyutu 15MB\'dan küçük olmalıdır!')
      return
    }

    setLoading(true)
    setResult(null)
    setError(null)

    const formData = new FormData()
    if (activeTab === 'file') {
      formData.append('file', file)
    } else {
      formData.append('text', textInput)
    }

    try {
      const response = await axios.post(`${API_BASE}/analyze`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000, // 10 dakika (28 atıf × ~15 saniye = 7+ dakika)
      })
      setResult(response.data.data)
    } catch (err) {
      let msg = 'Sunucu hatası! Backend çalışıyor mu?'
      if (err.code === 'ECONNABORTED') msg = 'İşlem zaman aşımına uğradı.'
      else if (err.response?.data?.detail) msg = err.response.data.detail
      else if (err.response?.status === 404) msg = "API endpoint'i bulunamadı."
      else if (err.response?.status >= 500) msg = 'Sunucu iç hatası.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <header className="header">
        <h1>🔍 TÜBİTAK Atıf Doğrulayıcı</h1>
        <p>DOI, ISBN, ISSN, Web ve Gri Literatür Doğrulama</p>
      </header>

      <div className="main-card">
        <div className="tabs">
          <button
            className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
            onClick={() => { setActiveTab('file'); setError(null); }}
            disabled={loading}
          >
            📁 Dosya Yükle
          </button>
          <button
            className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
            onClick={() => { setActiveTab('text'); setError(null); }}
            disabled={loading}
          >
            ✍️ Metin Gir
          </button>
        </div>

        <div className="upload-section">
          {activeTab === 'file' ? (
            <div className="file-input-wrapper">
              <input
                className="file-input"
                type="file"
                accept=".pdf,.docx"
                onChange={handleFileChange}
                disabled={loading}
              />
              <p className="hint">📎 PDF, DOCX (Max 15MB)</p>
              {file && (
                <div className="file-info">
                  <span className="file-name">✓ {file.name}</span>
                  <span className="file-size">({formatFileSize(file.size)})</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-input-wrapper">
              <textarea
                className="text-input"
                rows="10"
                placeholder="Kaynakça metnini buraya yapıştırın..."
                value={textInput}
                onChange={handleTextChange}
                disabled={loading}
              />
              <div className="text-info">
                <span>Karakter: {textInput.length}</span>
                {textInput.length > 0 && (
                  <button className="link-btn" onClick={handleClearText} disabled={loading}>
                    Temizle
                  </button>
                )}
              </div>
            </div>
          )}

          <button
            className="upload-btn"
            onClick={handleUpload}
            disabled={loading || (activeTab === 'file' ? !file : !textInput.trim())}
          >
            {loading ? '⏳ Analiz Ediliyor...' : '🚀 Analizi Başlat'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-msg">
          <span>❌ {error}</span>
          <button style={{marginLeft:10, background:'transparent', border:'none', cursor:'pointer'}} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {result && (
        <div className="results-area">
          <div className="summary-card">
            <h2>📄 {result.title}</h2>
            <div className="stats">
              <div className="stat-item">
                <span className="stat-label">Yöntem:</span>
                <span className="stat-value">{result.method || 'N/A'}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Toplam:</span>
                <span className="stat-value">{result.citation_count || 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Doğrulanan:</span>
                <span className="stat-value" style={{color:'var(--success)'}}>{result.verified_count || 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Başarı:</span>
                <span className="stat-value">%{result.success_rate || 0}</span>
              </div>
            </div>
          </div>

          {result.citations && result.citations.length > 0 ? (
            <div className="citations-list">
              {result.citations.map((cite, idx) => {
                const verInfo = getVerificationInfo(cite.verification);
                return (
                <div key={cite.doi || cite.title || idx} className={`citation-card ${verInfo.cardClass}`}>
                  <div className="citation-header">
                    <span className={`badge ${verInfo.badgeClass}`}>
                      {verInfo.label}
                    </span>
                    {cite.verification?.source && <span className="source-tag">📍 {cite.verification.source}</span>}
                  </div>
                  <h3 className="citation-title">{cite.title || 'Başlık Bulunamadı'}</h3>
                  <p className="citation-authors">
                    👤 {cite.authors?.length ? cite.authors.join(', ') : 'Yazar Bilgisi Yok'}
                  </p>
                  <div className="meta-info">
                    {cite.year && <span className="meta-tag">📅 {cite.year}</span>}
                    {cite.journal && <span className="meta-tag">📖 {cite.journal}</span>}
                  </div>
                  {cite.verification?.url && (
                    <a href={cite.verification.url} target="_blank" rel="noreferrer" className="link-btn">
                      🔗 Kaynağa Git ↗
                    </a>
                  )}
                  {cite.verification?.note && <div className="note-box">ℹ️ {cite.verification.note}</div>}

                  {/* metadata karşılaştırma */}
                  {cite.verification?.found_metadata && (
                    <details className="metadata-comparison">
                      <summary>🔍 Metadata Karşılaştırması (Verilen vs Bulunan)</summary>
                      <table className="comparison-table">
                        <thead>
                          <tr>
                            <th>Alan</th>
                            <th>Verilen Künye</th>
                            <th>Bulunan Makale</th>
                            <th>Durum</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td><strong>Başlık</strong></td>
                            <td>{cite.title}</td>
                            <td>{cite.verification.found_metadata.title}</td>
                            <td>{cite.title === cite.verification.found_metadata.title ? '✅' : '⚠️'}</td>
                          </tr>
                          <tr>
                            <td><strong>Dergi</strong></td>
                            <td>{cite.journal || 'Belirtilmemiş'}</td>
                            <td>{cite.verification.found_metadata.journal || 'Bilinmiyor'}</td>
                            <td>{cite.journal && cite.verification.found_metadata.journal && cite.journal.toLowerCase().includes(cite.verification.found_metadata.journal.toLowerCase().slice(0,10)) ? '✅' : '⚠️'}</td>
                          </tr>
                          <tr>
                            <td><strong>Yıl</strong></td>
                            <td>{cite.year || 'Belirtilmemiş'}</td>
                            <td>{cite.verification.found_metadata.year || 'Bilinmiyor'}</td>
                            <td>{cite.year == cite.verification.found_metadata.year ? '✅' : '⚠️'}</td>
                          </tr>
                          {cite.verification.found_metadata.authors && (
                            <tr>
                              <td><strong>Yazarlar</strong></td>
                              <td>{cite.authors?.join(', ') || 'Belirtilmemiş'}</td>
                              <td>{cite.verification.found_metadata.authors.join(', ')}</td>
                              <td>-</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </details>
                  )}
                </div>
                );
              })}
            </div>
          ) : (
            <div className="no-citations">Atıf bulunamadı.</div>
          )}

          {result.extraction_logs && (
            <div className="logs-section">
              <div className="logs-header">🛠️ SİSTEM TARAMA VE AYIKLAMA GÜNLÜĞÜ (DEBUG LOGS)</div>
              <table className="log-table">
                <thead>
                  <tr>
                    <th style={{width: '5%'}}>#</th>
                    <th style={{width: '40%'}}>Ham Girdi (Raw Text)</th>
                    <th style={{width: '30%'}}>Ayıklanan Veri (Parsed)</th>
                    <th style={{width: '25%'}}>Doğrulama</th>
                  </tr>
                </thead>
                <tbody>
                  {result.extraction_logs.map((log) => (
                    <tr key={log.id}>
                      <td>{log.id}</td>
                      <td className="log-raw">"{log.raw_input}"</td>
                      <td>
                        <div className="log-parsed">Başlık: {log.extracted_title}</div>
                        <div style={{color:'#ffeaa7'}}>Yazarlar: {log.extracted_authors.join(", ")}</div>
                      </td>
                      <td>
                        <span style={{color: log.verification_status === 'BAŞARILI' ? '#55efc4' : '#ff7675'}}>
                          {log.verification_status}
                        </span>
                        <br/>
                        <span style={{fontSize:'10px', opacity:0.7}}>Via: {log.verification_source}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="spinner-large"></div>
          <p>Belge analiz ediliyor...</p>
        </div>
      )}
    </div>
  )
}

export default App