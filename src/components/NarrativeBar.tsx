interface NarrativeBarProps {
  autoRunning: boolean;
  isAnimating: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrevScenario: () => void;
  onNextScenario: () => void;
  onAuto: () => void;
  onReset: () => void;
}

export function NarrativeBar({
  autoRunning, isAnimating, canGoPrev, canGoNext,
  onPrevScenario, onNextScenario, onAuto, onReset,
}: NarrativeBarProps) {
  return (
    <div className="bottom-panel">
      <div className="execution-controls" aria-label="Controles de simulacion">
        <button
          className="control-button"
          onClick={onPrevScenario}
          disabled={!canGoPrev || isAnimating}
          title="Paso anterior"
          aria-label="Paso anterior"
        >
          <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18.5 7.2c0-.9-1-1.4-1.8-.9L10.5 11c-.7.5-.7 1.5 0 2l6.2 4.7c.8.5 1.8 0 1.8-.9V7.2Z" />
            <path d="M10.5 7.2c0-.9-1-1.4-1.8-.9L2.5 11c-.7.5-.7 1.5 0 2l6.2 4.7c.8.5 1.8 0 1.8-.9V7.2Z" />
          </svg>
        </button>
        <button
          className="control-button"
          onClick={onNextScenario}
          disabled={!canGoNext || isAnimating}
          title="Paso siguiente"
          aria-label="Paso siguiente"
        >
          <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5.5 7.2c0-.9 1-1.4 1.8-.9l6.2 4.7c.7.5.7 1.5 0 2l-6.2 4.7c-.8.5-1.8 0-1.8-.9V7.2Z" />
            <path d="M13.5 7.2c0-.9 1-1.4 1.8-.9l6.2 4.7c.7.5.7 1.5 0 2l-6.2 4.7c-.8.5-1.8 0-1.8-.9V7.2Z" />
          </svg>
        </button>
        <button
          className={`control-button ${autoRunning ? 'running' : ''}`}
          onClick={onAuto}
          disabled={!autoRunning && (!canGoNext || isAnimating)}
          title={autoRunning ? 'Pausar ejecucion automatica' : 'Ejecutar escenario automaticamente'}
          aria-label={autoRunning ? 'Pausar ejecucion automatica' : 'Ejecutar escenario automaticamente'}
        >
          {autoRunning ? (
            <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="6" width="4" height="12" rx="1.5" />
              <rect x="13" y="6" width="4" height="12" rx="1.5" />
            </svg>
          ) : (
            <svg className="control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.5 6.8c0-1 1.1-1.6 1.9-1l8.7 5.2c.8.5.8 1.7 0 2.2l-8.7 5.2c-.8.5-1.9-.1-1.9-1V6.8Z" />
            </svg>
          )}
        </button>
        <button
          className="control-button"
          onClick={onReset}
          title="Reiniciar escenario"
          aria-label="Reiniciar escenario"
        >
          <svg className="control-icon reset" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18.5 8.5a7 7 0 1 0 1 6" />
            <path d="M18.5 4.5v4h-4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
