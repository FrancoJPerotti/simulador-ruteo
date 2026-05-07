interface FeatureToggleProps {
  label: string;
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}

export function FeatureToggle({ label, enabled, disabled = false, onChange }: FeatureToggleProps) {
  return (
    <aside className="feature-toggle-panel" aria-label="Opciones del escenario">
      <button
        type="button"
        className={`feature-toggle ${enabled ? 'enabled' : ''}`}
        onClick={() => onChange(!enabled)}
        disabled={disabled}
        aria-pressed={enabled}
      >
        <span className="feature-toggle-copy">
          <span className="feature-toggle-label">{label}</span>
        </span>
        <span className="feature-toggle-track" aria-hidden="true">
          <span className="feature-toggle-thumb" />
        </span>
      </button>
    </aside>
  );
}
