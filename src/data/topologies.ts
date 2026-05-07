import type { Topology, RouterNode, Link } from '../simulation/types';

const intraASRouterPositions: Record<string, { x: number; y: number }> = {
  A: { x: 100, y: 80 },
  B: { x: 280, y: 80 },
  C: { x: 460, y: 80 },
  D: { x: 100, y: 260 },
  E: { x: 280, y: 260 },
  F: { x: 460, y: 260 },
};

const slowConvergencePositions: Record<string, { x: number; y: number }> = {
  NET1: { x: 70, y: 170 },
  R1: { x: 210, y: 170 },
  R2: { x: 350, y: 170 },
  R3: { x: 490, y: 170 },
};

const helloComparisonPositions: Record<string, { x: number; y: number }> = {
  A: { x: 80, y: 170 },
  B: { x: 260, y: 80 },
  C: { x: 220, y: 280 },
  D: { x: 400, y: 280 },
  F: { x: 560, y: 170 },
};

const helloFlappingPositions: Record<string, { x: number; y: number }> = {
  A: { x: 80, y: 170 },
  D: { x: 300, y: 90 },
  S: { x: 300, y: 260 },
  F: { x: 520, y: 170 },
};

const ospfHijackPositions: Record<string, { x: number; y: number }> = {
  A: { x: 80, y: 170 },
  B: { x: 230, y: 90 },
  C: { x: 390, y: 90 },
  F: { x: 560, y: 170 },
  M: { x: 310, y: 280 },
};

function createRouters(ids: string[]): RouterNode[] {
  return ids.map((id) => ({
    id,
    label: id,
    x: intraASRouterPositions[id]?.x ?? 300,
    y: intraASRouterPositions[id]?.y ?? 200,
    routingTable: [],
    isDown: false,
    selected: false,
  }));
}

function createRoutersWithPositions(ids: string[], positions: Record<string, { x: number; y: number }>): RouterNode[] {
  return ids.map((id) => ({
    id,
    label: id === 'NET1' ? 'Network 1' : id,
    x: positions[id]?.x ?? 300,
    y: positions[id]?.y ?? 200,
    routingTable: [],
    isDown: false,
    selected: false,
  }));
}

function createLink(
  source: string,
  target: string,
  cost: number,
  forwardDelay: number = cost * 2,
  reverseDelay: number = forwardDelay,
  forwardCapacity: number = 100,
  reverseCapacity: number = forwardCapacity,
): Link {
  return {
    id: `${source}-${target}`,
    source,
    target,
    cost,
    delay: forwardDelay,
    forwardDelay,
    reverseDelay,
    measuredForwardDelay: forwardDelay,
    measuredReverseDelay: reverseDelay,
    forwardCapacity,
    reverseCapacity,
    forwardLoad: 0,
    reverseLoad: 0,
    load: 0,
    isDown: false,
    isCongested: false,
    isActive: false,
  };
}

export const intraASTopology: Topology = {
  id: 'intra-as',
  name: 'Topología Intra-AS',
  description: 'Red interna de un Sistema Autónomo con 6 routers. Permite comparar Estático, RIP, OSPF y HELLO.',
  routers: createRouters(['A', 'B', 'C', 'D', 'E', 'F']),
  links: [
    createLink('A', 'B', 10, 5),
    createLink('A', 'D', 5, 3),
    createLink('B', 'C', 20, 10),
    createLink('B', 'E', 15, 8),
    createLink('C', 'F', 8, 4),
    createLink('D', 'E', 10, 5),
    createLink('E', 'F', 5, 3),
  ],
  supportedModes: ['static', 'rip', 'ospf', 'hello'],
};

export const ripSlowConvergenceTopology: Topology = {
  id: 'rip-slow-convergence',
  name: 'Convergencia lenta RIP',
  description: 'Tres routers en linea hacia Network 1 para mostrar bucles y conteo a infinito.',
  routers: createRoutersWithPositions(['NET1', 'R1', 'R2', 'R3'], slowConvergencePositions),
  links: [
    createLink('NET1', 'R1', 1, 2),
    createLink('R1', 'R2', 1, 2),
    createLink('R2', 'R3', 1, 2),
  ],
  supportedModes: ['rip'],
};

export const helloComparisonTopology: Topology = {
  id: 'hello-comparison',
  name: 'HELLO: delay frente a saltos',
  description: 'Camino corto en saltos pero lento contra camino mas largo y rapido.',
  routers: createRoutersWithPositions(['A', 'B', 'C', 'D', 'F'], helloComparisonPositions),
  links: [
    createLink('A', 'B', 1, 20, 20, 100, 100),
    createLink('B', 'F', 1, 20, 20, 100, 100),
    createLink('A', 'C', 1, 4, 5, 100, 100),
    createLink('C', 'D', 1, 4, 4, 100, 100),
    createLink('D', 'F', 1, 4, 5, 100, 100),
  ],
  supportedModes: ['hello'],
};

export const helloDirectionalTopology: Topology = {
  id: 'hello-directional',
  name: 'HELLO: delay direccional',
  description: 'Enlaces con delays distintos en cada sentido para mostrar rutas asimetricas.',
  routers: createRoutersWithPositions(['A', 'B', 'C', 'D', 'F'], helloComparisonPositions),
  links: [
    createLink('A', 'B', 1, 5, 16, 100, 100),
    createLink('B', 'F', 1, 5, 16, 100, 100),
    createLink('A', 'C', 1, 8, 4, 100, 100),
    createLink('C', 'D', 1, 8, 4, 100, 100),
    createLink('D', 'F', 1, 8, 4, 100, 100),
  ],
  supportedModes: ['hello'],
};

export const helloFlappingTopology: Topology = {
  id: 'hello-flapping',
  name: 'HELLO: route flapping',
  description: 'Camino digital de baja capacidad contra camino satelital de alta capacidad.',
  routers: createRoutersWithPositions(['A', 'D', 'S', 'F'], helloFlappingPositions),
  links: [
    createLink('A', 'D', 1, 3, 3, 10, 10),
    createLink('D', 'F', 1, 3, 3, 10, 10),
    createLink('A', 'S', 1, 9, 9, 30, 30),
    createLink('S', 'F', 1, 9, 9, 30, 30),
  ],
  supportedModes: ['hello'],
};

export const ospfHijackTopology: Topology = {
  id: 'ospf-hijack',
  name: 'OSPF: LSA falso',
  description: 'Un router interno anuncia un costo falso bajo para atraer trafico.',
  routers: createRoutersWithPositions(['A', 'B', 'C', 'F', 'M'], ospfHijackPositions).map((router) => ({
    ...router,
    isMalicious: router.id === 'M',
  })),
  links: [
    createLink('A', 'B', 4),
    createLink('B', 'C', 4),
    createLink('C', 'F', 4),
    createLink('A', 'M', 8),
    createLink('M', 'F', 20),
  ],
  supportedModes: ['ospf'],
};

export function getTopologyForMode(_mode: string): Topology {
  return intraASTopology;
}

export function getTopologyForScenario(mode: string, scenarioId?: string): Topology {
  if (scenarioId === 'rip-slow-convergence' || scenarioId === 'rip-split-horizon') {
    return ripSlowConvergenceTopology;
  }
  if (scenarioId === 'hello-hop-count-vs-delay' || scenarioId === 'hello-convergence') {
    return helloComparisonTopology;
  }
  if (scenarioId === 'hello-directional-delay') return helloDirectionalTopology;
  if (scenarioId === 'hello-route-flapping') return helloFlappingTopology;
  if (scenarioId === 'ospf-hijack') return ospfHijackTopology;
  return getTopologyForMode(mode);
}
