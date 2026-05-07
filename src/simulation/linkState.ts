import type { Topology, SimulationEvent, LinkStateDatabase, RoutingTableEntry } from './types';

export interface LinkStateOptions {
  ecmp?: boolean;
  falseLsa?: boolean;
  authenticate?: boolean;
}

const DEFAULT_OPTIONS: Required<LinkStateOptions> = {
  ecmp: false,
  falseLsa: false,
  authenticate: false,
};

function getActiveNeighbors(topology: Topology, routerId: string): string[] {
  return topology.links.flatMap((link) => {
    if (link.isDown) return [];
    if (link.source === routerId) return [link.target];
    if (link.target === routerId) return [link.source];
    return [];
  });
}

function isRejectedByAuthentication(routerId: string, options: Required<LinkStateOptions>): boolean {
  return options.falseLsa && options.authenticate && routerId === 'M';
}

export function initLinkState(topology: Topology, lsdb: LinkStateDatabase): void {
  Object.keys(lsdb).forEach((k) => delete lsdb[k]);

  for (const router of topology.routers) {
    const neighbors: { id: string; cost: number }[] = [];
    for (const link of topology.links) {
      if (link.isDown) continue;
      if (link.source === router.id) neighbors.push({ id: link.target, cost: link.cost });
      if (link.target === router.id) neighbors.push({ id: link.source, cost: link.cost });
    }
    const lsa = {
      routerId: router.id,
      neighbors,
      sequence: 0,
    };
    lsdb[router.id] = lsa;
    router.routingTable = [];
    router.lsdb = { [router.id]: lsa };
  }
}

function floodLSAs(topology: Topology, lsdb: LinkStateDatabase, step: number, options: Required<LinkStateOptions>): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  for (const router of topology.routers) {
    if (router.isDown) continue;
    if (isRejectedByAuthentication(router.id, options)) {
      delete lsdb[router.id];
      router.routingTable = [];
      router.lsdb = {};
      continue;
    }

    const neighbors: { id: string; cost: number }[] = [];
    for (const link of topology.links) {
      if (link.isDown) continue;
      if (link.source === router.id) neighbors.push({ id: link.target, cost: link.cost });
      if (link.target === router.id) neighbors.push({ id: link.source, cost: link.cost });
    }
    lsdb[router.id] = {
      routerId: router.id,
      neighbors,
      sequence: step,
    };

    if (router.id === 'M' && options.falseLsa && !options.authenticate) {
      lsdb[router.id] = {
        routerId: router.id,
        neighbors: [
          ...neighbors.filter((neighbor) => neighbor.id !== 'F'),
          { id: 'F', cost: 1 },
        ],
        sequence: step,
      };
    }
  }

  for (const origin of topology.routers) {
    if (origin.isDown) continue;
    if (isRejectedByAuthentication(origin.id, options)) {
      for (const neighborId of getActiveNeighbors(topology, origin.id)) {
        const other = topology.routers.find((r) => r.id === neighborId);
        if (!other || other.isDown) continue;
        events.push({
          id: `lsa-${step}-${origin.id}-${neighborId}-rejected`,
          timestamp: Date.now(),
          type: 'message',
          source: origin.id,
          target: neighborId,
          description: `LSA de ${origin.id} enviado a ${neighborId} y rechazado: autenticacion OSPF invalida`,
          data: { lsaOrigin: origin.id, rejected: true },
        });
      }
      continue;
    }

    const reached = new Set([origin.id]);
    const queue = [origin.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const neighborId of getActiveNeighbors(topology, currentId)) {
        if (reached.has(neighborId)) continue;
        const other = topology.routers.find((r) => r.id === neighborId);
        if (!other || other.isDown) continue;

        reached.add(neighborId);
        queue.push(neighborId);
        events.push({
          id: `lsa-${step}-${origin.id}-${currentId}-${neighborId}`,
          timestamp: Date.now(),
          type: 'message',
          source: currentId,
          target: neighborId,
          description: origin.id === 'M' && options.falseLsa && !options.authenticate
            ? `LSA falso de ${origin.id} reenviado por ${currentId} hacia ${neighborId}: anuncia costo artificialmente bajo`
            : `LSA de ${origin.id} reenviado por ${currentId} hacia ${neighborId}`,
          data: {
            lsaOrigin: origin.id,
            malicious: origin.id === 'M' && options.falseLsa && !options.authenticate,
          },
        });
      }
    }
  }

  // Al finalizar el flooding, cada router tiene una copia completa de la LSDB
  for (const router of topology.routers) {
    if (router.isDown) continue;
    router.lsdb = {};
    for (const [id, lsa] of Object.entries(lsdb)) {
      router.lsdb[id] = lsa;
    }
  }

  return events;
}

function dijkstra(sourceId: string, lsdb: LinkStateDatabase, ecmp: boolean): Map<string, { cost: number; nextHops: string[] }> {
  const result = new Map<string, { cost: number; nextHops: string[] }>();
  const visited = new Set<string>();
  const dist = new Map<string, number>();
  const next = new Map<string, Set<string>>();

  for (const id of Object.keys(lsdb)) {
    dist.set(id, Infinity);
  }
  dist.set(sourceId, 0);
  result.set(sourceId, { cost: 0, nextHops: [sourceId] });

  for (let i = 0; i < Object.keys(lsdb).length; i++) {
    let minDist = Infinity;
    let minId: string | null = null;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < minDist) {
        minDist = d;
        minId = id;
      }
    }

    if (minId === null) break;
    visited.add(minId);

    const lsa = lsdb[minId];
    if (!lsa) continue;

    for (const neighbor of lsa.neighbors) {
      if (visited.has(neighbor.id)) continue;
      const newDist = dist.get(minId)! + neighbor.cost;
      if (newDist < (dist.get(neighbor.id) ?? Infinity)) {
        dist.set(neighbor.id, newDist);
        next.set(neighbor.id, new Set(minId === sourceId ? [neighbor.id] : next.get(minId) ?? [neighbor.id]));
        result.set(neighbor.id, { cost: newDist, nextHops: Array.from(next.get(neighbor.id)!) });
      } else if (ecmp && newDist === (dist.get(neighbor.id) ?? Infinity)) {
        const nextHops = next.get(neighbor.id) ?? new Set<string>();
        const candidates = minId === sourceId ? [neighbor.id] : Array.from(next.get(minId) ?? [neighbor.id]);
        candidates.forEach((candidate) => nextHops.add(candidate));
        next.set(neighbor.id, nextHops);
        result.set(neighbor.id, { cost: newDist, nextHops: Array.from(nextHops) });
      }
    }
  }

  return result;
}

function applyRoutes(topology: Topology, lsdb: LinkStateDatabase, options: Required<LinkStateOptions>, events: SimulationEvent[], step: number): void {
  for (const router of topology.routers) {
    if (router.isDown) continue;
    const previousByDestination = new Map(
      router.routingTable.map((entry) => [entry.destination, `${entry.nextHop}:${entry.cost}`])
    );
    const routes = dijkstra(router.id, lsdb, options.ecmp);
    const nextTable: RoutingTableEntry[] = [];
    for (const [dest, info] of routes) {
      if (dest === router.id) continue;
      for (const nextHop of info.nextHops) {
        nextTable.push({
          destination: dest,
          nextHop,
          cost: info.cost,
          metric: 'cost',
          learnedFrom: options.ecmp && info.nextHops.length > 1 ? 'spf-ecmp' : 'spf',
          timestamp: Date.now(),
        });
      }
    }
    const nextByDestination = new Map(
      nextTable.map((entry) => [entry.destination, `${entry.nextHop}:${entry.cost}`])
    );
    router.routingTable = nextTable;

    for (const entry of nextTable) {
      const previous = previousByDestination.get(entry.destination);
      const kind = previous ? previous === `${entry.nextHop}:${entry.cost}` ? null : 'changed' : 'new';
      if (!kind) continue;
      events.push({
        id: `spf-${step}-${router.id}-${entry.destination}`,
        timestamp: Date.now(),
        type: 'tableUpdate',
        source: router.id,
        description: kind === 'new'
          ? `${router.id} instala ruta a ${entry.destination} via ${entry.nextHop}`
          : `${router.id} recalcula ruta a ${entry.destination}: ahora via ${entry.nextHop}`,
        data: { kind, destination: entry.destination, nextHop: entry.nextHop, cost: entry.cost },
      });
    }

    for (const destination of previousByDestination.keys()) {
      if (nextByDestination.has(destination)) continue;
      events.push({
        id: `spf-${step}-${router.id}-${destination}-removed`,
        timestamp: Date.now(),
        type: 'tableUpdate',
        source: router.id,
        description: `${router.id} elimina ruta a ${destination}: ya no hay camino en la LSDB`,
        data: { kind: 'removed', destination },
      });
    }

    events.push({
      id: `spf-${step}-${router.id}-summary`,
      timestamp: Date.now(),
      type: 'tableUpdate',
      source: router.id,
      description: `${router.id} ejecuta SPF: ${router.routingTable.length} entradas calculadas`,
    });
  }
}

export function stepLinkState(topology: Topology, lsdb: LinkStateDatabase, step: number, rawOptions: LinkStateOptions = {}): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const options = { ...DEFAULT_OPTIONS, ...rawOptions };

  if (step === 1) {
    events.push(...floodLSAs(topology, lsdb, step, options));
    events.push({
      id: `ls-flood-${step}`,
      timestamp: Date.now(),
      type: 'convergence',
      source: 'system',
      description: 'LSAs propagados por flooding. Todos los routers construyen LSDB.',
    });
  } else if (step === 2) {
    applyRoutes(topology, lsdb, options, events, step);
    events.push({
      id: `ls-conv-${step}`,
      timestamp: Date.now(),
      type: 'convergence',
      source: 'system',
      description: 'SPF completado en todos los routers. Tablas de ruteo actualizadas.',
    });
  } else {
    events.push(...floodLSAs(topology, lsdb, step, options));
    applyRoutes(topology, lsdb, options, events, step);
    events.push({
      id: `ls-conv-${step}`,
      timestamp: Date.now(),
      type: 'convergence',
      source: 'system',
      description: `LSDB sincronizada y SPF recalculado (paso ${step}).`,
    });
  }

  return events;
}
