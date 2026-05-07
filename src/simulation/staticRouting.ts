import type { Topology, SimulationEvent } from './types';

export function initStaticRouting(topology: Topology): void {
  const tables: Record<string, Record<string, { nextHop: string; cost: number }>> = {
    A: { B: { nextHop: 'B', cost: 10 }, C: { nextHop: 'B', cost: 30 }, D: { nextHop: 'D', cost: 5 }, E: { nextHop: 'D', cost: 15 }, F: { nextHop: 'D', cost: 20 } },
    B: { A: { nextHop: 'A', cost: 10 }, C: { nextHop: 'C', cost: 20 }, D: { nextHop: 'A', cost: 15 }, E: { nextHop: 'E', cost: 15 }, F: { nextHop: 'E', cost: 20 } },
    C: { A: { nextHop: 'B', cost: 30 }, B: { nextHop: 'B', cost: 20 }, D: { nextHop: 'F', cost: 23 }, E: { nextHop: 'F', cost: 13 }, F: { nextHop: 'F', cost: 8 } },
    D: { A: { nextHop: 'A', cost: 5 }, B: { nextHop: 'A', cost: 15 }, C: { nextHop: 'E', cost: 23 }, E: { nextHop: 'E', cost: 10 }, F: { nextHop: 'E', cost: 15 } },
    E: { A: { nextHop: 'D', cost: 15 }, B: { nextHop: 'B', cost: 15 }, C: { nextHop: 'F', cost: 13 }, D: { nextHop: 'D', cost: 10 }, F: { nextHop: 'F', cost: 5 } },
    F: { A: { nextHop: 'E', cost: 20 }, B: { nextHop: 'E', cost: 20 }, C: { nextHop: 'C', cost: 8 }, D: { nextHop: 'E', cost: 15 }, E: { nextHop: 'E', cost: 5 } },
  };

  for (const router of topology.routers) {
    const table = tables[router.id];
    if (table) {
      router.routingTable = Object.entries(table).map(([dest, info]) => ({
        destination: dest,
        nextHop: info.nextHop,
        cost: info.cost,
        metric: 'cost' as const,
        learnedFrom: 'static-config',
        timestamp: Date.now(),
      }));
    }
  }
}

export function stepStatic(_topology: Topology, step: number): SimulationEvent[] {
  return [{
    id: `static-${step}`,
    timestamp: Date.now(),
    type: 'convergence',
    source: 'system',
    description: 'Rutas estáticas: no hay actualización automática. Las tablas permanecen igual.',
  }];
}
