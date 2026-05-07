import type { SimulationMode } from '../simulation/types';

interface TopBarProps {
  mode: SimulationMode;
  status: string;
  onModeChange: (m: SimulationMode) => void;
}

const MODES: { id: SimulationMode; label: string; cls: string }[] = [
  { id: 'rip', label: 'RIP', cls: 'rip' },
  { id: 'hello', label: 'HELLO', cls: 'hello' },
  { id: 'ospf', label: 'OSPF', cls: 'ospf' },
];

export function TopBar({
  mode, status,
  onModeChange,
}: TopBarProps) {
  const statusLabel =
    status === 'converging' ? 'Convergiendo' :
    status === 'oscillating' ? 'Oscilando' :
    status === 'stable' ? 'Estable' : '';

  return (
    <div className="topbar">
      <div className="pill-group">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`pill ${m.cls} ${mode === m.id ? 'active' : ''}`}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="pill-separator" />

      <div className={`status-badge ${status}`}>
        <span className="dot" />
        {statusLabel}
      </div>
    </div>
  );
}
