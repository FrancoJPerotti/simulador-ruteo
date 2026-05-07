import type { Scenario } from '../scenarios/scenarios';

interface ScenarioPanelProps {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  onScenarioSelect: (scenario: Scenario) => void;
  narrativeText?: string | string[];
  scenarioStep?: number;
  scenarioTotal?: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

function renderNarrative(text: string | string[]): React.ReactNode {
  if (Array.isArray(text)) {
    return (
      <ul className="scenario-narrative-list">
        {text.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return <p>{text}</p>;
}

export function ScenarioPanel({
  scenarios, activeScenarioId, onScenarioSelect, narrativeText, scenarioStep, scenarioTotal, isOpen = true, onToggle,
}: ScenarioPanelProps) {
  if (scenarios.length === 0) return null;

  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) || scenarios[0];

  return (
    <>
      <aside className={`scenario-panel ${!isOpen ? 'scenario-panel--closed' : ''}`} aria-label="Escenarios de simulacion">
        <div className="scenario-panel-header">
          <div className="scenario-panel-title">Escenarios</div>
          {onToggle && (
            <button
              className="scenario-panel-toggle"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              aria-label="Cerrar panel de escenarios"
              title="Cerrar panel"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="scenario-panel-list">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              className={`scenario-panel-item ${activeScenarioId === scenario.id ? 'active' : ''}`}
              onClick={() => onScenarioSelect(scenario)}
            >
              {scenario.name}
            </button>
          ))}
        </div>
        <div className="scenario-panel-description">
          {activeScenario.description}
        </div>
      {narrativeText && (
        <div className="scenario-narrative">
          {scenarioTotal !== undefined && scenarioStep !== undefined && (
            <div className="scenario-narrative-step">
              {scenarioStep + 1 <= scenarioTotal
                ? `Paso ${scenarioStep + 1} / ${scenarioTotal}`
                : `Paso ${scenarioStep + 1}`}
            </div>
          )}
          <div className="scenario-narrative-text">{renderNarrative(narrativeText)}</div>
        </div>
      )}
    </aside>
      {onToggle && !isOpen && (
        <button
          className="scenario-panel-floating-toggle"
          onClick={onToggle}
          aria-label="Abrir panel de escenarios"
          title="Abrir panel"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
        </button>
      )}
  </>
  );
}
