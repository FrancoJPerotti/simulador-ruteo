import { useRef, useEffect, useState } from 'react';
import type { RouterNode, SimulationMode, RoutingTableEntry, LinkStateDatabase } from '../simulation/types';

interface RouterPopupProps {
  router: RouterNode | null;
  mode: SimulationMode;
  modeColor: string;
  onClose: () => void;
}

export function RouterPopup({ router, mode, modeColor, onClose }: RouterPopupProps) {
  const [prevTable, setPrevTable] = useState<RoutingTableEntry[]>([]);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [newEntries, setNewEntries] = useState<Set<string>>(new Set());
  const timerRef = useRef<number | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!router) return;
    const currentTable = router.routingTable;
    const prevDests = new Set(prevTable.map((e) => e.destination));
    const changedSet = new Set<string>();
    const newSet = new Set<string>();

    for (const entry of currentTable) {
      if (!prevDests.has(entry.destination)) {
        newSet.add(entry.destination);
      } else {
        const prev = prevTable.find((e) => e.destination === entry.destination);
        if (prev && (prev.nextHop !== entry.nextHop || prev.cost !== entry.cost)) {
          changedSet.add(entry.destination);
        }
      }
    }

    setChanged(changedSet);
    setNewEntries(newSet);
    setPrevTable([...currentTable]);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setChanged(new Set());
      setNewEntries(new Set());
    }, 2500);
  }, [router?.routingTable]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  if (!router) return null;

  const metricLabel =
    mode === 'rip' ? 'Saltos' :
    mode === 'ospf' ? 'Costo' :
    mode === 'hello' ? 'Delay' : 'Costo';

  const hasLsdb = mode === 'ospf' && router.lsdb && Object.keys(router.lsdb).length > 0;
  const lsdbEntries = hasLsdb ? Object.entries(router.lsdb as LinkStateDatabase) : [];

  return (
    <div
      className="router-popup"
      ref={popupRef}
      style={{ right: 24, top: 80, maxHeight: '80vh', overflowY: 'auto' }}
    >
      <div className="router-popup-header">
        <div className="router-popup-icon" style={{ background: modeColor }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <rect x="2" y="2" width="20" height="20" rx="4" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="2" x2="12" y2="6" />
            <line x1="12" y1="18" x2="12" y2="22" />
            <line x1="2" y1="12" x2="6" y2="12" />
            <line x1="18" y1="12" x2="22" y2="12" />
          </svg>
        </div>
        <div>
          <div className="router-popup-name">{router.label}</div>
          <div className="router-popup-subtitle">
            {hasLsdb ? `${lsdbEntries.length} LSAs  ·  ` : ''}
            {router.routingTable.length} ruta{router.routingTable.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {hasLsdb && (
        <div className="popup-section">
          <div className="popup-section-title" style={{ color: '#10b981' }}>
            Link-State Database
          </div>
          <table className="popup-table">
            <thead>
              <tr>
                <th>Router</th>
                <th>Vecinos</th>
                <th>Seq</th>
              </tr>
            </thead>
            <tbody>
              {lsdbEntries.map(([id, lsa]) => (
                <tr key={id}>
                  <td style={{ fontWeight: 600, color: '#f1f5f9' }}>{id}</td>
                  <td>{lsa.neighbors.map((n) => `${n.id}(${n.cost})`).join(', ')}</td>
                  <td>{lsa.sequence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {router.routingTable.length === 0 ? (
        <div className="popup-empty">
          {mode === 'ospf'
            ? 'SPF aún no ejecutado. Presiona "Paso" para calcular rutas.'
            : 'Sin rutas. Presiona "Paso" para converger.'}
        </div>
      ) : (
        <div className="popup-section">
          <div className="popup-section-title" style={{ color: modeColor }}>
            Tabla de ruteo {mode === 'ospf' ? '(SPF)' : ''}
          </div>
          <table className="popup-table">
            <thead>
              <tr>
                <th>Dest</th>
                <th>Next Hop</th>
                <th>{metricLabel}</th>
              </tr>
            </thead>
            <tbody>
              {router.routingTable.map((entry, i) => {
                const isNew = newEntries.has(entry.destination);
                const isChanged = changed.has(entry.destination);
                const rowClass = isNew ? 'new' : isChanged ? 'changed' : '';

                return (
                  <tr key={`${entry.destination}-${i}`} className={rowClass}>
                    <td style={{ fontWeight: 600, color: '#f1f5f9' }}>{entry.destination}</td>
                    <td>{entry.nextHop}</td>
                    <td>
                      {typeof entry.cost === 'number'
                        ? entry.cost === Infinity ? '∞' : entry.cost
                        : entry.cost}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
