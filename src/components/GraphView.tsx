import { useEffect, useRef, useCallback, useState, type CSSProperties } from 'react';
import cytoscape from 'cytoscape';
import type {
  Link, RouterNode, RoutingTableEntry, Topology, SimulationEvent, SimulationMode, LinkStateDatabase,
} from '../simulation/types';
import type { GraphAnimationContainer } from './graphAnimation';

const ROUTER_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64"><defs><linearGradient id="routerBody" x1="10" y1="12" x2="86" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect x="8" y="14" width="80" height="40" rx="10" fill="url(#routerBody)"/><rect x="16" y="23" width="64" height="6" rx="3" fill="#dbeafe" fill-opacity="0.95"/><circle cx="22" cy="40" r="4" fill="#dcfce7"/><circle cx="36" cy="40" r="4" fill="#bbf7d0"/><circle cx="50" cy="40" r="4" fill="#0f172a" fill-opacity="0.7"/><rect x="64" y="36" width="14" height="8" rx="4" fill="#0f172a" fill-opacity="0.72"/><path d="M18 54h60" stroke="#1e3a8a" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/></svg>'
)}`;

const MALICIOUS_ROUTER_SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64"><defs><linearGradient id="routerBody" x1="10" y1="12" x2="86" y2="52" gradientUnits="userSpaceOnUse"><stop stop-color="#fb7185"/><stop offset="1" stop-color="#dc2626"/></linearGradient></defs><rect x="8" y="14" width="80" height="40" rx="10" fill="url(#routerBody)"/><rect x="16" y="23" width="64" height="6" rx="3" fill="#fee2e2" fill-opacity="0.95"/><circle cx="22" cy="40" r="4" fill="#fecaca"/><circle cx="36" cy="40" r="4" fill="#fca5a5"/><circle cx="50" cy="40" r="4" fill="#450a0a" fill-opacity="0.78"/><rect x="64" y="36" width="14" height="8" rx="4" fill="#450a0a" fill-opacity="0.78"/><path d="M18 54h60" stroke="#7f1d1d" stroke-opacity="0.55" stroke-width="4" stroke-linecap="round"/></svg>'
)}`;

const PACKET_COLORS: Record<string, string> = {
  data: '#ec4899',
  dv: '#3b82f6',
  lsa: '#10b981',
  'lsa-rejected': '#ef4444',
  hello: '#38bdf8',
};

const PACKET_RADIUS: Record<string, number> = {
  data: 9,
  dv: 15,
  lsa: 16,
  'lsa-rejected': 16,
  hello: 15,
};

interface Sprite {
  id: string;
  x: number;
  y: number;
  color: string;
  radius: number;
  shape: 'circle' | 'square' | 'diamond';
  label?: string;
}

interface Viewport {
  pan: { x: number; y: number };
  zoom: number;
}

const ROUTER_WIDTH = 76;
const ROUTER_HEIGHT = 52;

type LabelSide = 'top' | 'bottom' | 'left' | 'right';

function getRouterLabelSide(router: RouterNode, routers: RouterNode[], links: Link[]): LabelSide {
  const counts: Record<LabelSide, number> = { top: 0, bottom: 0, left: 0, right: 0 };

  for (const link of links) {
    const otherId = link.source === router.id ? link.target : link.target === router.id ? link.source : null;
    if (!otherId) continue;

    const other = routers.find((r) => r.id === otherId);
    if (!other) continue;

    const dx = other.x - router.x;
    const dy = other.y - router.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      counts[dx > 0 ? 'right' : 'left'] += 1;
    } else {
      counts[dy > 0 ? 'bottom' : 'top'] += 1;
    }
  }

  return (['top', 'bottom', 'right', 'left'] as const).reduce((best, side) => (
    counts[side] < counts[best] ? side : best
  ));
}

function getRouterLabelStyle(side: LabelSide, routerWidth: number, routerHeight: number): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    padding: '3px 7px',
    borderRadius: 6,
    background: 'rgba(51, 65, 85, 0.82)',
    border: '1px solid rgba(148, 163, 184, 0.18)',
    color: '#e2e8f0',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };

  if (side === 'top') {
    return { ...base, left: routerWidth / 2, top: -6, transform: 'translate(-50%, -100%)' };
  }
  if (side === 'left') {
    return { ...base, left: -8, top: routerHeight / 2, transform: 'translate(-100%, -50%)' };
  }
  if (side === 'right') {
    return { ...base, left: routerWidth + 8, top: routerHeight / 2, transform: 'translateY(-50%)' };
  }
  return { ...base, left: routerWidth / 2, top: routerHeight + 6, transform: 'translateX(-50%)' };
}

function getRouterTableStyle(side: LabelSide, routerWidth: number, routerHeight: number): CSSProperties {
  if (side === 'top') {
    return { left: routerWidth / 2, top: -48, transform: 'translate(-50%, -100%)' };
  }
  if (side === 'left') {
    return { left: -52, top: routerHeight / 2, transform: 'translate(-100%, -50%)' };
  }
  if (side === 'right') {
    return { left: routerWidth + 52, top: routerHeight / 2, transform: 'translateY(-50%)' };
  }
  return { left: routerWidth / 2, top: routerHeight + 48, transform: 'translateX(-50%)' };
}

function formatMetric(mode: SimulationMode, entry: RoutingTableEntry): string {
  if (entry.cost === Infinity) return '∞';
  if (mode === 'hello') return entry.cost.toFixed(1);
  return String(entry.cost);
}

function getHelloVisualDelay(link: Link, direction: 'forward' | 'reverse'): string {
  const measuredDelay = direction === 'forward' ? link.measuredForwardDelay : link.measuredReverseDelay;
  return measuredDelay.toFixed(1);
}

function interpolateColor(start: string, end: string, amount: number): string {
  const clamped = Math.max(0, Math.min(1, amount));
  const startValue = Number.parseInt(start.slice(1), 16);
  const endValue = Number.parseInt(end.slice(1), 16);
  const startRgb = [(startValue >> 16) & 255, (startValue >> 8) & 255, startValue & 255];
  const endRgb = [(endValue >> 16) & 255, (endValue >> 8) & 255, endValue & 255];
  const [r, g, b] = startRgb.map((channel, index) => Math.round(channel + (endRgb[index] - channel) * clamped));
  return `rgb(${r}, ${g}, ${b})`;
}

function getLoadColor(utilization: number): string {
  if (utilization <= 0) return '#22c55e';
  if (utilization < 0.65) return interpolateColor('#22c55e', '#a3e635', utilization / 0.65);
  if (utilization < 1) return interpolateColor('#a3e635', '#eab308', (utilization - 0.65) / 0.35);
  return '#f59e0b';
}

function getLoadBackground(utilization: number): string {
  const clamped = Math.max(0, Math.min(1, utilization));
  const alpha = 0.18 + clamped * 0.52;
  return `color-mix(in srgb, ${getLoadColor(utilization)} ${Math.round(30 + clamped * 45)}%, rgba(5, 46, 22, ${alpha.toFixed(2)}))`;
}

interface HelloDirectedLink {
  id: string;
  linkId: string;
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  isDown: boolean;
  isCongested: boolean;
  isLoaded: boolean;
  utilization: number;
}

function getRouterBoundaryDistance(dx: number, dy: number, routerWidth: number, routerHeight: number): number {
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const ux = Math.abs(dx / length);
  const uy = Math.abs(dy / length);
  const horizontal = ux > 0 ? routerWidth / 2 / ux : Infinity;
  const vertical = uy > 0 ? routerHeight / 2 / uy : Infinity;
  return Math.min(horizontal, vertical);
}

function createHelloDirectedLink(
  id: string,
  linkId: string,
  from: RouterNode,
  to: RouterNode,
  side: number,
  text: string,
  isDown: boolean,
  isCongested: boolean,
  isLoaded: boolean,
  utilization: number,
  routerWidth: number,
  routerHeight: number,
): HelloDirectedLink {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const ux = dx / length;
  const uy = dy / length;
  const normalX = -uy;
  const normalY = ux;
  const offset = 11 * side;
  const boundaryDistance = getRouterBoundaryDistance(dx, dy, routerWidth, routerHeight);
  const startInset = Math.max(0, boundaryDistance - 2);
  const endInset = Math.max(0, boundaryDistance - 3);

  const x1 = from.x + normalX * offset + ux * startInset;
  const y1 = from.y + normalY * offset + uy * startInset;
  const x2 = to.x + normalX * offset - ux * endInset;
  const y2 = to.y + normalY * offset - uy * endInset;

  return {
    id,
    linkId,
    text,
    x1,
    y1,
    x2,
    y2,
    labelX: (x1 + x2) / 2,
    labelY: (y1 + y2) / 2,
    isDown,
    isCongested,
    isLoaded,
    utilization,
  };
}

function getHelloDirectedLinks(topology: Topology, routerWidth: number, routerHeight: number): HelloDirectedLink[] {
  return topology.links.flatMap((link) => {
    const source = topology.routers.find((router) => router.id === link.source);
    const target = topology.routers.find((router) => router.id === link.target);
    if (!source || !target) return [];

    const forwardUtilization = link.forwardLoad / Math.max(0.1, link.forwardCapacity);
    const reverseUtilization = link.reverseLoad / Math.max(0.1, link.reverseCapacity);

    return [
      createHelloDirectedLink(
        `${link.id}:forward-label`,
        link.id,
        source,
        target,
        1,
        getHelloVisualDelay(link, 'forward'),
        link.isDown,
        link.isCongested || link.forwardLoad >= link.forwardCapacity,
        link.forwardLoad > 0,
        forwardUtilization,
        routerWidth,
        routerHeight,
      ),
      createHelloDirectedLink(
        `${link.id}:reverse-label`,
        link.id,
        target,
        source,
        1,
        getHelloVisualDelay(link, 'reverse'),
        link.isDown,
        link.isCongested || link.reverseLoad >= link.reverseCapacity,
        link.reverseLoad > 0,
        reverseUtilization,
        routerWidth,
        routerHeight,
      ),
    ];
  });
}

interface GraphViewProps {
  topology: Topology;
  selectedRouter: string | null;
  onRouterSelect: (id: string) => void;
  onLinkContextMenu: (linkId: string, x: number, y: number) => void;
  mode: SimulationMode;
  topologyVersion: number;
  currentStepEvents: SimulationEvent[];
  visibleStepEvents: SimulationEvent[];
  previousRoutingTables: Record<string, RoutingTableEntry[]>;
  previousLsdbs: Record<string, LinkStateDatabase>;
  showOspfLsdb: boolean;
  rejectedRouterIds: string[];
  displayStep: number;
  isOspfSpfAnimating: boolean;
}

interface TableUpdateData {
  kind?: 'new' | 'changed' | 'removed';
  destination?: string;
  nextHop?: string;
  cost?: number;
}

interface LinkChangeData {
  kind?: 'down' | 'congested' | 'restored';
  linkId?: string;
}

type RouteHighlightKind = 'new' | 'changed' | 'removed';

function getRouteHighlightKind(
  event: SimulationEvent,
  router: RouterNode,
  previousRoutingTables: Record<string, RoutingTableEntry[]>,
): [string, RouteHighlightKind] | null {
  const data = (event.data || {}) as TableUpdateData;
  if (event.type !== 'tableUpdate' || event.source !== router.id || !data.destination) return null;

  const kind = data.kind || 'changed';
  const existedBefore = previousRoutingTables[router.id]?.some((entry) => entry.destination === data.destination);
  const existsNow = router.routingTable.some((entry) => entry.destination === data.destination);

  if (kind === 'new' && existedBefore) {
    return [data.destination, 'changed'];
  }

  if (kind === 'removed' && existsNow) {
    return [data.destination, 'changed'];
  }

  return [data.destination, kind];
}

function getHighlightedDestinations(
  events: SimulationEvent[],
  router: RouterNode,
  previousRoutingTables: Record<string, RoutingTableEntry[]>,
): Map<string, RouteHighlightKind> {
  const priority: Record<RouteHighlightKind, number> = { new: 1, removed: 2, changed: 3 };
  const result = new Map<string, RouteHighlightKind>();
  for (const event of events) {
    const highlight = getRouteHighlightKind(event, router, previousRoutingTables);
    if (!highlight) continue;
    const [destination, kind] = highlight;
    const current = result.get(destination);
    if (!current || priority[kind] >= priority[current]) result.set(destination, kind);
  }
  return result;
}

function getShape(type: string): Sprite['shape'] {
  if (type === 'dv') return 'square';
  return 'circle';
}

function getVisualRoutingTable(
  router: RouterNode,
  currentStepEvents: SimulationEvent[],
  visibleStepEvents: SimulationEvent[],
  previousRoutingTables: Record<string, RoutingTableEntry[]>,
  freezeCurrentTable: boolean,
  showPendingNewRoutes: boolean,
): RoutingTableEntry[] {
  if (freezeCurrentTable) return sortRoutingEntries(previousRoutingTables[router.id] || []);

  const visibleIds = new Set(visibleStepEvents.map((event) => event.id));
  const result = router.routingTable.filter((entry) => {
    if (showPendingNewRoutes) return true;

    const pendingNew = currentStepEvents.some((event) => {
      const data = (event.data || {}) as TableUpdateData;
      return event.type === 'tableUpdate' &&
        event.source === router.id &&
        data.kind === 'new' &&
        data.destination === entry.destination &&
        !visibleIds.has(event.id);
    });
    return !pendingNew;
  });

  for (const event of currentStepEvents) {
    const data = (event.data || {}) as TableUpdateData;
    if (event.type !== 'tableUpdate' || event.source !== router.id || visibleIds.has(event.id)) continue;
    if (data.kind === 'changed' && data.destination) {
      const previous = previousRoutingTables[router.id]?.find((entry) => entry.destination === data.destination);
      const index = result.findIndex((entry) => entry.destination === data.destination);
      if (previous && index >= 0) result[index] = previous;
    }
  }

  for (const event of currentStepEvents) {
    const data = (event.data || {}) as TableUpdateData;
    if (event.type !== 'tableUpdate' || event.source !== router.id) continue;
    if (data.kind === 'removed' && data.destination) {
      const previous = previousRoutingTables[router.id]?.find((entry) => entry.destination === data.destination);
      if (previous && !result.some((entry) => entry.destination === data.destination)) result.push(previous);
    }
  }

  return sortRoutingEntries(result);
}

function sortRoutingEntries(entries: RoutingTableEntry[]): RoutingTableEntry[] {
  return [...entries].sort((a, b) => a.destination.localeCompare(b.destination));
}

function WaterMark() {
  const [show, setShow] = useState(false);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        zIndex: 30,
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {show && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 8,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            color: '#e2e8f0',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.5,
            whiteSpace: 'nowrap',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          <div>Arnaudo, Federico</div>
          <div>Krede, Julian</div>
          <div>Perotti, Franco</div>
          <div>Piñera, Nicolas</div>
        </div>
      )}
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 14,
          fontWeight: 700,
          color: 'rgba(148, 163, 184, 0.18)',
          letterSpacing: '0.08em',
        }}
      >
        Puerto 1337
      </div>
    </div>
  );
}

export function GraphView({
  topology, selectedRouter, onRouterSelect, onLinkContextMenu, mode, topologyVersion,
  currentStepEvents, visibleStepEvents, previousRoutingTables, previousLsdbs, showOspfLsdb, rejectedRouterIds, displayStep,
  isOspfSpfAnimating,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ pan: { x: 0, y: 0 }, zoom: 1 });
  const safeZoom = Math.max(0.01, viewport.zoom);

  // LSDB snapshot: solo se actualiza cuando displayStep cambia
  const displayedLsdbRef = useRef<Record<string, LinkStateDatabase>>({});
  const [lsdbHighlights, setLsdbHighlights] = useState<Record<string, { new: Set<string>; changed: Set<string> }>>({});
  const lsdbTimerRef = useRef<number | null>(null);
  const visibleEventIds = new Set(visibleStepEvents.map((event) => event.id));
  const hasPendingOspfFlood = mode === 'ospf' && currentStepEvents.some(
    (event) => event.type === 'message' && !visibleEventIds.has(event.id)
  );
  const hasCurrentOspfRouteUpdates = mode === 'ospf' && currentStepEvents.some((event) => {
    const data = (event.data || {}) as TableUpdateData;
    return event.type === 'tableUpdate' && event.id.startsWith('spf-') && !!data.destination;
  });
  const isOspfSpfTransition = hasCurrentOspfRouteUpdates && !hasPendingOspfFlood;
  const showOspfSpfCalculation = isOspfSpfTransition || isOspfSpfAnimating;
  const spfTransitionKey = currentStepEvents.map((event) => event.id).join('|');
  const [spfRowsRevealed, setSpfRowsRevealed] = useState(false);

  useEffect(() => {
    if (!showOspfSpfCalculation) {
      setSpfRowsRevealed(false);
      return;
    }

    setSpfRowsRevealed(false);
    const timer = window.setTimeout(() => setSpfRowsRevealed(true), 1850);
    return () => clearTimeout(timer);
  }, [showOspfSpfCalculation, spfTransitionKey]);

  useEffect(() => {
    const prevSnapshot = displayedLsdbRef.current;
    const newSnapshot: Record<string, LinkStateDatabase> = {};
    const newHighlights: Record<string, { new: Set<string>; changed: Set<string> }> = {};
    for (const router of topology.routers) {
      if (!router.lsdb) continue;
      newSnapshot[router.id] = { ...router.lsdb };
      const prev = prevSnapshot[router.id] || {};
      const curr = router.lsdb;
      const newSet = new Set<string>();
      const changedSet = new Set<string>();
      for (const [id, lsa] of Object.entries(curr)) {
        const prevLsa = prev[id];
        if (!prevLsa) {
          newSet.add(id);
        } else if (prevLsa.sequence !== lsa.sequence || JSON.stringify(prevLsa.neighbors) !== JSON.stringify(lsa.neighbors)) {
          changedSet.add(id);
        }
      }
      if (newSet.size > 0 || changedSet.size > 0) {
        newHighlights[router.id] = { new: newSet, changed: changedSet };
      }
    }
    displayedLsdbRef.current = newSnapshot;
    if (Object.keys(newHighlights).length > 0) {
      setLsdbHighlights(newHighlights);
      if (lsdbTimerRef.current) clearTimeout(lsdbTimerRef.current);
      lsdbTimerRef.current = window.setTimeout(() => setLsdbHighlights({}), 2500);
    }
    return () => {
      if (lsdbTimerRef.current) clearTimeout(lsdbTimerRef.current);
    };
  }, [displayStep, mode]);
  const renderedRouterWidth = Math.min(120, Math.max(32, ROUTER_WIDTH * safeZoom));
  const renderedRouterHeight = Math.min(82, Math.max(22, ROUTER_HEIGHT * safeZoom));
  const routerGraphWidth = renderedRouterWidth / safeZoom;
  const routerGraphHeight = renderedRouterHeight / safeZoom;
  const rejectedRouters = new Set(rejectedRouterIds);

  const getElements = useCallback(() => {
    const nodes = topology.routers.map((r) => ({
      data: {
        id: r.id,
        label: r.label,
        isDown: r.isDown,
        selected: r.selected || r.id === selectedRouter,
      },
      position: { x: r.x, y: r.y },
    }));

    const edges = topology.links.flatMap((l) => {
      if (mode !== 'hello') {
        return [{
          data: {
            id: l.id,
            linkId: l.id,
            source: l.source,
            target: l.target,
            cost: mode === 'rip' ? '' : l.cost.toString(),
            isDown: l.isDown,
            isCongested: l.isCongested,
            isActive: l.isActive,
            isAuthRejected: rejectedRouters.has(l.source) || rejectedRouters.has(l.target),
          },
        }];
      }

      return [
        {
          data: {
            id: `${l.id}:forward`,
            linkId: l.id,
            direction: 'forward',
            source: l.source,
            target: l.target,
            cost: '',
            isDown: l.isDown,
            isCongested: l.isCongested || l.forwardLoad >= l.forwardCapacity,
            isActive: l.isActive,
            isAuthRejected: false,
          },
        },
        {
          data: {
            id: `${l.id}:reverse`,
            linkId: l.id,
            direction: 'reverse',
            source: l.target,
            target: l.source,
            cost: '',
            isDown: l.isDown,
            isCongested: l.isCongested || l.reverseLoad >= l.reverseCapacity,
            isActive: l.isActive,
            isAuthRejected: false,
          },
        },
      ];
    });

    return [...nodes, ...edges];
  }, [topology, selectedRouter, mode, rejectedRouterIds]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!graphRef.current) return;

    const cy = cytoscape({
      container: graphRef.current,
      elements: getElements(),
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#000000',
            'background-opacity': 0,
            'opacity': 0,
            'border-color': 'transparent',
            'border-width': 0,
            'label': '',
            'width': 8,
            'height': 8,
          } as unknown as cytoscape.Css.Node,
        },
        {
          selector: 'node:selected, node[?selected]',
          style: {
            'opacity': 0,
          } as unknown as cytoscape.Css.Node,
        },
        {
          selector: 'node[?isDown]',
          style: {
            'opacity': 0,
          } as unknown as cytoscape.Css.Node,
        },
        {
          selector: 'edge',
          style: {
            'line-color': '#22c55e',
            'width': 2.5,
            'label': 'data(cost)',
            'font-size': '10px',
            'font-weight': '600',
            'font-family': 'JetBrains Mono, monospace',
            'color': '#22c55e',
            'text-background-color': '#0a1a10',
            'text-background-opacity': 0.9,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'curve-style': 'bezier',
          } as unknown as cytoscape.Css.Edge,
        },
        {
          selector: 'edge[direction = "forward"]',
          style: {
            'opacity': 0,
            'width': 12,
            'target-arrow-shape': 'none',
          } as unknown as cytoscape.Css.Edge,
        },
        {
          selector: 'edge[direction = "reverse"]',
          style: {
            'opacity': 0,
            'width': 12,
            'target-arrow-shape': 'none',
          } as unknown as cytoscape.Css.Edge,
        },
        {
          selector: 'edge[?isActive]',
          style: {
            'line-color': '#86efac',
            'width': 4,
            'color': '#86efac',
            'text-background-color': '#052e16',
          } as unknown as cytoscape.Css.Edge,
        },
        {
          selector: 'edge[?isCongested]',
          style: {
            'line-color': '#eab308',
            'width': 3.5,
            'color': '#eab308',
            'text-background-color': '#1a1508',
          } as unknown as cytoscape.Css.Edge,
        },
        {
          selector: 'edge[?isAuthRejected]',
          style: {
            'line-color': '#64748b',
            'width': 2.25,
            'line-style': 'dotted',
            'opacity': 0.62,
            'color': '#94a3b8',
            'text-background-color': '#111827',
          } as unknown as cytoscape.Css.Edge,
        },
        {
          selector: 'edge[?isDown]',
          style: {
            'line-color': '#ef4444',
            'width': 2,
            'line-style': 'dashed',
            'opacity': 0.5,
            'color': '#ef4444',
            'text-background-color': '#1a0a0a',
          } as unknown as cytoscape.Css.Edge,
        },
      ],
      layout: { name: 'preset' },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.4,
      maxZoom: 3,
    });

    cy.on('tap', 'node', (evt) => {
      onRouterSelect(evt.target.id());
    });

    cy.on('cxttap', 'edge', (evt) => {
      evt.originalEvent.preventDefault();
      const renderedPos = evt.renderedPosition;
      onLinkContextMenu(evt.target.data('linkId') || evt.target.id(), renderedPos.x, renderedPos.y);
    });

    const updateViewport = () => {
      setViewport({ pan: cy.pan(), zoom: cy.zoom() });
    };
    cy.on('pan zoom resize', updateViewport);
    updateViewport();

    // Fit all elements into view with padding, then zoom out from center
    cy.fit(cy.elements(), 40);
    cy.zoom({
      level: cy.zoom() * 0.82,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
    updateViewport();

    cyRef.current = cy;

    return () => {
      cy.off('pan zoom resize', updateViewport);
      cy.destroy();
      cyRef.current = null;
    };
  }, [mode]);

  // Sync elements (add/update/remove) AND force style recalculation when topology changes
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const elements = getElements();
    const ids = new Set(elements.map((el) => el.data.id));

    // Remove elements that no longer exist
    cy.elements().forEach((el) => {
      if (!ids.has(el.id())) {
        cy.remove(el);
      }
    });

    // Add new elements or update existing ones
    for (const el of elements) {
      const existing = cy.getElementById(el.data.id);
      if (existing.length > 0) {
        existing.data(el.data);
        if ('position' in el && el.position) {
          existing.position(el.position);
        }
      } else {
        cy.add(el);
      }
    }

    // Force Cytoscape to re-evaluate styles
    cy.style().update();
  }, [topologyVersion, selectedRouter, getElements]);

  // Convert graph coordinates to screen coordinates
  const graphToScreen = useCallback((graphX: number, graphY: number): { x: number; y: number } => {
    const cy = cyRef.current;
    if (!cy) return { x: 0, y: 0 };
    const pan = cy.pan();
    const zoom = cy.zoom();
    return {
      x: graphX * zoom + pan.x,
      y: graphY * zoom + pan.y,
    };
  }, []);

  // Animate a sprite from one node to another using HTML overlay
  // Interpolates in graph space so pan/zoom updates are reflected live
  const animateMovement = useCallback((
    fromId: string, toId: string, packetType: string, duration: number, label?: string
  ): Promise<void> => {
    return new Promise((resolve) => {
      const cy = cyRef.current;
      if (!cy) { resolve(); return; }

      const fromNode = cy.getElementById(fromId);
      const toNode = cy.getElementById(toId);
      if (fromNode.length === 0 || toNode.length === 0) { resolve(); return; }

      // Store graph coordinates (fixed)
      const fromGraph = fromNode.position();
      const toGraph = toNode.position();

      const id = `sprite-${Date.now()}-${Math.random()}`;
      const color = PACKET_COLORS[packetType] || '#22c55e';
      const radius = PACKET_RADIUS[packetType] || 6;
      const shape = getShape(packetType);

      // Add sprite at start position (converted to screen)
      const startScreen = graphToScreen(fromGraph.x, fromGraph.y);
      setSprites((prev) => [...prev, {
        id, x: startScreen.x, y: startScreen.y, color, radius, shape, label,
      }]);

      // Animate: interpolate in graph space, convert to screen each frame
      const startTime = performance.now();
      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease in-out quad
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        // Interpolate in graph space
        const graphX = fromGraph.x + (toGraph.x - fromGraph.x) * eased;
        const graphY = fromGraph.y + (toGraph.y - fromGraph.y) * eased;

        // Convert to screen space (uses current pan/zoom)
        const screen = graphToScreen(graphX, graphY);

        setSprites((prev) => prev.map((s) =>
          s.id === id ? { ...s, x: screen.x, y: screen.y } : s
        ));

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setSprites((prev) => prev.filter((s) => s.id !== id));
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }, [graphToScreen]);

  // Expose animateMovement
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as GraphAnimationContainer).__animateMovement = animateMovement;
    }
  }, [animateMovement]);

  return (
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={graphRef} style={{ position: 'absolute', inset: 0 }} />
      {mode === 'hello' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11 }}>
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
            {getHelloDirectedLinks(topology, routerGraphWidth, routerGraphHeight).map((link) => {
              const from = graphToScreen(link.x1, link.y1);
              const to = graphToScreen(link.x2, link.y2);
              const color = link.isDown ? '#ef4444' : getLoadColor(link.utilization);
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
              const ux = dx / length;
              const uy = dy / length;
              const normalX = -uy;
              const normalY = ux;
              const arrowLength = 10;
              const arrowWidth = 7;
              const shaftEnd = {
                x: to.x - ux * arrowLength,
                y: to.y - uy * arrowLength,
              };
              const arrowPoints = [
                `${to.x},${to.y}`,
                `${shaftEnd.x + normalX * arrowWidth / 2},${shaftEnd.y + normalY * arrowWidth / 2}`,
                `${shaftEnd.x - normalX * arrowWidth / 2},${shaftEnd.y - normalY * arrowWidth / 2}`,
              ].join(' ');

              return (
                <g key={`${link.id}-line`}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="transparent"
                    strokeWidth={18}
                    style={{ pointerEvents: 'stroke' }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onLinkContextMenu(link.linkId, event.clientX, event.clientY);
                    }}
                  />
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={shaftEnd.x}
                    y2={shaftEnd.y}
                    stroke={color}
                    strokeWidth={link.isCongested ? 4.6 : link.isLoaded ? 3.6 + Math.min(0.8, link.utilization) : 3.2}
                    strokeLinecap="round"
                    opacity={link.isDown ? 0.55 : link.isLoaded || link.isCongested ? 1 : 0.82}
                    strokeDasharray={link.isDown ? '8 7' : undefined}
                  />
                  <polygon
                    points={arrowPoints}
                    fill={color}
                    opacity={link.isDown ? 0.55 : 1}
                  />
                </g>
              );
            })}
          </svg>
          {getHelloDirectedLinks(topology, routerGraphWidth, routerGraphHeight).map((link) => {
            const screen = graphToScreen(link.labelX, link.labelY);
            const loadColor = getLoadColor(link.utilization);
            return (
              <div
                key={link.id}
                style={{
                  position: 'absolute',
                  left: screen.x,
                  top: screen.y,
                  transform: 'translate(-50%, -50%)',
                  padding: '5px 10px',
                  borderRadius: 7,
                  background: link.isDown ? 'rgba(69, 10, 10, 0.9)' : getLoadBackground(link.utilization),
                  border: link.isDown
                    ? '1px solid rgba(239, 68, 68, 0.3)'
                    : `1px solid ${loadColor}`,
                  color: link.isDown ? '#fca5a5' : loadColor,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 800,
                  fontSize: Math.min(24, Math.max(11, 15 * viewport.zoom)),
                  lineHeight: 1,
                  letterSpacing: '0.02em',
                  boxShadow: '0 8px 18px rgba(0, 0, 0, 0.28)',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {link.text}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 19 }}>
        {sprites.map((s) => {
          const size = s.radius * 2;
          const borderRadius = s.shape === 'circle' ? '50%' : s.shape === 'diamond' ? '2px' : '2px';
          const transform = s.shape === 'diamond' ? 'translate(-50%, -50%) rotate(45deg)' : 'translate(-50%, -50%)';
          const innerTransform = s.shape === 'diamond' ? 'translate(-50%, -50%) rotate(-45deg)' : 'translate(-50%, -50%)';

          return (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                left: s.x,
                top: s.y,
                width: size,
                height: size,
                borderRadius,
                backgroundColor: s.color,
                border: '2px solid rgba(255, 255, 255, 0.92)',
                boxShadow: `0 0 0 4px ${s.color}35, 0 0 22px ${s.color}cc`,
                pointerEvents: 'none',
                transform,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: Math.max(5, s.radius * 0.75),
                  height: Math.max(5, s.radius * 0.75),
                  borderRadius: s.shape === 'circle' ? '50%' : 2,
                  background: 'rgba(255, 255, 255, 0.78)',
                  opacity: 0.9,
                  transform: innerTransform,
                }}
              />
              {s.label && (
                <span
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: innerTransform,
                    color: '#052e16',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: Math.max(10, s.radius * 0.78),
                    fontWeight: 900,
                    lineHeight: 1,
                    textShadow: '0 1px 1px rgba(255, 255, 255, 0.55)',
                  }}
                >
                  {s.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 12 }}>
        {visibleStepEvents
          .filter((event) => {
            const data = (event.data || {}) as LinkChangeData;
            return event.type === 'linkChange' && data.kind === 'down' && event.target;
          })
          .map((event) => {
            const source = topology.routers.find((router) => router.id === event.source);
            const target = topology.routers.find((router) => router.id === event.target);
            if (!source || !target) return null;

            const from = graphToScreen(source.x, source.y);
            const to = graphToScreen(target.x, target.y);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;

            return (
              <div
                key={event.id}
                className="link-failure-effect"
                style={{
                  left: from.x,
                  top: from.y,
                  width: length,
                  transform: `rotate(${angle}deg)`,
                }}
              >
                <span className="link-failure-line" />
                <span className="link-failure-spark" />
              </div>
            );
          })}
      </div>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
        {topology.routers.map((router) => {
          const selected = router.selected || router.id === selectedRouter;
          const highlightEvents = showOspfSpfCalculation ? currentStepEvents : visibleStepEvents;
          const highlightedDestinations = getHighlightedDestinations(
            highlightEvents,
            router,
            previousRoutingTables,
          );
          const visualRoutingTable = getVisualRoutingTable(
            router,
            currentStepEvents,
            visibleStepEvents,
            previousRoutingTables,
            hasPendingOspfFlood,
            showOspfSpfCalculation,
          );
          const x = router.x * viewport.zoom + viewport.pan.x;
          const y = router.y * viewport.zoom + viewport.pan.y;
          const routerWidth = Math.min(120, Math.max(32, ROUTER_WIDTH * viewport.zoom));
          const routerHeight = Math.min(82, Math.max(22, ROUTER_HEIGHT * viewport.zoom));
          const labelFontSize = Math.min(22, Math.max(10, 10 * viewport.zoom));
          const labelSide = getRouterLabelSide(router, topology.routers, topology.links);

          return (
            <div
              key={router.id}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
                opacity: router.isDown ? 0.4 : 1,
              }}
            >
              <button
                type="button"
                aria-label={`Router ${router.label}`}
                onClick={() => onRouterSelect(router.id)}
                style={{
                  width: routerWidth,
                  height: routerHeight,
                  padding: 0,
                  border: selected ? '2px solid #ffffff' : '2px solid transparent',
                  borderRadius: 12,
                  background: 'transparent',
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                }}
              >
                <img
                  src={router.isMalicious ? MALICIOUS_ROUTER_SVG : ROUTER_SVG}
                  alt=""
                  draggable={false}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                  }}
                />
              </button>
              <div
                style={{
                  ...getRouterLabelStyle(labelSide, routerWidth, routerHeight),
                  fontSize: labelFontSize,
                }}
              >
                {router.label}
              </div>
              {mode === 'ospf' && showOspfLsdb && displayStep <= 1 && !showOspfSpfCalculation ? (
                <div
                  className="mini-routing-table mini-lsdb"
                  style={{
                    position: 'absolute',
                    ...getRouterTableStyle(labelSide, routerWidth, routerHeight),
                  }}
                >
                  <div className="mini-table-title">LSDB</div>
                  <div className="mini-routing-table-head" style={{ gridTemplateColumns: '1fr 2fr' }}>
                    <span>Router</span>
                    <span>Vecinos</span>
                  </div>
                  {(() => {
                    const pendingSnapshot = previousLsdbs[router.id];
                    const snapshot = hasPendingOspfFlood && pendingSnapshot
                      ? pendingSnapshot
                      : displayedLsdbRef.current[router.id];
                    const hasSnapshot = snapshot && Object.keys(snapshot).length > 0;
                    const lsdbToShow = hasSnapshot ? snapshot : (router.lsdb || {});
                    return Object.entries(lsdbToShow).map(([lsaRouterId, lsa]) => {
                      const hl = lsdbHighlights[router.id];
                      const isNew = hl?.new.has(lsaRouterId);
                      const isChanged = hl?.changed.has(lsaRouterId);
                      const rowClass = isNew ? 'highlight new' : isChanged ? 'highlight changed' : '';
                      return (
                        <div
                          key={lsaRouterId}
                          className={`mini-routing-table-row ${rowClass}`}
                          style={{ gridTemplateColumns: '1fr 2fr' }}
                        >
                          <span>{lsaRouterId}</span>
                          <span style={{ fontSize: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {lsa.neighbors.map((n) => `${n.id}(${n.cost})`).join(' ')}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                <div
                  className={`mini-routing-table ${showOspfSpfCalculation ? 'ospf-spf-table' : ''}`}
                  style={{
                    position: 'absolute',
                    ...getRouterTableStyle(labelSide, routerWidth, routerHeight),
                  }}
                >
                  {showOspfSpfCalculation && !spfRowsRevealed && (
                    <div className="ospf-spf-calculation" aria-hidden="true">
                      <span className="ospf-calc-node node-source" />
                      <span className="ospf-calc-node node-a" />
                      <span className="ospf-calc-node node-b" />
                      <span className="ospf-calc-node node-c" />
                      <span className="ospf-calc-link link-a" />
                      <span className="ospf-calc-link link-b" />
                      <span className="ospf-calc-link link-c" />
                      <span className="ospf-calc-frontier" />
                    </div>
                  )}
                  <div className="mini-table-title">RUTAS</div>
                  <div className="mini-routing-table-head">
                    <span>Dst</span>
                    <span>Via</span>
                    <span>{mode === 'rip' ? 'Hop' : 'Met'}</span>
                  </div>
                  {visualRoutingTable.map((entry, index) => (
                    <div
                      key={entry.destination}
                      className={`mini-routing-table-row ${showOspfSpfCalculation && !spfRowsRevealed ? 'ospf-spf-row' : ''} ${highlightedDestinations.has(entry.destination) ? `highlight ${highlightedDestinations.get(entry.destination)}` : ''}`}
                      style={showOspfSpfCalculation && !spfRowsRevealed ? { '--ospf-row-delay': `${1850 + index * 85}ms` } as CSSProperties : undefined}
                    >
                      <span>{entry.destination}</span>
                      <span>{entry.nextHop}</span>
                      <span>{formatMetric(mode, entry)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <WaterMark />
    </div>
  );
}
