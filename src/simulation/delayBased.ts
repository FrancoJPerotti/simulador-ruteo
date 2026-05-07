import type { Link, Topology, SimulationEvent, RoutingTableEntry } from './types';

export interface HelloOptions {
  trafficSensitive?: boolean;
  trafficVolume?: number;
}

const DEFAULT_OPTIONS: Required<HelloOptions> = {
  trafficSensitive: false,
  trafficVolume: 3,
};

export function initDelayBased(topology: Topology): void {
  for (const link of topology.links) {
    link.load = 0;
    link.forwardLoad = 0;
    link.reverseLoad = 0;
    link.delay = link.forwardDelay;
    link.measuredForwardDelay = link.forwardDelay;
    link.measuredReverseDelay = link.reverseDelay;
  }

  for (const router of topology.routers) {
    router.routingTable = [];
    router.routingTable.push({
      destination: router.id,
      nextHop: router.id,
      cost: 0,
      metric: 'delay',
      learnedFrom: 'self',
      timestamp: Date.now(),
    });
  }

  refreshDirectRoutes(topology, []);
}

function getDirectionalDelay(link: Link, fromId: string): number {
  return link.source === fromId ? link.forwardDelay : link.reverseDelay;
}

function getMeasuredDelay(link: Link, fromId: string): number {
  return link.source === fromId ? link.measuredForwardDelay : link.measuredReverseDelay;
}

function getDirectionalLoad(link: Link, fromId: string): number {
  return link.source === fromId ? link.forwardLoad : link.reverseLoad;
}

function getDirectionalCapacity(link: Link, fromId: string): number {
  return link.source === fromId ? link.forwardCapacity : link.reverseCapacity;
}

function setDirectionalLoad(link: Link, fromId: string, load: number): void {
  if (link.source === fromId) {
    link.forwardLoad = load;
  } else {
    link.reverseLoad = load;
  }
  link.load = Math.max(link.forwardLoad, link.reverseLoad);
}

function getEffectiveDelay(link: Link, fromId: string, trafficSensitive: boolean): number {
  const baseDelay = getDirectionalDelay(link, fromId);
  if (!trafficSensitive) return baseDelay;

  const capacity = Math.max(0.1, getDirectionalCapacity(link, fromId));
  const utilization = Math.min(0.92, getDirectionalLoad(link, fromId) / capacity);
  return baseDelay / Math.max(0.08, 1 - utilization);
}

function updateMeasuredDelays(topology: Topology, trafficSensitive: boolean): void {
  for (const link of topology.links) {
    link.measuredForwardDelay = getEffectiveDelay(link, link.source, trafficSensitive);
    link.measuredReverseDelay = getEffectiveDelay(link, link.target, trafficSensitive);
    link.delay = link.measuredForwardDelay;
  }
}

function getNeighbors(
  routerId: string,
  topology: Topology,
): { id: string; link: Link; delay: number }[] {
  const result: { id: string; link: Link; delay: number }[] = [];
  for (const link of topology.links) {
    if (link.isDown) continue;
    if (link.source === routerId) {
      result.push({ id: link.target, link, delay: getMeasuredDelay(link, routerId) });
    }
    if (link.target === routerId) {
      result.push({ id: link.source, link, delay: getMeasuredDelay(link, routerId) });
    }
  }
  return result;
}

function upsertRoute(
  table: RoutingTableEntry[],
  entry: RoutingTableEntry,
): 'new' | 'changed' | null {
  const existing = table.find((route) => route.destination === entry.destination);
  if (!existing) {
    table.push(entry);
    return 'new';
  }

  if (
    existing.nextHop !== entry.nextHop ||
    existing.learnedFrom !== entry.learnedFrom ||
    Math.abs(existing.cost - entry.cost) > 0.05
  ) {
    existing.nextHop = entry.nextHop;
    existing.cost = entry.cost;
    existing.learnedFrom = entry.learnedFrom;
    existing.timestamp = Date.now();
    return 'changed';
  }

  return null;
}

function refreshDirectRoutes(topology: Topology, events: SimulationEvent[], step = 0): boolean {
  let changed = false;

  for (const router of topology.routers) {
    if (router.isDown) continue;
    for (const { id: neighborId, delay } of getNeighbors(router.id, topology)) {
      const kind = upsertRoute(router.routingTable, {
        destination: neighborId,
        nextHop: neighborId,
        cost: delay,
        metric: 'delay',
        learnedFrom: neighborId,
        timestamp: Date.now(),
      });

      if (kind) {
        changed = true;
        if (step > 0) {
          events.push({
            id: `hello-direct-${step}-${router.id}-${neighborId}`,
            timestamp: Date.now(),
            type: 'tableUpdate',
            source: router.id,
            description: `${router.id} mide delay directo hacia ${neighborId}: ${delay.toFixed(1)}`,
            data: { kind, destination: neighborId, nextHop: neighborId, cost: delay },
          });
        }
      }
    }
  }

  return changed;
}

function decayTraffic(topology: Topology, options: Required<HelloOptions>): void {
  for (const link of topology.links) {
    link.forwardLoad = Math.max(0, link.forwardLoad - options.trafficVolume);
    link.reverseLoad = Math.max(0, link.reverseLoad - options.trafficVolume);
    link.load = Math.max(link.forwardLoad, link.reverseLoad);
    link.isActive = false;
  }
}

function applyTraffic(topology: Topology, path: string[], options: Required<HelloOptions>, events: SimulationEvent[], step: number): void {
  for (let i = 0; i < path.length - 1; i++) {
    const fromId = path[i];
    const toId = path[i + 1];
    const link = topology.links.find(
      (candidate) =>
        (candidate.source === fromId && candidate.target === toId) ||
        (candidate.target === fromId && candidate.source === toId)
    );
    if (!link) continue;
    link.isActive = true;
    setDirectionalLoad(link, fromId, getDirectionalLoad(link, fromId) + options.trafficVolume * 2);
    const burstSize = Math.max(5, options.trafficVolume + 2);
    for (let packetIndex = 0; packetIndex < burstSize; packetIndex++) {
      events.push({
        id: `hello-traffic-${step}-${fromId}-${toId}-${packetIndex}`,
        timestamp: Date.now(),
        type: 'packet',
        source: fromId,
        target: toId,
        description: `Trafico de datos A -> F atraviesa ${fromId} -> ${toId}`,
        data: { kind: 'traffic', source: 'A', destination: 'F' },
      });
    }
  }
}

function getPath(topology: Topology, source: string, destination: string): string[] {
  const path = [source];
  const visited = new Set(path);
  let current = source;

  while (current !== destination) {
    const router = topology.routers.find((candidate) => candidate.id === current);
    const route = router?.routingTable.find((entry) => entry.destination === destination);
    if (!route || visited.has(route.nextHop)) break;

    current = route.nextHop;
    visited.add(current);
    path.push(current);
  }

  return path[path.length - 1] === destination ? path : [];
}

function markActivePath(topology: Topology): void {
  topology.links.forEach((link) => (link.isActive = false));
  const path = getPath(topology, 'A', 'F');
  for (let i = 0; i < path.length - 1; i++) {
    const fromId = path[i];
    const toId = path[i + 1];
    const link = topology.links.find(
      (candidate) =>
        (candidate.source === fromId && candidate.target === toId) ||
        (candidate.target === fromId && candidate.source === toId)
    );
    if (link) link.isActive = true;
  }
}

export function stepDelayBased(
  topology: Topology,
  step: number,
  options: HelloOptions = {},
): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const config = { ...DEFAULT_OPTIONS, ...options };
  let tableChanged = false;
  const trafficPath = config.trafficSensitive ? getPath(topology, 'A', 'F') : [];

  if (config.trafficSensitive) {
    decayTraffic(topology, config);
    applyTraffic(topology, trafficPath, config, events, step);
  } else {
    markActivePath(topology);
  }

  updateMeasuredDelays(topology, config.trafficSensitive);
  tableChanged = refreshDirectRoutes(topology, events, step) || tableChanged;

  const tableSnapshots = new Map(
    topology.routers.map((router) => [
      router.id,
      router.routingTable.map((entry) => ({ ...entry })),
    ])
  );

  for (const router of topology.routers) {
    if (router.isDown) continue;
    const senderTable = tableSnapshots.get(router.id) || [];

    for (const { id: neighborId, link } of getNeighbors(router.id, topology)) {
      const neighbor = topology.routers.find((candidate) => candidate.id === neighborId);
      if (!neighbor || neighbor.isDown) continue;
      const receiveDelay = getMeasuredDelay(link, neighborId);

      events.push({
        id: `hello-msg-${step}-${router.id}-${neighborId}`,
        timestamp: Date.now(),
        type: 'message',
        source: router.id,
        target: neighborId,
        description: `${router.id} envia vector HELLO a ${neighborId} con delays acumulados`,
      });

      for (const entry of senderTable) {
        if (entry.destination === neighborId) continue;
        if (entry.nextHop === neighborId) continue;
        const newCost = receiveDelay + entry.cost;
        const existing = neighbor.routingTable.find((route) => route.destination === entry.destination);
        const costChangedThroughSameNeighbor = existing?.learnedFrom === router.id &&
          Math.abs(existing.cost - newCost) > 0.05;
        const shouldUpdate = !existing ||
          newCost + 0.05 < existing.cost ||
          (config.trafficSensitive && costChangedThroughSameNeighbor);
        if (!shouldUpdate) continue;

        const kind = upsertRoute(neighbor.routingTable, {
          destination: entry.destination,
          nextHop: router.id,
          cost: newCost,
          metric: 'delay',
          learnedFrom: router.id,
          timestamp: Date.now(),
        });

        if (!kind) continue;
        tableChanged = true;
        events.push({
          id: `hello-update-${step}-${neighborId}-${entry.destination}`,
          timestamp: Date.now(),
          type: 'tableUpdate',
          source: neighborId,
          description: `${neighborId} aprende delay a ${entry.destination} via ${router.id}: ${receiveDelay.toFixed(1)} + ${entry.cost.toFixed(1)} = ${newCost.toFixed(1)}`,
          data: { kind, destination: entry.destination, nextHop: router.id, cost: newCost },
        });
      }
    }
  }

  events.push({
    id: `hello-step-${step}`,
    timestamp: Date.now(),
    type: 'convergence',
    source: 'system',
    description: tableChanged
      ? `Paso ${step}: HELLO actualizo rutas usando delays medidos por direccion.`
      : `Paso ${step}: convergencia HELLO alcanzada; no hay delays mejores.`,
  });

  return events;
}
