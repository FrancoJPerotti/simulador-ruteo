export interface RouterNode {
  id: string;
  label: string;
  x: number;
  y: number;
  routingTable: RoutingTableEntry[];
  lsdb?: LinkStateDatabase;
  isDown: boolean;
  selected: boolean;
  area?: string;
  isMalicious?: boolean;
}

export interface Link {
  id: string;
  source: string;
  target: string;
  cost: number;
  delay: number;
  forwardDelay: number;
  reverseDelay: number;
  measuredForwardDelay: number;
  measuredReverseDelay: number;
  forwardCapacity: number;
  reverseCapacity: number;
  forwardLoad: number;
  reverseLoad: number;
  load: number;
  isDown: boolean;
  isCongested: boolean;
  isActive: boolean;
}

export interface RoutingTableEntry {
  destination: string;
  nextHop: string;
  cost: number;
  metric: 'hops' | 'cost' | 'delay' | 'path';
  asPath?: string[];
  localPref?: number;
  learnedFrom: string;
  timestamp: number;
}

export type SimulationMode =
  | 'static'
  | 'rip'
  | 'ospf'
  | 'hello';

export type SimulationScenario =
  | 'sendPacket'
  | 'breakLink'
  | 'congestLink'
  | 'restoreNetwork'
  | 'stepConvergence';

export interface SimulationEvent {
  id: string;
  timestamp: number;
  type: 'message' | 'tableUpdate' | 'linkChange' | 'packet' | 'convergence';
  source: string;
  target?: string;
  description: string;
  data?: unknown;
}

export interface Packet {
  id: string;
  source: string;
  destination: string;
  currentRouter: string;
  path: string[];
  status: 'traveling' | 'delivered' | 'dropped';
}

export interface Topology {
  id: string;
  name: string;
  description: string;
  routers: RouterNode[];
  links: Link[];
  supportedModes: SimulationMode[];
}

export interface Metrics {
  activePath: string[];
  totalCost: number;
  hopCount: number;
  messagesExchanged: number;
  stepsToConverge: number;
  status: 'stable' | 'converging' | 'inconsistent' | 'oscillating';
}

export interface LinkStateAdvertisement {
  routerId: string;
  neighbors: { id: string; cost: number }[];
  sequence: number;
}

export interface LinkStateDatabase {
  [routerId: string]: LinkStateAdvertisement;
}
