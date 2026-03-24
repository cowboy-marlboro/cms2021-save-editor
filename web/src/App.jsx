import { useState, useCallback } from 'react'
import DropZone from './components/DropZone.jsx'
import Overview from './components/Overview.jsx'
import Garage from './components/Garage.jsx'
import Parts from './components/Parts.jsx'
import { decode, parseStats, parseGarage, parseSkills, flattenParts, applyEdits } from './codec.js'

const TABS = ['Overview', 'Garage', 'Parts']

export default function App() {
  const [decoded, setDecoded]       = useState(null)
  const [stats, setStats]           = useState(null)
  const [origStats, setOrigStats]   = useState(null)
  const [parts, setParts]           = useState([])
  const [garage, setGarage]         = useState([])
  const [activeTab, setActiveTab]   = useState(0)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [filename, setFilename]     = useState('profile0.cms21b')

  const handleFile = useCallback(async (file) => {
    setLoading(true)
    setError(null)
    setFilename(file.name)
    try {
      const buffer = await file.arrayBuffer()
      const save   = decode(buffer)
      const data   = {
        save,
        header: save.header,
        stats:  parseStats(save),
        skills: parseSkills(save),
        garage: parseGarage(save),
        parts:  flattenParts(save),
      }
      setDecoded(data)
      setStats({ ...data.stats })
      setOrigStats({ ...data.stats })
      setParts(data.parts.map(p => ({ ...p, _orig: p.condition })))
      setGarage(data.garage.map(g => ({ ...g, _orig: g.state })))
      setActiveTab(0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDownload = useCallback(() => {
    if (!decoded) return
    setDownloading(true)
    setError(null)

    const partEdits = parts
      .filter(p => p.has_condition && p.condition !== p._orig)
      .map(p => ({ sec_idx: p.sec_idx, part_idx: p.part_idx, condition: p.condition }))

    const garageEdits = garage
      .filter(g => g.state !== g._orig)
      .map((g, idx) => ({ idx, state: g.state }))

    try {
      const binary = applyEdits(decoded.save, { stats, partEdits, garageEdits })
      const blob   = new Blob([binary], { type: 'application/octet-stream' })
      const url    = URL.createObjectURL(blob)
      const a      = document.createElement('a')
      a.href       = url
      a.download   = filename
      a.click()
      URL.revokeObjectURL(url)

      setParts(prev  => prev.map(p => ({ ...p, _orig: p.condition })))
      setGarage(prev => prev.map(g => ({ ...g, _orig: g.state })))
      setOrigStats({ ...stats })
    } catch (e) {
      setError(e.message)
    } finally {
      setDownloading(false)
    }
  }, [decoded, stats, parts, garage, filename])

  const isDirty = decoded && (
    (stats && origStats && (
      stats.money !== origStats.money ||
      stats.level !== origStats.level ||
      stats.xp    !== origStats.xp
    )) ||
    parts.some(p  => p.has_condition && p.condition !== p._orig) ||
    garage.some(g => g.state !== g._orig)
  )

  if (!decoded) {
    return <DropZone onFile={handleFile} loading={loading} error={error} />
  }

  const hdr = decoded.header

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">CMS21 Save Editor</span>
          <span className="topbar-profile">{hdr.profile_name}</span>
          <span className="topbar-meta">
            {hdr.save_year}-{String(hdr.save_month).padStart(2, '0')}
            {hdr.version ? ` · v${hdr.version}` : ''}
          </span>
          {isDirty && <span className="dirty-badge">● Unsaved changes</span>}
        </div>
        <div className="topbar-right">
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDecoded(null)
              setStats(null)
              setOrigStats(null)
              setParts([])
              setGarage([])
              setError(null)
            }}
          >
            Open another file
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Saving…' : '↓ Download .cms21b'}
          </button>
        </div>
      </header>

      {error && (
        <div className="global-error">
          <strong>Error:</strong> {error}
          <button className="error-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={`tab-btn${activeTab === i ? ' active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="tab-content">
        {activeTab === 0 && (
          <Overview
            stats={stats}
            origStats={origStats}
            header={hdr}
            onStatsChange={setStats}
          />
        )}
        {activeTab === 1 && (
          <Garage
            garage={garage}
            onGarageChange={setGarage}
          />
        )}
        {activeTab === 2 && (
          <Parts
            parts={parts}
            onPartsChange={setParts}
          />
        )}
      </main>
    </div>
  )
}
