import type {
  Topology, SimulationMode, SimulationEvent, Packet, Metrics, LinkStateDatabase,
} from './types';
import { initStaticRouting, stepStatic } from './staticRouting';
import { initDistanceVector, stepDistanceVector, type DistanceVectorOptions } from './distanceVector';
import { initLinkState, stepLinkState, type LinkStateOptions } from './linkState';
import { initDelayBased, stepDelayBased, type HelloOptions } from './delayBased';

let eventCounter = 0;
function nextId(): string {
  return `evt-${++eventCounter}`;
}

export class SimulationEngine {
  private topology: Topology;
  private mode: SimulationMode;
  private _step: number = 0;
  private events: SimulationEvent[] = [];
  private packets: Packet[] = [];
  private messagesExchanged: number = 0;
  private _status: Metrics['status'] = 'stable';
  private activePath: string[] = [];
  private lsdb: LinkStateDatabase = {};
  private oscillationCount: number = 0;
  private lastRoute: string = '';
  private distanceVectorOptions: DistanceVectorOptions = {};
  private helloOptions: HelloOptions = {};
  private linkStateOptions: LinkStateOptions = {};

  constructor(topology: Topology, mode: SimulationMode) {
    this.topology = this.cloneTopology(topology);
    this.mode = mode;
    this.initialize();
  }

  private cloneTopology(t: Topology): Topology {
    return {
      ...t,
      routers: t.routers.map((r) => ({ ...r, routingTable: [] })),
      links: t.links.map((l) => ({ ...l })),
    };
  }

  private initialize() {
    this._step = 0;
    this.events = [];
    this.packets = [];
    this.messagesExchanged = 0;
    this._status = 'stable';
    this.activePath = [];
    this.oscillationCount = 0;
    this.lastRoute = '';

    switch (this.mode) {
      case 'static':
        initStaticRouting(this.topology);
        break;
      case 'rip':
        initDistanceVector(this.topology);
        this._status = 'converging';
        break;
      case 'ospf':
        initLinkState(this.topology, this.lsdb);
        break;
      case 'hello':
        initDelayBased(this.topology);
        break;
    }
  }

  reset(): void {
    this.topology = this.cloneTopology(this.topology);
    this.initialize();
  }

  getStep(): number {
    return this._step;
  }

  getEvents(): SimulationEvent[] {
    return [...this.events];
  }

  getStatus(): Metrics['status'] {
    return this._status;
  }

  getActivePath(): string[] {
    return [...this.activePath];
  }

  getTopology(): Topology {
    return this.topology;
  }

  setDistanceVectorOptions(options: DistanceVectorOptions): void {
    this.distanceVectorOptions = options;
  }

  setHelloOptions(options: HelloOptions): void {
    this.helloOptions = options;
  }

  setLinkStateOptions(options: LinkStateOptions): void {
    this.linkStateOptions = options;
  }

  preconverge(maxSteps = 12): void {
    for (let i = 0; i < maxSteps; i++) {
      this.doStep();
      if (this._status === 'stable') break;
    }
    this._step = 0;
    this.events = [];
    this.packets = [];
    this.messagesExchanged = 0;
    this.activePath = [];
  }

  getMessagesExchanged(): number {
    return this.messagesExchanged;
  }

  getRoutingTable(routerId: string) {
    const router = this.topology.routers.find((r) => r.id === routerId);
    return router ? [...router.routingTable] : [];
  }

  getMetrics(): Metrics {
    let totalCost = 0;
    for (let i = 0; i < this.activePath.length - 1; i++) {
      const link = this.topology.links.find(
        (l) =>
          (l.source === this.activePath[i] && l.target === this.activePath[i + 1]) ||
          (l.target === this.activePath[i] && l.source === this.activePath[i + 1])
      );
      if (link) totalCost += link.cost;
    }

    return {
      activePath: [...this.activePath],
      totalCost,
      hopCount: Math.max(0, this.activePath.length - 1),
      messagesExchanged: this.messagesExchanged,
      stepsToConverge: this._step,
      status: this._status,
    };
  }

  selectRouter(routerId: string): void {
    this.topology.routers.forEach((r) => {
      r.selected = r.id === routerId;
    });
  }

  doStep(): SimulationEvent[] {
    const stepEvents: SimulationEvent[] = [];
    this._step++;

    switch (this.mode) {
      case 'static':
        stepEvents.push(...stepStatic(this.topology, this._step));
        break;
      case 'rip':
        stepEvents.push(...stepDistanceVector(
          this.topology,
          this._step,
          this.messagesExchanged,
          this.distanceVectorOptions,
        ));
        this.messagesExchanged += stepEvents.filter((e) => e.type === 'message').length;
        if (stepEvents.some((e) => e.type === 'tableUpdate')) {
          this._status = 'converging';
        } else {
          this._status = 'stable';
        }
        break;
      case 'ospf':
        stepEvents.push(...stepLinkState(this.topology, this.lsdb, this._step, this.linkStateOptions));
        this.messagesExchanged += stepEvents.filter((e) => e.type === 'message').length;
        if (this._step === 1) {
          this._status = 'converging';
        } else {
          this._status = 'stable';
        }
        break;
      case 'hello':
        stepEvents.push(...stepDelayBased(this.topology, this._step, this.helloOptions));
        this.messagesExchanged += stepEvents.filter((e) => e.type === 'message').length;
        this.activePath = this.getRoutePath('A', 'F');
        const routeKey = this.activePath.join(',');
        if (routeKey && routeKey !== this.lastRoute) {
          this.oscillationCount++;
          if (this.helloOptions.trafficSensitive && this.oscillationCount > 3) {
            this._status = 'oscillating';
          }
          this.lastRoute = routeKey;
        }
        if (!this.helloOptions.trafficSensitive) {
          this._status = stepEvents.some((e) => e.type === 'tableUpdate') ? 'converging' : 'stable';
        } else if (this._status !== 'oscillating') {
          this._status = 'converging';
        }
        break;
    }

    this.events.push(...stepEvents);
    return stepEvents;
  }

  sendPacket(source: string, dest: string): Packet {
    const packet: Packet = {
      id: `pkt-${Date.now()}`,
      source,
      destination: dest,
      currentRouter: source,
      path: [source],
      status: 'traveling',
    };

    let current = source;
    const visited = new Set<string>();
    visited.add(current);

    while (current !== dest && packet.status === 'traveling') {
      const router = this.topology.routers.find((r) => r.id === current);
      if (!router) {
        packet.status = 'dropped';
        break;
      }

      const entry = router.routingTable.find((e) => e.destination === dest);
      if (!entry) {
        packet.status = 'dropped';
        this.events.push({
          id: nextId(),
          timestamp: Date.now(),
          type: 'packet',
          source: current,
          description: `Paquete descartado en ${current}: no hay ruta hacia ${dest}`,
        });
        break;
      }

      const nextHop = entry.nextHop;
      const link = this.topology.links.find(
        (l) =>
          !l.isDown &&
          ((l.source === current && l.target === nextHop) ||
            (l.target === current && l.source === nextHop))
      );

      if (!link) {
        packet.status = 'dropped';
        this.events.push({
          id: nextId(),
          timestamp: Date.now(),
          type: 'packet',
          source: current,
          description: `Paquete descartado en ${current}: enlace hacia ${nextHop} caído`,
        });
        break;
      }

      if (visited.has(nextHop)) {
        packet.status = 'dropped';
        this.events.push({
          id: nextId(),
          timestamp: Date.now(),
          type: 'packet',
          source: current,
          description: `Paquete descartado: bucle detectado en ${nextHop}`,
        });
        break;
      }

      current = nextHop;
      visited.add(current);
      packet.path.push(current);
      packet.currentRouter = current;
    }

    if (current === dest) {
      packet.status = 'delivered';
      this.events.push({
        id: nextId(),
        timestamp: Date.now(),
        type: 'packet',
        source,
        target: dest,
        description: `Paquete entregado: ${packet.path.join(' → ')} (costo: ${packet.path.length - 1} saltos)`,
      });
    }

    this.activePath = packet.status === 'delivered' ? [...packet.path] : [];
    this.packets.push(packet);

    this.topology.links.forEach((l) => (l.isActive = false));
    for (let i = 0; i < packet.path.length - 1; i++) {
      const link = this.topology.links.find(
        (l) =>
          (l.source === packet.path[i] && l.target === packet.path[i + 1]) ||
          (l.target === packet.path[i] && l.source === packet.path[i + 1])
      );
      if (link) link.isActive = true;
    }

    return packet;
  }

  private getRoutePath(source: string, dest: string): string[] {
    const path = [source];
    const visited = new Set(path);
    let current = source;

    while (current !== dest) {
      const router = this.topology.routers.find((r) => r.id === current);
      const entry = router?.routingTable.find((e) => e.destination === dest);
      if (!entry || visited.has(entry.nextHop)) return [];
      current = entry.nextHop;
      visited.add(current);
      path.push(current);
    }

    return path;
  }

  breakLink(linkId: string): void {
    const link = this.topology.links.find((l) => l.id === linkId);
    if (link) {
      link.isDown = true;
      link.isCongested = false;
      link.isActive = false;
      if (this.mode === 'rip') {
        this.invalidateRoutesThroughBrokenLink(link.source, link.target);
      }
      this.events.push({
        id: nextId(),
        timestamp: Date.now(),
        type: 'linkChange',
        source: link.source,
        target: link.target,
        description: `Enlace ${link.source} ↔ ${link.target} roto`,
        data: { kind: 'down', linkId },
      });
      this._status = 'converging';
    }
  }

  private invalidateRoutesThroughBrokenLink(source: string, target: string): void {
    for (const router of this.topology.routers) {
      if (router.id !== source && router.id !== target) continue;
      const brokenNeighbor = router.id === source ? target : source;
      const removed = router.routingTable.filter(
        (entry) => entry.nextHop === brokenNeighbor && entry.destination !== router.id
      );

      if (removed.length === 0) continue;

      router.routingTable = router.routingTable.filter(
        (entry) => entry.nextHop !== brokenNeighbor || entry.destination === router.id
      );

      for (const entry of removed) {
        this.events.push({
          id: nextId(),
          timestamp: Date.now(),
          type: 'tableUpdate',
          source: router.id,
          description: `${router.id} elimina ruta a ${entry.destination}: el enlace hacia ${brokenNeighbor} cayó`,
          data: { kind: 'removed', destination: entry.destination, nextHop: brokenNeighbor, cost: 16 },
        });
      }
    }
  }

  congestLink(linkId: string): void {
    const link = this.topology.links.find((l) => l.id === linkId);
    if (link) {
      link.isDown = false;
      link.isCongested = true;
      link.isActive = false;
      link.delay *= 3;
      this.events.push({
        id: nextId(),
        timestamp: Date.now(),
        type: 'linkChange',
        source: link.source,
        target: link.target,
        description: `Enlace ${link.source} ↔ ${link.target} congestionado (delay: ${link.delay})`,
      });
    }
  }

  restoreNetwork(): void {
    this.topology.links.forEach((l) => {
      l.isDown = false;
      l.isCongested = false;
      l.isActive = false;
      l.load = 0;
    });
    this.events.push({
      id: nextId(),
      timestamp: Date.now(),
      type: 'linkChange',
      source: 'system',
      description: 'Red restaurada completamente',
    });
    this._status = 'converging';
    this.activePath = [];
    this.oscillationCount = 0;
  }

  getLsdb(): LinkStateDatabase {
    return { ...this.lsdb };
  }

  getNarrative(): string {
    const recentEvents = this.events.slice(-6);
    const messages = recentEvents.filter((e) => e.type === 'message');
    const updates = recentEvents.filter((e) => e.type === 'tableUpdate');
    const convergence = recentEvents.find((e) => e.type === 'convergence');

    if (this._step === 0) {
      switch (this.mode) {
        case 'rip': return 'Cada router solo conoce a sus vecinos directos. Presiona "Paso" para que intercambien tablas.';
        case 'ospf': return 'Cada router detecta sus enlaces locales. Presiona "Paso" para generar y propagar LSAs.';
        case 'hello': return 'La red esta lista. Presiona "Paso" para ver como el delay afecta la seleccion de rutas.';
        case 'static': return 'Las rutas estan configuradas manualmente. Presiona "Enviar paquete" para ver el recorrido.';
        default: return 'Presiona "Paso" para comenzar.';
      }
    }

    if (convergence) return convergence.description;

    if (updates.length > 0) {
      const u = updates[0];
      const count = updates.length;
      if (count === 1) return u.description;
      return `${u.description} (${count - 1} actualizaciones mas en este paso).`;
    }

    if (messages.length > 0) {
      const m = messages[0];
      if (messages.length === 1) return m.description;
      return `${m.description} (${messages.length} mensajes enviados en total).`;
    }

    if (this._status === 'stable') return 'Red estable. Todas las tablas completas.';
    if (this._status === 'oscillating') return 'La red esta oscilando. Las rutas cambian constantemente.';
    return `Paso ${this._step} completado.`;
  }

  getPacketAnimations(events = this.events): { from: string; to: string; type: string; label?: string }[] {
    const anims: { from: string; to: string; type: string; label?: string }[] = [];
    let helloMessageAnimations = 0;
    for (const evt of events) {
      if (evt.type === 'message' && evt.target) {
        if (this.mode === 'hello' && this.helloOptions.trafficSensitive && helloMessageAnimations >= 2) continue;
        const subtype =
          this.mode === 'rip' ? 'dv' :
          this.mode === 'ospf'
            ? ((evt.data as { rejected?: boolean; malicious?: boolean } | undefined)?.rejected ||
              (evt.data as { rejected?: boolean; malicious?: boolean } | undefined)?.malicious
              ? 'lsa-rejected'
              : 'lsa')
            :
          this.mode === 'hello' ? 'hello' : 'dv';
        if (subtype === 'hello') helloMessageAnimations++;
        const data = evt.data as { lsaOrigin?: string } | undefined;
        anims.push({
          from: evt.source,
          to: evt.target,
          type: subtype,
          label:
            subtype === 'dv' ? 'R' :
            subtype === 'hello' ? 'H' :
            data?.lsaOrigin,
        });
      }
      if (evt.type === 'packet' && evt.target) {
        anims.push({ from: evt.source, to: evt.target, type: 'data' });
      }
    }
    return anims;
  }
}
