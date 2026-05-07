import { useState, useCallback, useEffect, useRef } from "react";
import { SimulationEngine } from "./simulation/engine";
import type {
  SimulationMode,
  Metrics,
  RoutingTableEntry,
  SimulationEvent,
  LinkStateDatabase,
} from "./simulation/types";
import { getTopologyForMode, getTopologyForScenario } from "./data/topologies";
import {
  scenarios,
  type Scenario,
  type ScenarioStep,
} from "./scenarios/scenarios";
import { GraphView } from "./components/GraphView";
import { animateOnGraph } from "./components/graphAnimation";
import { TopBar } from "./components/TopBar";
import { ScenarioPanel } from "./components/ScenarioPanel";
import { NarrativeBar } from "./components/NarrativeBar";
import { RouterPopup } from "./components/RouterPopup";
import { ContextMenu } from "./components/ContextMenu";
import { FeatureToggle } from "./components/FeatureToggle";
import "./index.css";

const MODE_COLORS: Record<SimulationMode, string> = {
  static: "#6b7280",
  rip: "#3b82f6",
  ospf: "#10b981",
  hello: "#f59e0b",
};

const NORMAL_ANIMATION = {
  duration: 2200,
  stagger: 250,
  settle: 250,
  autoInterval: 5200,
};
const FAST_ANIMATION = {
  duration: 150,
  stagger: 30,
  settle: 50,
  autoInterval: 400,
};
const DATA_PACKET_HOP_DURATION = 1300;
const OSPF_SPF_REVEAL_MS = 1850;

type RoutingTableSnapshot = Record<string, RoutingTableEntry[]>;
type LsdbSnapshot = Record<string, LinkStateDatabase>;

function cloneLsdb(lsdb: LinkStateDatabase): LinkStateDatabase {
  return Object.fromEntries(
    Object.entries(lsdb).map(([routerId, lsa]) => [
      routerId,
      { ...lsa, neighbors: lsa.neighbors.map((neighbor) => ({ ...neighbor })) },
    ]),
  );
}

const PRECONVERGED_SCENARIOS = new Set([
  "rip-link-failure",
  "rip-vs-ospf",
  "ospf-link-failure",
]);
const RIP_LINEAR_FAILURE_SCENARIOS = new Set([
  "rip-slow-convergence",
  "rip-split-horizon",
]);
const HELLO_TRAFFIC_SCENARIOS = new Set(["hello-route-flapping"]);
const LOOPING_SCENARIOS = new Set(["hello-route-flapping"]);

const OSPF_HIJACK_OPEN_STEPS: ScenarioStep[] = [
  {
    narrative: [
      "OSPF esta sin autenticacion",
      "M representa un router interno malicioso o mal configurado",
      "Antes del ataque se decide si los LSAs seran validados",
      "Sin autenticacion, los routers confian en anuncios internos",
    ],
    action: "init",
  },
  {
    narrative: [
      "M inunda un LSA falso",
      "Anuncia llegar a F con costo artificialmente bajo",
      "Los demas routers aceptan esa informacion como parte de la LSDB",
    ],
    action: "step",
  },
  {
    narrative: [
      "SPF recalcula usando el LSA falso",
      "Algunas rutas se desvian hacia M",
      "Este es el riesgo de confiar en anuncios internos sin autenticacion",
    ],
    action: "step",
  },
  {
    narrative: [
      "Ataque efectivo",
      "La red queda estable, pero con rutas contaminadas",
      "El problema no es la convergencia, sino confiar en informacion falsa",
    ],
    action: "settle",
  },
];

const OSPF_HIJACK_AUTH_STEPS: ScenarioStep[] = [
  {
    narrative: [
      "OSPF tiene autenticacion habilitada",
      "M sigue siendo un router interno malicioso o mal configurado",
      "Los routers validan los LSAs antes de aceptarlos",
    ],
    action: "init",
  },
  {
    narrative: [
      "M intenta inundar un LSA falso",
      "Sus vecinos rechazan el anuncio por autenticacion invalida",
      "El LSA de M no entra en la LSDB confiable",
    ],
    action: "step",
  },
  {
    narrative: [
      "SPF recalcula solo con LSAs validos",
      "Las rutas no se desvian hacia M",
      "La autenticacion evita el route hijacking",
    ],
    action: "step",
  },
];

function getScenarioSteps(
  scenario: Scenario,
  authenticateOspf: boolean,
): ScenarioStep[] {
  if (scenario.id === "ospf-hijack") {
    return authenticateOspf ? OSPF_HIJACK_AUTH_STEPS : OSPF_HIJACK_OPEN_STEPS;
  }
  return scenario.steps;
}

function getFirstScenarioForMode(mode: SimulationMode): Scenario | null {
  return scenarios.find((scenario) => scenario.mode === mode) ?? null;
}

function hasOspfSpfRouteUpdates(stepEvents: SimulationEvent[]): boolean {
  return stepEvents.some((event) => {
    const data = event.data as { destination?: string } | undefined;
    return (
      event.type === "tableUpdate" &&
      event.id.startsWith("spf-") &&
      !!data?.destination
    );
  });
}

function createInitialTableEvents(
  snapshot: RoutingTableSnapshot,
): SimulationEvent[] {
  return Object.entries(snapshot).flatMap(([routerId, table]) =>
    table.map((entry) => ({
      id: `initial-${routerId}-${entry.destination}`,
      timestamp: Date.now(),
      type: "tableUpdate" as const,
      source: routerId,
      description: `${routerId} conoce ruta inicial a ${entry.destination}`,
      data: {
        kind: "new" as const,
        destination: entry.destination,
        nextHop: entry.nextHop,
        cost: entry.cost,
      },
    })),
  );
}

function App() {
  const [mode, setMode] = useState<SimulationMode>("rip");
  const [selectedRouter, setSelectedRouter] = useState<string | null>(null);
  const [, setEvents] = useState<unknown[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({
    activePath: [],
    totalCost: 0,
    hopCount: 0,
    messagesExchanged: 0,
    stepsToConverge: 0,
    status: "stable",
  });
  const [, setStep] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const [narrative, setNarrative] = useState<string | string[]>("");
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationSpeed, setAnimationSpeed] = useState(NORMAL_ANIMATION);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);
  const [ospfAuthentication, setOspfAuthentication] = useState(false);
  const [rejectedRouterIds, setRejectedRouterIds] = useState<string[]>([]);
  const [scenarioStep, setScenarioStep] = useState(0);
  const [displayStep, setDisplayStep] = useState(-1);
  const [topologyVersion, setTopologyVersion] = useState(0);
  const [visibleStepEvents, setVisibleStepEvents] = useState<SimulationEvent[]>(
    [],
  );
  const [currentStepEvents, setCurrentStepEvents] = useState<SimulationEvent[]>(
    [],
  );
  const [previousRoutingTables, setPreviousRoutingTables] =
    useState<RoutingTableSnapshot>({});
  const [previousLsdbs, setPreviousLsdbs] = useState<LsdbSnapshot>({});
  const [isOspfSpfAnimating, setIsOspfSpfAnimating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    linkId: string;
    x: number;
    y: number;
    source: string;
    target: string;
    cost: number;
    isDown: boolean;
    isCongested: boolean;
  } | null>(null);

  const engineRef = useRef<SimulationEngine | null>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const autoIntervalRef = useRef<number | null>(null);

  // Refs to avoid stale closures in auto-play loop
  const scenarioStepRef = useRef(scenarioStep);
  useEffect(() => {
    scenarioStepRef.current = scenarioStep;
  }, [scenarioStep]);

  const autoRunningRef = useRef(autoRunning);
  useEffect(() => {
    autoRunningRef.current = autoRunning;
  }, [autoRunning]);

  const handleScenarioNextRef = useRef<() => Promise<void>>(async () => {});
  const handleScenarioPrevRef = useRef<() => void>(() => {});

  const initEngine = useCallback((m: SimulationMode) => {
    const topology = getTopologyForMode(m);
    engineRef.current = new SimulationEngine(topology, m);
    setEvents([]);
    setMetrics(engineRef.current.getMetrics());
    setStep(0);
    setNarrative(engineRef.current.getNarrative());
    autoRunningRef.current = false;
    setAutoRunning(false);
    setSelectedRouter(null);
    setVisibleStepEvents([]);
    setCurrentStepEvents([]);
    setPreviousRoutingTables({});
    setPreviousLsdbs({});
    setRejectedRouterIds([]);
    setIsOspfSpfAnimating(false);
    setDisplayStep(0);
    setTopologyVersion((v) => v + 1);
    if (autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current);
      autoIntervalRef.current = null;
    }
  }, []);

  const updateState = useCallback(() => {
    if (!engineRef.current) return;
    setEvents(engineRef.current.getEvents());
    setMetrics(engineRef.current.getMetrics());
    setStep(engineRef.current.getStep());
    setNarrative(engineRef.current.getNarrative());
    setTopologyVersion((v) => v + 1);
  }, []);

  const captureRoutingTables = useCallback((): RoutingTableSnapshot => {
    if (!engineRef.current) return {};
    const topology = engineRef.current.getTopology();
    return Object.fromEntries(
      topology.routers.map((router) => [
        router.id,
        router.routingTable.map((entry) => ({
          ...entry,
          asPath: entry.asPath ? [...entry.asPath] : undefined,
        })),
      ]),
    );
  }, []);

  const captureLsdbs = useCallback((): LsdbSnapshot => {
    if (!engineRef.current) return {};
    const topology = engineRef.current.getTopology();
    return Object.fromEntries(
      topology.routers.flatMap((router) =>
        router.lsdb ? [[router.id, cloneLsdb(router.lsdb)]] : [],
      ),
    );
  }, []);

  const runAnimations = useCallback(
    async (stepEvents: SimulationEvent[] = []) => {
      if (!engineRef.current || !graphContainerRef.current) return;
      const anims = engineRef.current.getPacketAnimations(stepEvents);
      const hasOspfSpfTransition = hasOspfSpfRouteUpdates(stepEvents);
      if (anims.length === 0) {
        if (hasOspfSpfTransition) {
          setIsOspfSpfAnimating(true);
          await new Promise((r) => setTimeout(r, OSPF_SPF_REVEAL_MS));
          setIsOspfSpfAnimating(false);
          setVisibleStepEvents(stepEvents);
          await new Promise((r) => setTimeout(r, animationSpeed.settle));
          return;
        }

        setVisibleStepEvents(stepEvents);
        await new Promise((r) => setTimeout(r, animationSpeed.settle));
        return;
      }

      setIsAnimating(true);
      const graphEl = graphContainerRef.current.querySelector(
        ".graph-area > div",
      ) as HTMLDivElement;
      const revealed = new Set<string>();

      // Run animations with stagger
      for (let i = 0; i < anims.length; i++) {
        const a = anims[i];
        animateOnGraph(
          graphEl,
          a.from,
          a.to,
          a.type,
          animationSpeed.duration,
          a.label,
        ).then(() => {
          if (a.type === "data") return;

          const arrivedUpdates = stepEvents.filter((event) => {
            const data = event.data as { nextHop?: string } | undefined;
            return (
              event.type === "tableUpdate" &&
              event.source === a.to &&
              data?.nextHop === a.from
            );
          });

          if (arrivedUpdates.length > 0) {
            setVisibleStepEvents((prev) => {
              const next = [...prev];
              for (const event of arrivedUpdates) {
                if (!revealed.has(event.id)) {
                  revealed.add(event.id);
                  next.push(event);
                }
              }
              return next;
            });
          }
        });
        await new Promise((r) => setTimeout(r, animationSpeed.stagger));
      }

      // Wait for last animation to finish
      await new Promise((r) =>
        setTimeout(r, animationSpeed.duration + animationSpeed.settle),
      );
      setVisibleStepEvents((prev) => {
        const existing = new Set(prev.map((event) => event.id));
        return [
          ...prev,
          ...stepEvents.filter((event) => !existing.has(event.id)),
        ];
      });
      setIsAnimating(false);
    },
    [animationSpeed],
  );

  const handleSendPacket = useCallback(async () => {
    if (!engineRef.current || isAnimating) return;
    const topology = engineRef.current.getTopology();
    const routers = topology.routers.filter((r) => !r.isDown);
    if (routers.length < 2) return;

    const source = routers[0].id;
    const dest = routers[routers.length - 1].id;
    setIsAnimating(true);

    const packet = engineRef.current.sendPacket(source, dest);
    setVisibleStepEvents([]);
    setCurrentStepEvents([]);
    setPreviousRoutingTables({});
    setPreviousLsdbs({});
    setIsOspfSpfAnimating(false);
    updateState();

    // Animate packet hop by hop
    const graphEl = graphContainerRef.current?.querySelector(
      ".graph-area > div",
    ) as HTMLDivElement;
    for (let i = 0; i < packet.path.length - 1; i++) {
      await animateOnGraph(
        graphEl,
        packet.path[i],
        packet.path[i + 1],
        "data",
        DATA_PACKET_HOP_DURATION,
      );
    }
    setIsAnimating(false);
  }, [isAnimating, updateState]);

  const handleRouterSelect = useCallback(
    (id: string) => {
      if (!engineRef.current) return;
      engineRef.current.selectRouter(id);
      setSelectedRouter(id);
      updateState();
    },
    [updateState],
  );

  const handleLinkContextMenu = useCallback(
    (linkId: string, x: number, y: number) => {
      if (!engineRef.current) return;
      const link = engineRef.current
        .getTopology()
        .links.find((l) => l.id === linkId);
      if (!link) return;
      setContextMenu({
        linkId,
        x,
        y,
        source: link.source,
        target: link.target,
        cost: link.cost,
        isDown: link.isDown,
        isCongested: link.isCongested,
      });
    },
    [],
  );

  const handleSetLinkNormal = useCallback(
    (linkId: string) => {
      if (!engineRef.current) return;
      const link = engineRef.current
        .getTopology()
        .links.find((l) => l.id === linkId);
      if (link) {
        link.isDown = false;
        link.isCongested = false;
        link.isActive = false;
        updateState();
      }
    },
    [updateState],
  );

  const handleSetLinkCongested = useCallback(
    (linkId: string) => {
      if (!engineRef.current) return;
      engineRef.current.congestLink(linkId);
      updateState();
    },
    [updateState],
  );

  const handleSetLinkDown = useCallback(
    (linkId: string) => {
      if (!engineRef.current) return;
      engineRef.current.breakLink(linkId);
      updateState();
    },
    [updateState],
  );

  // Scenario handling
  const applyScenarioStep = useCallback(
    (
      scenario: Scenario,
      targetStep: number,
      options?: { ospfAuthentication?: boolean },
    ) => {
      const topology = getTopologyForScenario(scenario.mode, scenario.id);
      engineRef.current = new SimulationEngine(topology, scenario.mode);
      const authenticateOspf =
        options?.ospfAuthentication ?? ospfAuthentication;
      const scenarioSteps = getScenarioSteps(scenario, authenticateOspf);
      if (scenario.id === "rip-slow-convergence") {
        engineRef.current.setDistanceVectorOptions({
          splitHorizon: false,
          withdrawMissingRoutes: true,
        });
      } else if (scenario.id === "rip-split-horizon") {
        engineRef.current.setDistanceVectorOptions({
          splitHorizon: true,
          withdrawMissingRoutes: true,
        });
      }
      if (scenario.mode === "hello") {
        engineRef.current.setHelloOptions({
          trafficSensitive: HELLO_TRAFFIC_SCENARIOS.has(scenario.id),
          trafficVolume: scenario.id === "hello-route-flapping" ? 4 : 3,
        });
      }
      if (scenario.mode === "ospf") {
        engineRef.current.setLinkStateOptions({
          falseLsa: scenario.id === "ospf-hijack",
          authenticate: scenario.id === "ospf-hijack" && authenticateOspf,
        });
      }
      if (RIP_LINEAR_FAILURE_SCENARIOS.has(scenario.id)) {
        // Manually set converged routing tables on the engine's cloned topology
        const engineTopology = engineRef.current.getTopology();
        const r1 = engineTopology.routers.find((r) => r.id === "R1");
        const r2 = engineTopology.routers.find((r) => r.id === "R2");
        const r3 = engineTopology.routers.find((r) => r.id === "R3");
        if (r1 && r2 && r3) {
          r1.routingTable.push({
            destination: "R3",
            nextHop: "R2",
            cost: 2,
            metric: "hops",
            learnedFrom: "R2",
            timestamp: Date.now(),
          });
          r2.routingTable.push({
            destination: "NET1",
            nextHop: "R1",
            cost: 2,
            metric: "hops",
            learnedFrom: "R1",
            timestamp: Date.now(),
          });
          r3.routingTable.push(
            {
              destination: "R1",
              nextHop: "R2",
              cost: 2,
              metric: "hops",
              learnedFrom: "R2",
              timestamp: Date.now(),
            },
            {
              destination: "NET1",
              nextHop: "R2",
              cost: 3,
              metric: "hops",
              learnedFrom: "R2",
              timestamp: Date.now(),
            },
          );
        }
      }
      if (PRECONVERGED_SCENARIOS.has(scenario.id)) {
        engineRef.current.preconverge();
      }

      for (let i = 1; i <= targetStep; i++) {
        const stepDef = scenarioSteps[i];
        if (!stepDef) continue;
        if (stepDef.action === "step") {
          engineRef.current.doStep();
        } else if (
          stepDef.action === "breakLink" &&
          stepDef.actionData?.linkId
        ) {
          engineRef.current.breakLink(stepDef.actionData.linkId);
        } else if (
          stepDef.action === "congestLink" &&
          stepDef.actionData?.linkId
        ) {
          engineRef.current.congestLink(stepDef.actionData.linkId);
        } else if (stepDef.action === "restore") {
          engineRef.current.restoreNetwork();
        } else if (stepDef.action === "sendPacket") {
          const routers = engineRef.current
            .getTopology()
            .routers.filter((r) => !r.isDown);
          if (routers.length >= 2) {
            engineRef.current.sendPacket(
              routers[0].id,
              routers[routers.length - 1].id,
            );
          }
        }
      }

      const stepDef = scenarioSteps[targetStep];
      setAnimationSpeed(NORMAL_ANIMATION);
      setNarrative(stepDef?.narrative || "");
      scenarioStepRef.current = targetStep;
      setScenarioStep(targetStep);
      setDisplayStep(targetStep);
      setEvents(engineRef.current.getEvents());
      setMetrics(engineRef.current.getMetrics());
      setStep(engineRef.current.getStep());
      setPreviousRoutingTables({});
      setPreviousLsdbs({});
      setIsOspfSpfAnimating(false);
      setRejectedRouterIds(
        scenario.id === "ospf-hijack" && authenticateOspf && targetStep >= 1
          ? ["M"]
          : [],
      );

      // Generate initial highlight events from current routing tables
      const tablesSnapshot = Object.fromEntries(
        engineRef.current
          .getTopology()
          .routers.map((router) => [
            router.id,
            router.routingTable.map((entry) => ({
              ...entry,
              asPath: entry.asPath ? [...entry.asPath] : undefined,
            })),
          ]),
      );
      const initialEvents = createInitialTableEvents(tablesSnapshot);
      setVisibleStepEvents(initialEvents);
      setCurrentStepEvents(initialEvents);

      setTopologyVersion((v) => v + 1);
      setSelectedRouter(null);
      if (autoIntervalRef.current) {
        clearTimeout(autoIntervalRef.current);
        autoIntervalRef.current = null;
      }
      autoRunningRef.current = false;
      setAutoRunning(false);
    },
    [ospfAuthentication],
  );

  const handleScenarioSelect = useCallback(
    (scenario: Scenario) => {
      setMode(scenario.mode);
      setActiveScenario(scenario);
      applyScenarioStep(scenario, 0);
    },
    [applyScenarioStep],
  );

  useEffect(() => {
    if (activeScenario) return;
    const firstScenario = getFirstScenarioForMode(mode);
    if (!firstScenario) {
      initEngine(mode);
      return;
    }

    setActiveScenario(firstScenario);
    applyScenarioStep(firstScenario, 0);
  }, [activeScenario, applyScenarioStep, initEngine, mode]);

  const handleOspfAuthenticationChange = useCallback(
    (enabled: boolean) => {
      if (scenarioStep > 0) return;
      setOspfAuthentication(enabled);
      setIsOspfSpfAnimating(false);
      setRejectedRouterIds([]);
      if (activeScenario?.id === "ospf-hijack") {
        applyScenarioStep(activeScenario, scenarioStep, {
          ospfAuthentication: enabled,
        });
      }
    },
    [activeScenario, applyScenarioStep, scenarioStep],
  );

  useEffect(() => {
    if (activeScenario?.id !== "ospf-hijack" || !ospfAuthentication) return;
    const mWasRejected = visibleStepEvents.some((event) => {
      const data = event.data as { rejected?: boolean } | undefined;
      return event.type === "message" && event.source === "M" && data?.rejected;
    });
    if (mWasRejected)
      setRejectedRouterIds((prev) =>
        prev.includes("M") ? prev : [...prev, "M"],
      );
  }, [activeScenario?.id, ospfAuthentication, visibleStepEvents]);

  const handleScenarioNext = useCallback(async () => {
    if (!activeScenario || !engineRef.current) return;
    const actionStep = scenarioStep + 1;
    const scenarioSteps = getScenarioSteps(activeScenario, ospfAuthentication);
    const currentStepDef = scenarioSteps[actionStep];

    scenarioStepRef.current = actionStep;
    setScenarioStep(actionStep);

    if (currentStepDef) {
      setNarrative(currentStepDef.narrative);
      setAnimationSpeed(NORMAL_ANIMATION);

      if (currentStepDef.action === "step") {
        setPreviousRoutingTables(captureRoutingTables());
        setPreviousLsdbs(activeScenario.mode === "ospf" ? captureLsdbs() : {});
        const stepEvents = engineRef.current.doStep();
        setIsOspfSpfAnimating(hasOspfSpfRouteUpdates(stepEvents));
        setCurrentStepEvents(stepEvents);
        setVisibleStepEvents([]);
        updateState();
        await runAnimations(stepEvents);
        setDisplayStep(actionStep);
      } else if (
        currentStepDef.action === "breakLink" &&
        currentStepDef.actionData?.linkId
      ) {
        const previousEventCount = engineRef.current.getEvents().length;
        setPreviousRoutingTables(captureRoutingTables());
        setPreviousLsdbs({});
        engineRef.current.breakLink(currentStepDef.actionData.linkId);
        const stepEvents = engineRef.current
          .getEvents()
          .slice(previousEventCount);
        setVisibleStepEvents(stepEvents);
        setCurrentStepEvents(stepEvents);
        updateState();
        await new Promise((r) => setTimeout(r, 1200));
        setDisplayStep(actionStep);
      } else if (
        currentStepDef.action === "congestLink" &&
        currentStepDef.actionData?.linkId
      ) {
        const previousEventCount = engineRef.current.getEvents().length;
        engineRef.current.congestLink(currentStepDef.actionData.linkId);
        const stepEvents = engineRef.current
          .getEvents()
          .slice(previousEventCount);
        setVisibleStepEvents(stepEvents);
        setCurrentStepEvents(stepEvents);
        setPreviousRoutingTables({});
        setPreviousLsdbs({});
        updateState();
        await new Promise((r) => setTimeout(r, 1200));
        setDisplayStep(actionStep);
      } else if (currentStepDef.action === "restore") {
        const previousEventCount = engineRef.current.getEvents().length;
        engineRef.current.restoreNetwork();
        const stepEvents = engineRef.current
          .getEvents()
          .slice(previousEventCount);
        setVisibleStepEvents(stepEvents);
        setCurrentStepEvents(stepEvents);
        setPreviousRoutingTables({});
        setPreviousLsdbs({});
        updateState();
        await new Promise((r) => setTimeout(r, 1200));
        setDisplayStep(actionStep);
      } else if (currentStepDef.action === "sendPacket") {
        await handleSendPacket();
        setDisplayStep(actionStep);
      } else if (currentStepDef.action === "settle") {
        setIsOspfSpfAnimating(false);
        setCurrentStepEvents([]);
        setVisibleStepEvents([]);
        setPreviousRoutingTables({});
        setPreviousLsdbs({});
        updateState();
        setDisplayStep(actionStep);
      }
    } else {
      // Beyond defined steps: run engine steps until stable
      setAnimationSpeed(FAST_ANIMATION);
      setPreviousRoutingTables(captureRoutingTables());
      setPreviousLsdbs(activeScenario.mode === "ospf" ? captureLsdbs() : {});
      const stepEvents = engineRef.current.doStep();
      setCurrentStepEvents(stepEvents);
      setVisibleStepEvents([]);
      updateState();
      setNarrative(engineRef.current.getNarrative());
      await runAnimations(stepEvents);
      setDisplayStep(actionStep);
    }
  }, [
    activeScenario,
    captureRoutingTables,
    captureLsdbs,
    scenarioStep,
    ospfAuthentication,
    updateState,
    runAnimations,
    handleSendPacket,
  ]);

  useEffect(() => {
    handleScenarioNextRef.current = handleScenarioNext;
  }, [handleScenarioNext]);

  const handleScenarioPrev = useCallback(() => {
    if (!activeScenario || scenarioStep <= 0) return;
    applyScenarioStep(activeScenario, scenarioStep - 1);
  }, [activeScenario, scenarioStep, applyScenarioStep]);

  useEffect(() => {
    handleScenarioPrevRef.current = handleScenarioPrev;
  }, [handleScenarioPrev]);

  const handleScenarioAuto = useCallback(() => {
    if (!activeScenario || !engineRef.current) return;
    if (autoRunning) {
      autoRunningRef.current = false;
      setAutoRunning(false);
      return;
    }
    autoRunningRef.current = true;
    setAutoRunning(true);

    // Async loop: each step waits for the previous to fully complete (including animations)
    const runChain = async () => {
      while (autoRunningRef.current && activeScenario && engineRef.current) {
        const currentStep = scenarioStepRef.current;
        const hasMoreDefinedSteps =
          currentStep <
          getScenarioSteps(activeScenario, ospfAuthentication).length - 1;
        const engineStatus = engineRef.current.getStatus();
        const engineStillChanging =
          engineStatus === "converging" ||
          (engineStatus === "oscillating" &&
            LOOPING_SCENARIOS.has(activeScenario.id));
        if (!hasMoreDefinedSteps && !engineStillChanging) {
          autoRunningRef.current = false;
          setAutoRunning(false);
          return;
        }
        await handleScenarioNextRef.current();
      }
    };

    runChain();
  }, [activeScenario, autoRunning, ospfAuthentication]);

  const handleReset = useCallback(() => {
    if (activeScenario) {
      applyScenarioStep(activeScenario, 0);
    } else {
      const firstScenario = getFirstScenarioForMode(mode);
      if (firstScenario) {
        setActiveScenario(firstScenario);
        applyScenarioStep(firstScenario, 0);
      } else {
        setActiveScenario(null);
        setScenarioStep(0);
        initEngine(mode);
      }
    }
  }, [activeScenario, mode, initEngine, applyScenarioStep]);

  const handleModeChange = useCallback(
    (nextMode: SimulationMode) => {
      const firstScenario = getFirstScenarioForMode(nextMode);
      setScenarioStep(0);
      setOspfAuthentication(false);
      setRejectedRouterIds([]);
      setIsOspfSpfAnimating(false);
      setMode(nextMode);
      setActiveScenario(firstScenario);
      if (firstScenario) {
        applyScenarioStep(firstScenario, 0, { ospfAuthentication: false });
      } else {
        initEngine(nextMode);
      }
    },
    [applyScenarioStep, initEngine],
  );

  const engine = engineRef.current;
  const modeColor = MODE_COLORS[mode];
  const availableScenarios = scenarios.filter((s) => s.mode === mode);
  const activeScenarioSteps = activeScenario
    ? getScenarioSteps(activeScenario, ospfAuthentication)
    : [];

  const currentNarrative =
    activeScenarioSteps[scenarioStep]?.narrative ?? narrative;
  const canRunBeyondDefinedSteps =
    !!activeScenario &&
    (activeScenario.mode === "rip" || LOOPING_SCENARIOS.has(activeScenario.id));
  const scenarioCanAdvance =
    !!activeScenario &&
    (scenarioStep < activeScenarioSteps.length - 1 ||
      (canRunBeyondDefinedSteps && metrics.status === "converging") ||
      (metrics.status === "oscillating" &&
        LOOPING_SCENARIOS.has(activeScenario.id)));
  const scenarioFinished = !!activeScenario && !scenarioCanAdvance;
  return (
    <div className="canvas">
      <div className="graph-area" ref={graphContainerRef}>
        {engine && (
          <GraphView
            topology={engine.getTopology()}
            selectedRouter={selectedRouter}
            onRouterSelect={handleRouterSelect}
            onLinkContextMenu={handleLinkContextMenu}
            mode={mode}
            topologyVersion={topologyVersion}
            currentStepEvents={currentStepEvents}
            visibleStepEvents={visibleStepEvents}
            previousRoutingTables={previousRoutingTables}
            previousLsdbs={previousLsdbs}
            showOspfLsdb={
              !(activeScenario && PRECONVERGED_SCENARIOS.has(activeScenario.id))
            }
            rejectedRouterIds={rejectedRouterIds}
            displayStep={displayStep}
            isOspfSpfAnimating={isOspfSpfAnimating}
          />
        )}
      </div>

      <TopBar
        mode={mode}
        status={metrics.status}
        onModeChange={handleModeChange}
      />

      <ScenarioPanel
        scenarios={availableScenarios}
        activeScenarioId={activeScenario?.id || null}
        onScenarioSelect={handleScenarioSelect}
        narrativeText={activeScenario ? currentNarrative : ""}
        scenarioStep={activeScenario ? scenarioStep : undefined}
        scenarioTotal={activeScenario ? activeScenarioSteps.length : undefined}
      />

      {activeScenario?.id === "ospf-hijack" && (
        <FeatureToggle
          label="Autenticacion"
          enabled={ospfAuthentication}
          disabled={isAnimating || scenarioStep > 0}
          onChange={handleOspfAuthenticationChange}
        />
      )}

      {activeScenario && (
        <NarrativeBar
          autoRunning={autoRunning}
          isAnimating={isAnimating}
          canGoPrev={scenarioStep > 0 && !scenarioFinished}
          canGoNext={scenarioCanAdvance}
          onPrevScenario={handleScenarioPrev}
          onNextScenario={handleScenarioNext}
          onAuto={handleScenarioAuto}
          onReset={handleReset}
        />
      )}

      {selectedRouter && engine && (
        <RouterPopup
          router={
            engine.getTopology().routers.find((r) => r.id === selectedRouter) ||
            null
          }
          mode={mode}
          modeColor={modeColor}
          onClose={() => setSelectedRouter(null)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          {...contextMenu}
          onSetNormal={handleSetLinkNormal}
          onSetCongested={handleSetLinkCongested}
          onSetDown={handleSetLinkDown}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export default App;
