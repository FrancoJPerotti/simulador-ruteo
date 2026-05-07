import type { SimulationMode } from "../simulation/types";

export interface ScenarioStep {
  narrative: string | string[];
  action:
    | "init"
    | "step"
    | "sendPacket"
    | "breakLink"
    | "congestLink"
    | "restore"
    | "settle";
  actionData?: Record<string, string>;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  mode: SimulationMode;
  steps: ScenarioStep[];
}

export const scenarios: Scenario[] = [
  {
    id: "rip-convergence",
    name: "Convergencia",
    description: "Ver como RIP aprende rutas nuevas cuando la red esta sana",
    mode: "rip",
    steps: [
      {
        narrative: [
          "La red arranca desde cero",
          "Cada router solo conoce a sus vecinos directos",
          "Sus tablas tienen una sola fila por enlace conectado",
          "Todavia no saben nada del resto de la red",
        ],
        action: "init",
      },
      {
        narrative: [
          "Primera ronda de anuncios",
          "Cada router le manda su tabla actual a todos sus vecinos",
          "Los receptores descubren destinos a 2 saltos de distancia",
          "Las tablas crecen con nuevas rutas",
        ],
        action: "step",
      },
      {
        narrative: [
          "Segunda ronda",
          "Los anuncios ahora incluyen rutas aprendidas en la ronda anterior",
          "La informacion llega a los routers mas lejanos",
          "Todos descubren como alcanzar al resto de la red",
        ],
        action: "step",
      },
      {
        narrative: [
          "Verificación final",
          "No aparecen rutas nuevas ni metricas mejores",
          "Las tablas ya estan completas",
          "RIP converge porque no hay mas cambios",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "rip-link-failure",
    name: "Caida de enlace",
    description:
      "Ver como RIP reacciona cuando se cae un enlace y debe reconverger",
    mode: "rip",
    steps: [
      {
        narrative: [
          "Red RIP ya convergida",
          "Todos los routers conocen rutas hacia todos los destinos",
          "Las tablas estan completas y la red es estable",
        ],
        action: "init",
      },
      {
        narrative: [
          "Se corta el enlace B-E",
          "B y E detectan la falla",
          "B invalida su ruta directa a E",
          "E invalida las rutas que dependian de B",
          "El resto de la red todavia no se actualizo",
        ],
        action: "breakLink",
        actionData: { linkId: "B-E" },
      },
      {
        narrative: [
          "Primera ronda despues de la falla",
          "Empiezan a circular anuncios actualizados",
          "A y C encuentran rutas alternativas hacia E",
          "E recalcula rutas hacia A, B y C",
          "B todavia no recupera su ruta a E",
        ],
        action: "step",
      },
      {
        narrative: [
          "Segunda ronda",
          "La informacion de reconvergencia sigue propagandose",
          "B aprende una ruta alternativa hacia E",
          "La conectividad se recupera usando un camino alternativo",
        ],
        action: "step",
      },
      {
        narrative: [
          "Verificación final",
          "No hay mas cambios en las tablas",
          "Todos encontraron rutas estables",
          "RIP reconvergio usando solo los enlaces disponibles",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "rip-slow-convergence",
    name: "Routing Loop",
    description:
      "Mostrar el problema count-to-infinity cuando RIP no usa mecanismos de proteccion",
    mode: "rip",
    steps: [
      {
        narrative: [
          "Red lineal: Network 1 - R1 - R2 - R3",
          "R1 llega directo a Network 1",
          "R2 aprendió la ruta via R1",
          "R3 aprendió la ruta via R2",
          "La red esta convergida",
        ],
        action: "init",
      },
      {
        narrative: [
          "Falla el enlace Network 1-R1",
          "R1 pierde su ruta directa",
          "R2 todavia cree que llega via R1",
          "Todavia no se entero de la falla",
        ],
        action: "breakLink",
        actionData: { linkId: "NET1-R1" },
      },
      {
        narrative: [
          "R1 pregunta a sus vecinos",
          "R2 responde: 'yo llego via R1'",
          "R1 no sabe que esa ruta dependia de el",
          "Instala una ruta falsa via R2",
          "Aparece el bucle R1 -> R2 -> R1",
        ],
        action: "step",
      },
      {
        narrative: [
          "El bucle sigue activo",
          "R1 anuncia que llega via R2",
          "R2 actualiza y ahora dice que llega via R1",
          "Ambos creen tener ruta pero estan en un loop",
        ],
        action: "step",
      },
      {
        narrative: [
          "Count-to-infinity",
          "Cada intercambio sube la metrica de a uno",
          "R1 dice 'estoy a 2', R2 dice 'estoy a 3'",
          "La distancia crece sin parar",
          "Nadie sabe que la ruta esta rota",
        ],
        action: "step",
      },
      {
        narrative: [
          "En RIP real el infinito es 16",
          "Cuando una ruta llega a 16 se descarta",
          "Puede tardar muchisimas rondas",
          "Split horizon y poison reverse evitan este problema",
          "R2 no deberia anunciarle a R1 una ruta que aprendio de R1",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "rip-split-horizon",
    name: "Split Horizon Update",
    description:
      "Mostrar como Split Horizon evita que RIP forme un routing loop despues de una falla",
    mode: "rip",
    steps: [
      {
        narrative: [
          "Misma red lineal: Network 1 - R1 - R2 - R3",
          "R1 llega directo a Network 1",
          "R2 aprendio la ruta via R1",
          "R3 aprendio la ruta via R2",
          "La diferencia es que RIP usa Split Horizon",
        ],
        action: "init",
      },
      {
        narrative: [
          "Falla el enlace Network 1-R1",
          "R1 elimina su ruta directa a Network 1",
          "R2 todavia tenia esa ruta aprendida desde R1",
          "Ahora se prueba si la reanuncia hacia atras",
        ],
        action: "breakLink",
        actionData: { linkId: "NET1-R1" },
      },
      {
        narrative: [
          "Split Horizon entra en accion",
          "R2 no le anuncia a R1 la ruta a Network 1",
          "Esa ruta habia sido aprendida justamente desde R1",
          "R1 no instala una ruta falsa via R2",
          "No aparece el bucle R1 -> R2 -> R1",
        ],
        action: "step",
      },
      {
        narrative: [
          "R2 recibe la informacion actualizada",
          "Como R1 ya no anuncia Network 1, R2 elimina esa ruta",
          "La falla se propaga como retirada de ruta",
          "No como una metrica falsa que empieza a crecer",
        ],
        action: "step",
      },
      {
        narrative: [
          "R3 tambien deja de recibir la ruta desde R2",
          "El ultimo router elimina Network 1 de su tabla",
          "La red converge marcando el destino como inalcanzable",
          "Split Horizon evito el count-to-infinity",
        ],
        action: "step",
      },
      {
        narrative: [
          "Resultado final",
          "Ningun router cree falsamente que otro tiene salida a Network 1",
          "No hay loop y no hay conteo progresivo hasta infinito",
          "La tecnica soluciono el problema mostrado en Routing Loop",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "ospf-flooding",
    name: "Convergencia OSPF",
    description: "Ver como OSPF construye una LSDB y calcula SPF",
    mode: "ospf",
    steps: [
      {
        narrative: [
          "OSPF comienza",
          "Cada router detecta sus enlaces locales",
          "Genera un LSA (Link-State Advertisement)",
          "Solo conocen su vecindad, no el resto de la red",
        ],
        action: "init",
      },
      {
        narrative: [
          "Flooding de LSAs",
          "Cada router envia su LSA a todos sus vecinos",
          "Los vecinos lo reenvian a sus vecinos",
          "Al final todos tienen la misma LSDB",
          "Una copia completa del mapa de la red",
        ],
        action: "step",
      },
      {
        narrative: [
          "Dijkstra local",
          "Con la LSDB completa cada router ejecuta Dijkstra",
          "Calcula el arbol de caminos mas cortos",
          "Desde si mismo hasta todos los demas",
        ],
        action: "step",
      },
      {
        narrative: [
          "Convergencia completa",
          "En solo 2 pasos de intercambio OSPF converge",
          "Todos tienen las rutas optimas",
          "Mucho mas rapido que RIP porque tienen el mapa completo",
          "No dependen de informacion de segunda mano",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "ospf-link-failure",
    name: "Falla OSPF",
    description:
      "Mostrar reconvergencia rapida cuando cambia el estado de un enlace",
    mode: "ospf",
    steps: [
      {
        narrative: [
          "Red OSPF estable",
          "Todos los routers ya conocen el mapa de enlaces",
          "Cada tabla fue calculada localmente con SPF",
          "El costo mostrado es el costo acumulado del camino elegido",
        ],
        action: "init",
      },
      {
        narrative: [
          "Se cae el enlace E-F",
          "Los routers adyacentes detectan el cambio de estado",
          "OSPF debe inundar un nuevo LSA",
        ],
        action: "breakLink",
        actionData: { linkId: "E-F" },
      },
      {
        narrative: [
          "Nuevo flooding de LSAs",
          "La LSDB se actualiza con el enlace caido",
          "Los routers reciben el nuevo estado de enlace",
          "Todavia conservan las rutas anteriores hasta recalcular SPF",
          "No hay count-to-infinity",
        ],
        action: "step",
      },
      {
        narrative: [
          "SPF recalcula las rutas",
          "Cada router usa la LSDB actualizada",
          "Las tablas cambian al nuevo camino optimo",
          "La red reconverge sin depender de rumores entre vecinos",
        ],
        action: "step",
      },
      {
        narrative: [
          "Convergencia completa",
          "No hay mas cambios en las tablas",
          "La LSDB ya esta sincronizada en todos los routers",
          "OSPF queda estable con el enlace E-F fuera de servicio",
        ],
        action: "settle",
      },
    ],
  },
  {
    id: "ospf-hijack",
    name: "Route Hijacking (OSPF)",
    description:
      "Mostrar que OSPF confia en routers internos si no hay autenticacion",
    mode: "ospf",
    steps: [
      {
        narrative: [
          "OSPF es un protocolo interior",
          "Los routers dentro del AS normalmente confian entre si",
          "M representa un router interno malicioso o mal configurado",
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
          "Algunas rutas pueden desviarse hacia M",
          "Este es el riesgo de confiar en anuncios internos sin autenticacion",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "hello-convergence",
    name: "Convergencia HELLO",
    description: "Ver como HELLO converge propagando vectores de delay",
    mode: "hello",
    steps: [
      {
        narrative: [
          "HELLO arranca como distance-vector, pero con delay como metrica",
          "Cada router conoce solo el delay medido hacia sus vecinos directos",
          "Cada enlace muestra dos rectas: una por cada direccion",
          "Los delays de ida y vuelta pueden ser distintos",
        ],
        action: "init",
      },
      {
        narrative: [
          "Primera ronda de mensajes HELLO",
          "Cada router anuncia a sus vecinos los delays que conoce",
          "El receptor calcula: delay hasta el vecino + delay anunciado al destino",
          "Aparecen rutas de dos saltos",
        ],
        action: "step",
      },
      {
        narrative: [
          "Segunda ronda",
          "Los vectores ya contienen rutas aprendidas en la ronda anterior",
          "La informacion llega a routers mas lejanos",
          "Las tablas se completan por menor delay acumulado",
        ],
        action: "step",
      },
      {
        narrative: [
          "Ronda final",
          "No aparece ningun delay acumulado menor",
          "HELLO converge porque las tablas quedan estables",
          "La metrica final es tiempo estimado, no cantidad de saltos",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "hello-hop-count-vs-delay",
    name: "Hop Count vs Delay",
    description:
      "Mostrar que el camino con menos saltos puede no ser el mas rapido",
    mode: "hello",
    steps: [
      {
        narrative: [
          "Hay dos caminos de A a F",
          "A-B-F tiene solo 2 saltos, pero cada enlace tiene delay alto",
          "A-C-D-F tiene 3 saltos, pero cada enlace tiene delay bajo",
          "Este escenario muestra la desventaja de usar hop-count",
        ],
        action: "init",
      },
      {
        narrative: [
          "Si se usara RIP, A-B-F pareceria mejor por tener menos saltos",
          "HELLO intercambia delays en lugar de contar routers",
          "Empieza a descubrir que el camino mas largo puede ser mas rapido",
        ],
        action: "step",
      },
      {
        narrative: [
          "HELLO suma delays acumulados",
          "A-B-F cuesta 40 unidades de delay",
          "A-C-D-F cuesta 12 unidades de delay",
          "La ruta elegida minimiza tiempo, no saltos",
        ],
        action: "step",
      },
      {
        narrative: [
          "Resultado",
          "El camino con mas routers puede tener mejor capacidad o menor latencia",
          "Hop-count es simple, pero es una medida cruda de calidad de red",
          "HELLO corrige esa limitacion usando delay",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "hello-directional-delay",
    name: "Delay Direccional",
    description:
      "Mostrar que HELLO puede medir delays distintos en cada sentido",
    mode: "hello",
    steps: [
      {
        narrative: [
          "HELLO usa timestamps y relojes sincronizados para estimar delay",
          "No necesita asumir que ida y vuelta cuestan lo mismo",
          "Por eso cada enlace se dibuja con dos rectas direccionales",
          "Una congestion en un sentido no cambia necesariamente el otro",
        ],
        action: "init",
      },
      {
        narrative: [
          "Los routers anuncian delays por direccion",
          "A puede ver barato ir por A-B-F",
          "Pero desde F hacia A esos mismos enlaces son caros",
          "Las tablas empiezan a reflejar asimetria",
        ],
        action: "step",
      },
      {
        narrative: [
          "Con mas informacion propagada",
          "La mejor ruta A -> F puede diferir de F -> A",
          "HELLO calcula cada origen con sus delays de salida reales",
          "El costo depende del sentido recorrido",
        ],
        action: "step",
      },
      {
        narrative: [
          "Convergencia con metrica direccional",
          "Las tablas estables no tienen por que ser simetricas",
          "Esto modela mejor una red donde la carga no es igual en ambos sentidos",
        ],
        action: "step",
      },
    ],
  },
  {
    id: "hello-route-flapping",
    name: "Route Flapping",
    description:
      "Mostrar como una metrica de delay sensible a carga puede alternar rutas",
    mode: "hello",
    steps: [
      {
        narrative: [
          "Dos caminos conectan A con F",
          "Camino digital: A-D-F, bajo delay base pero baja capacidad",
          "Camino satelital: A-S-F, mayor delay base pero alta capacidad",
          "Sin trafico, el camino digital parece claramente mejor",
        ],
        action: "init",
      },
      {
        narrative: [
          "HELLO intercambia vectores de delay",
          "A aprende que F se alcanza mejor por D",
          "Todavia no hay flujo de datos cargando el camino",
          "La ruta digital queda lista para ser usada",
        ],
        action: "step",
      },
      {
        narrative: [
          "El trafico real A -> F empieza a usar A-D-F",
          "Como la capacidad es baja, la utilizacion sube rapido",
          "El delay efectivo del camino digital crece de forma abrupta",
          "El camino satelital ahora parece mas barato",
        ],
        action: "step",
      },
      {
        narrative: [
          "El trafico se mueve al camino satelital",
          "El camino digital se descarga y vuelve a tener bajo delay",
          "La medicion vuelve a favorecer A-D-F",
          "El protocolo prepara otro cambio",
        ],
        action: "step",
      },
      {
        narrative: [
          "El cambio de vuelta queda visible",
          "HELLO vuelve a preferir A-D-F cuando el camino digital se descarga",
          "Ese cambio vuelve a cargar el camino digital",
          "Queda preparado el siguiente salto de ruta",
        ],
        action: "step",
      },
      {
        narrative: [
          "Route flapping",
          "La ruta vuelve a alternar porque el trafico modifica la metrica que HELLO observa",
          "El cambio de ruta causa el siguiente cambio de delay",
          "El estado OSCILANDO marca que el ciclo ya se repitio",
        ],
        action: "step",
      },
    ],
  },
];
