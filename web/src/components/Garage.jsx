import { useState, useCallback } from 'react'

const DISPLAY = {
  paintshop:            'Paint Shop',
  scraps:               'Scrap Parts Bin',
  dyno:                 'Dynamometer',
  warehouse:            'Parts Warehouse',
  path_test:            'Test Track',
  car_wash:             'Car Wash',
  unlock_tablet:        'Diagnostic Tablet',
  unlock_obd:           'OBD Scanner',
  unlock_fuel:          'Fuel System Kit',
  unlock_electronic:    'Electronics Bench',
  garage_upgrade:       'Garage Upgrade',
  garage_customization: 'Garage Customization',
  lifter:               'Car Lifter',
  unlock_cylinder:      'Cylinder Head Kit',
  unlock_tires:         'Tire Equipment',
  brake_lathe:          'Brake Lathe',
  repair_parts:         'Parts Repair Bench',
  welder:               'Welding Station',
  battery:              'Battery Charger',
  crane:                'Engine Crane',
  repair_body:          'Body Repair Set',
  bus_upgrade:          'Bus Bay Upgrade',
  windowtint:           'Window Tinting',
}

const ICONS = {
  paintshop:            '🎨',
  scraps:               '🔩',
  dyno:                 '📊',
  warehouse:            '🏭',
  path_test:            '🛣️',
  car_wash:             '🧼',
  unlock_tablet:        '📱',
  unlock_obd:           '🔌',
  unlock_fuel:          '⛽',
  unlock_electronic:    '⚡',
  garage_upgrade:       '🔧',
  garage_customization: '✨',
  lifter:               '⬆️',
  unlock_cylinder:      '🔴',
  unlock_tires:         '🛞',
  brake_lathe:          '⚙️',
  repair_parts:         '🛠️',
  welder:               '🔥',
  battery:              '🔋',
  crane:                '🏗️',
  repair_body:          '🚗',
  bus_upgrade:          '🚌',
  windowtint:           '🪟',
}

function getStateBadge(state) {
  if (state === 0) return { label: 'Locked', cls: 'locked' }
  if (state === 1) return { label: 'Unlocked', cls: 'unlocked' }
  return { label: `Tier ${state}`, cls: 'tier' }
}

const FILTERS = ['All', 'Unlocked', 'Locked']

export default function Garage({ garage, onGarageChange }) {
  const [filter, setFilter] = useState('All')

  const unlocked = garage.filter(g => g.state > 0).length

  const handleStateChange = useCallback((idx, raw) => {
    const val = parseInt(raw, 10)
    if (isNaN(val) || val < 0 || val > 255) return
    onGarageChange(prev => prev.map((g, i) => i === idx ? { ...g, state: val } : g))
  }, [onGarageChange])

  const handleUnlockAll = useCallback(() => {
    onGarageChange(prev => prev.map(g => g.state === 0 ? { ...g, state: 1 } : g))
  }, [onGarageChange])

  const filtered = garage.filter(g => {
    if (filter === 'Unlocked') return g.state > 0
    if (filter === 'Locked')   return g.state === 0
    return true
  })

  return (
    <div>
      <div className="garage-toolbar">
        <div className="garage-filters">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`filter-btn${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="badge">{unlocked} / {garage.length} unlocked</span>
        <button className="btn btn-sm btn-success" onClick={handleUnlockAll}>
          Unlock All
        </button>
      </div>

      <div className="garage-note">
        State value: <strong>0</strong> = locked, <strong>1</strong> = purchased / unlocked,
        higher values may indicate upgrade tiers (reverse-engineered, experimental).
      </div>

      <div className="garage-grid">
        {filtered.map((g, displayIdx) => {
          const realIdx = garage.findIndex(x => x.name === g.name)
          const badge   = getStateBadge(g.state)
          const changed = g.state !== g._orig

          return (
            <div key={g.name} className={`garage-card${changed ? ' changed' : ''}`}>
              <div className="garage-card-header">
                <span className="garage-card-icon">{ICONS[g.name] || '🔧'}</span>
                <div className="garage-card-names">
                  <div className="garage-card-name">{DISPLAY[g.name] || g.name}</div>
                  <div className="garage-card-id">{g.name}</div>
                </div>
              </div>

              <span className={`state-badge ${badge.cls}`}>{badge.label}</span>

              <div className="garage-state-row">
                <span className="garage-state-label">State:</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  className={`garage-state-input${changed ? ' changed' : ''}`}
                  value={g.state}
                  onChange={(e) => handleStateChange(realIdx, e.target.value)}
                />
                {changed && (
                  <span style={{ fontSize: '11px', color: 'var(--yellow)' }}>
                    was {g._orig}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="parts-empty">No items match the current filter.</div>
      )}
    </div>
  )
}
