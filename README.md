# Simulador de Protocolos de Ruteo

Aplicacion web visual para la presentacion de Redes de Computadoras. Simula protocolos de ruteo con animaciones, escenarios guiados paso a paso y comparaciones entre distintos algoritmos.

## Instalacion

```bash
cd simulador-ruteo
npm install
npm run dev
```

Abrir http://localhost:5173

---

## Protocolos soportados

- **RIP** - Distance Vector (Bellman-Ford). Convergencia iterativa con metrica de saltos. Incluye escenarios de caida de enlace, routing loops y split horizon.
- **OSPF** - Link State (Dijkstra). Flooding de LSAs y calculo local de caminos mas cortos. Incluye escenarios de falla de enlace y route hijacking con/sin autenticacion.
- **HELLO** - Delay-based. Distance vector con metrica de delay acumulado. Permite delay direccional y es sensible a carga de trafico.

---

## Interfaz

La pantalla es un canvas abierto que ocupa todo el espacio. 

### Controles principales

- **Paso (>|)** - Avanza un paso en el escenario actual con animaciones de paquetes.
- **Auto** - Ejecuta automaticamente los pasos del escenario.
- **Reset** - Reinicia el escenario al paso inicial.
- **<|** - Vuelve al paso anterior del escenario.

### Panel de escenarios

Cada modo de protocolo tiene escenarios predefinidos con narrativa paso a paso:

**RIP:**
- Convergencia - Como RIP aprende rutas desde cero
- Caida de enlace - Reaccion ante falla y reconvergencia
- Routing Loop - Problema count-to-infinity sin proteccion
- Split Horizon Update - Como Split Horizon evita loops

**OSPF:**
- Convergencia OSPF - Flooding de LSAs y calculo SPF
- Falla OSPF - Reconvergencia rapida ante caida de enlace
- Route Hijacking - Riesgo de autenticacion deshabilitada

**HELLO:**
- Convergencia HELLO - Propagacion de vectores de delay
- Hop Count vs Delay - Camino mas corto vs camino mas rapido
- Delay Direccional - Asimetria en ida y vuelta
- Route Flapping - Oscilacion de rutas por metrica dinamica

### Interaccion con el grafo

- **Click en router** - Abre popup con tabla de ruteo actual y LSDB (en OSPF).
- **Right-click en enlace** - Menu contextual para cambiar estado:
  - Normal
  - Congestionado (aumenta delay/costo)
  - Caido (enlace roto)

### Toggle de autenticacion (OSPF Route Hijacking)

En el escenario "Route Hijacking" aparece un toggle para habilitar/deshabilitar autenticacion OSPF. Solo puede cambiarse antes del primer paso.

- **Sin autenticacion** - El router malicioso M inunda un LSA falso y desvia trafico.
- **Con autenticacion** - Los vecinos rechazan el LSA invalido y las rutas permanecen intactas.

---

## Arquitectura

```
src/
├── App.tsx                     Estado global, orquestacion de escenarios
├── main.tsx                    Entry point de React
├── index.css                   Estilos (pildoras flotantes, glassmorphism)
├── data/topologies.ts          Topologias predefinidas por modo y escenario
├── simulation/
│   ├── types.ts                Tipos principales (routers, enlaces, eventos, metricas)
│   ├── engine.ts               Motor de simulacion: pasos, paquetes, estado
│   ├── staticRouting.ts        Modo estatico
│   ├── distanceVector.ts       RIP/DV con opciones (split horizon, withdraw)
│   ├── linkState.ts            OSPF/LS con flooding y Dijkstra
│   └── delayBased.ts           HELLO con delay direccional y sensibilidad a carga
├── scenarios/
│   └── scenarios.ts            Definicion de escenarios guiados con narrativa
└── components/
    ├── GraphView.tsx            Grafo interactivo con Cytoscape.js
    ├── graphAnimation.ts        Animaciones nativas de paquetes sobre el grafo
    ├── TopBar.tsx               Barra superior flotante (selector de modo)
    ├── ScenarioPanel.tsx        Panel lateral de escenarios y narrativa
    ├── NarrativeBar.tsx         Barra inferior con controles de paso
    ├── RouterPopup.tsx          Popup de tabla de ruteo y LSDB
    ├── ContextMenu.tsx          Menu contextual para enlaces
    └── FeatureToggle.tsx        Toggle para opciones de escenario
```

---

## Simplificaciones

1. No es una implementacion real de protocolos.
2. RIP: iteraciones manuales paso a paso, sin temporizadores.
3. OSPF: flooding simplificado (sin areas, sin DR/BDR).
4. HELLO: delay se calcula de forma determinista; la oscilacion es controlada.
5. Topologias fijas por escenario.
6. Sin paquetes reales de red.

## Tecnologias

- Vite + React 19 + TypeScript
- Cytoscape.js (visualizacion del grafo)
- CSS con glassmorphism (efectos de blur y transparencia)
