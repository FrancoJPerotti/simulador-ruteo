import type { Scenario } from '../scenarios/scenarios';

interface ScenarioPanelProps {
  scenarios: Scenario[];
  activeScenarioId: string | null;
  onScenarioSelect: (scenario: Scenario) => void;
  narrativeText?: string | string[];
  scenarioStep?: number;
  scenarioTotal?: number;
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
  scenarios, activeScenarioId, onScenarioSelect, narrativeText, scenarioStep, scenarioTotal,
}: ScenarioPanelProps) {
  if (scenarios.length === 0) return null;

  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) || scenarios[0];

  return (
    <aside className="scenario-panel" aria-label="Escenarios de simulacion">
      <div className="scenario-panel-title">Escenarios</div>
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
  );
}
