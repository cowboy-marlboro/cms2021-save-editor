import { useCallback } from 'react'

function formatMoney(n) {
  return Number(n).toLocaleString()
}

function StatCard({ label, value, origValue, onChange, type = 'number', min = 0 }) {
  const changed = value !== origValue

  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {label === 'Money' ? formatMoney(value) : value}
      </span>
      <div className="stat-input-wrap">
        <input
          type={type}
          className={`stat-input${changed ? ' changed' : ''}`}
          value={value}
          min={min}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return
            const parsed = parseInt(raw, 10)
            if (!isNaN(parsed) && parsed >= min) onChange(parsed)
          }}
        />
        {changed && (
          <span className="stat-was">
            was {label === 'Money' ? formatMoney(origValue) : origValue}
          </span>
        )}
      </div>
    </div>
  )
}

export default function Overview({ stats, origStats, header, onStatsChange }) {
  if (!stats || !origStats) return null

  const update = useCallback((key, val) => {
    onStatsChange(prev => ({ ...prev, [key]: val }))
  }, [onStatsChange])

  const saveYear  = header.save_year
  const saveMonth = String(header.save_month).padStart(2, '0')

  return (
    <div>
      <div className="overview-grid">
        <StatCard
          label="Money"
          value={stats.money}
          origValue={origStats.money}
          onChange={(v) => update('money', v)}
          min={0}
        />
        <StatCard
          label="Level"
          value={stats.level}
          origValue={origStats.level}
          onChange={(v) => update('level', v)}
          min={1}
        />
        <StatCard
          label="XP"
          value={stats.xp}
          origValue={origStats.xp}
          onChange={(v) => update('xp', v)}
          min={0}
        />
      </div>

      <div className="profile-card">
        <h3>Profile Info</h3>
        <div className="profile-rows">
          <div className="profile-row">
            <span className="profile-row-label">Profile name</span>
            <span className="profile-row-value">{header.profile_name || '—'}</span>
          </div>
          <div className="profile-row">
            <span className="profile-row-label">Save date</span>
            <span className="profile-row-value">{saveYear}-{saveMonth}</span>
          </div>
          {header.version && (
            <div className="profile-row">
              <span className="profile-row-label">Game version</span>
              <span className="profile-row-value">{header.version}</span>
            </div>
          )}
          <div className="profile-row">
            <span className="profile-row-label">Magic</span>
            <span className="profile-row-value" style={{ fontFamily: 'Consolas, monospace', fontSize: '12px' }}>
              {header.magic}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
