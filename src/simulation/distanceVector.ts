import type { Topology, SimulationEvent } from './types';

const MAX_HOPS = 16;

export interface DistanceVectorOptions {
  splitHorizon?: boolean;
  withdrawMissingRoutes?: boolean;
}

const DEFAULT_OPTIONS: Required<DistanceVectorOptions> = {
  splitHorizon: true,
  withdrawMissingRoutes: true,
};

export function initDistanceVector(topology: Topology): void {
  for (const router of topology.routers) {
    router.routingTable = [];
    router.routingTable.push({
      destination: router.id,
      nextHop: router.id,
      cost: 0,
      metric: 'hops',
      learnedFrom: 'self',
      timestamp: Date.now(),
    });
    for (const link of topology.links) {
      if (link.isDown) continue;
      let neighborId: string | null = null;
      if (link.source === router.id) neighborId = link.target;
      if (link.target === router.id) neighborId = link.source;
      if (neighborId) {
        router.routingTable.push({
          destination: neighborId,
          nextHop: neighborId,
          cost: 1,
          metric: 'hops',
          learnedFrom: neighborId,
          timestamp: Date.now(),
        });
      }
    }
  }
}

export function stepDistanceVector(
  topology: Topology,
  step: number,
  _prevMessages: number,
  options: DistanceVectorOptions = {},
): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  let tableChanged = false;
  const config = { ...DEFAULT_OPTIONS, ...options };
  const tableSnapshots = new Map(
    topology.routers.map((router) => [
      router.id,
      router.routingTable.map((entry) => ({ ...entry, asPath: entry.asPath ? [...entry.asPath] : undefined })),
    ])
  );

  for (const router of topology.routers) {
    if (router.isDown) continue;
    const senderTable = tableSnapshots.get(router.id) || [];

    const neighbors: string[] = [];
    for (const link of topology.links) {
      if (link.isDown) continue;
      if (link.source === router.id) neighbors.push(link.target);
      if (link.target === router.id) neighbors.push(link.source);
    }

    for (const neighborId of neighbors) {
      const neighbor = topology.routers.find((r) => r.id === neighborId);
      if (!neighbor || neighbor.isDown) continue;

      events.push({
        id: `dv-msg-${step}-${router.id}-${neighborId}`,
        timestamp: Date.now(),
        type: 'message',
        source: router.id,
        target: neighborId,
        description: `${router.id} envía vector de distancias a ${neighborId}`,
      });

      const advertisedDestinations = new Set(
        senderTable
          .filter((entry) => !config.splitHorizon || entry.nextHop !== neighborId)
          .map((entry) => entry.destination)
      );
      const withdrawn = neighbor.routingTable.filter(
        (entry) => entry.learnedFrom === router.id && !advertisedDestinations.has(entry.destination)
      );

      if (config.withdrawMissingRoutes && withdrawn.length > 0) {
        neighbor.routingTable = neighbor.routingTable.filter(
          (entry) => entry.learnedFrom !== router.id || advertisedDestinations.has(entry.destination)
        );
        tableChanged = true;

        for (const entry of withdrawn) {
          events.push({
            id: `dv-withdraw-${step}-${neighborId}-${router.id}-${entry.destination}`,
            timestamp: Date.now(),
            type: 'tableUpdate',
            source: neighborId,
            description: `${neighborId} elimina ruta a ${entry.destination}: ${router.id} ya no la anuncia`,
            data: { kind: 'removed', destination: entry.destination, nextHop: router.id, cost: MAX_HOPS },
          });
        }
      }

      for (const entry of senderTable) {
        if (config.splitHorizon && entry.nextHop === neighborId) continue;

        const newCost = Math.min(entry.cost + 1, MAX_HOPS);
        const existing = neighbor.routingTable.find((e) => e.destination === entry.destination);

        if (!existing) {
          if (newCost < MAX_HOPS) {
            neighbor.routingTable.push({
              destination: entry.destination,
              nextHop: router.id,
              cost: newCost,
              metric: 'hops',
              learnedFrom: router.id,
              timestamp: Date.now(),
            });
            tableChanged = true;
            events.push({
              id: `dv-update-${step}-${neighborId}-${entry.destination}`,
              timestamp: Date.now(),
              type: 'tableUpdate',
              source: neighborId,
              description: `${neighborId} aprende ruta a ${entry.destination} vía ${router.id} (costo: ${newCost})`,
              data: { kind: 'new', destination: entry.destination, nextHop: router.id, cost: newCost },
            });
          }
        } else if (newCost < existing.cost) {
          existing.nextHop = router.id;
          existing.cost = newCost;
          existing.learnedFrom = router.id;
          existing.timestamp = Date.now();
          tableChanged = true;
          events.push({
            id: `dv-update-${step}-${neighborId}-${entry.destination}`,
            timestamp: Date.now(),
            type: 'tableUpdate',
            source: neighborId,
            description: `${neighborId} actualiza ruta a ${entry.destination}: vía ${router.id} (costo: ${newCost})`,
            data: { kind: 'changed', destination: entry.destination, nextHop: router.id, cost: newCost },
          });
        } else if (existing.learnedFrom === router.id && existing.cost !== newCost) {
          if (newCost >= MAX_HOPS) {
            neighbor.routingTable = neighbor.routingTable.filter((e) => e.destination !== entry.destination);
            events.push({
              id: `dv-remove-${step}-${neighborId}-${entry.destination}`,
              timestamp: Date.now(),
              type: 'tableUpdate',
              source: neighborId,
              description: `${neighborId} elimina ruta a ${entry.destination}: ${router.id} anuncio costo ${entry.cost}, asi que ${entry.cost}+1=${newCost} es inalcanzable (maximo ${MAX_HOPS}). Los demas routers todavia no se enteran porque les anuncio un costo menor en esta misma ronda.`,
              data: { kind: 'removed', destination: entry.destination, nextHop: router.id, cost: MAX_HOPS },
            });
          } else {
            existing.cost = newCost;
            existing.timestamp = Date.now();
            events.push({
              id: `dv-update-${step}-${neighborId}-${entry.destination}`,
              timestamp: Date.now(),
              type: 'tableUpdate',
              source: neighborId,
              description: `${neighborId} actualiza ruta a ${entry.destination}: via ${router.id} (costo: ${newCost})`,
              data: { kind: 'changed', destination: entry.destination, nextHop: router.id, cost: newCost },
            });
          }
          tableChanged = true;
        }
      }
    }
  }

  if (!tableChanged && events.length > 0) {
    events.push({
      id: `dv-conv-${step}`,
      timestamp: Date.now(),
      type: 'convergence',
      source: 'system',
      description: `Convergencia alcanzada en paso ${step}. Tablas estables.`,
    });
  }

  return events;
}
