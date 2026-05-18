// ─── GADNIC COMPARADOR · CONFIG ───────────────────────────────────────────────
const SHEET_ID = '1UG8mGPv38W3jD8PPsM2YY_ASrtTwTsWkFSHgxHIbDj4';

const CONFIG = {
  empresa: 'Gadnic',
  sheetId: SHEET_ID,

  categorias: {
    robot: {
      id: 'robot',
      nombre: 'Aspiradora Robot',
      emoji: '🤖',
      sheetName: 'Catalogo_Robot',
      niveles: ['Entry', 'Entry+', 'Mid', 'Mid-High', 'High', 'Premium'],
      campos: [
        { id: 'succion_pa',       label: 'Succión',        unidad: 'Pa',   tipo: 'numero',   req: true  },
        { id: 'autonomia_min',    label: 'Autonomía',      unidad: 'min',  tipo: 'numero',   req: true  },
        { id: 'deposito_polvo',   label: 'Dep. polvo',     unidad: 'ml',   tipo: 'numero',   req: true  },
        { id: 'tanque_agua',      label: 'Tanque agua',    unidad: 'ml',   tipo: 'numero',   req: false },
        { id: 'filtro',           label: 'Filtro',                         tipo: 'texto',    req: true  },
        { id: 'navegacion',       label: 'Navegación',                     tipo: 'texto',    req: true  },
        { id: 'app_wifi',         label: 'App/WiFi',                       tipo: 'texto',    req: true  },
        { id: 'mapeo',            label: 'Mapeo',                          tipo: 'texto',    req: true  },
        { id: 'trapeo',           label: 'Trapeo',                         tipo: 'booleano', req: false },
        { id: 'estacion_auto',    label: 'Estación auto',                  tipo: 'texto',    req: false },
        { id: 'anti_enredos',     label: 'Anti-enredos',                   tipo: 'booleano', req: false },
        { id: 'mopa_giratoria',   label: 'Mopa giratoria',                 tipo: 'texto',    req: false },
      ]
    },

    tacho: {
      id: 'tacho',
      nombre: 'Aspiradora de Tacho',
      emoji: '🪣',
      sheetName: 'Catalogo_Tacho',
      niveles: ['Entry', 'Mid', 'High', 'Premium'],
      campos: [
        { id: 'potencia_w',       label: 'Potencia',       unidad: 'W',    tipo: 'numero',   req: true  },
        { id: 'capacidad_l',      label: 'Capacidad',      unidad: 'L',    tipo: 'numero',   req: true  },
        { id: 'material_tanque',  label: 'Material tanque',                tipo: 'texto',    req: true  },
        { id: 'succion_kpa',      label: 'Succión',        unidad: 'KPA',  tipo: 'numero',   req: true  },
        { id: 'flujo_aire_ls',    label: 'Flujo aire',     unidad: 'L/S',  tipo: 'numero',   req: false },
        { id: 'cable_m',          label: 'Cable',          unidad: 'm',    tipo: 'numero',   req: false },
        { id: 'filtro_hepa',      label: 'Filtro HEPA',                    tipo: 'booleano', req: false },
        { id: 'sopladora',        label: 'Sopladora',                      tipo: 'booleano', req: false },
        { id: 'polvo_liquido',    label: 'Polvo y líquido',                tipo: 'booleano', req: false },
        { id: 'ruido_db',         label: 'Ruido',          unidad: 'dB',   tipo: 'numero',   req: false },
        { id: 'peso_kg',          label: 'Peso',           unidad: 'kg',   tipo: 'numero',   req: false },
        { id: 'certificaciones',  label: 'Certificaciones',                tipo: 'texto',    req: false },
      ]
    },

    freidoras: {
      id: 'freidoras',
      nombre: 'Freidoras de Aire',
      emoji: '🍳',
      sheetName: 'Catalogo_Freidoras',
      niveles: ['Entry', 'Mid', 'High', 'Premium', 'Destacado'],
      campos: [
        { id: 'potencia_w',       label: 'Potencia',       unidad: 'W',    tipo: 'numero',   req: true  },
        { id: 'temperatura',      label: 'Temperatura',    unidad: '°C',   tipo: 'texto',    req: true  },
        { id: 'programas',        label: 'Programas',                      tipo: 'numero',   req: true  },
        { id: 'tipo',             label: 'Tipo',                           tipo: 'texto',    req: true  },
        { id: 'control',          label: 'Control',                        tipo: 'texto',    req: true  },
        { id: 'antiadherente',    label: 'Antiadherente',                  tipo: 'texto',    req: false },
        { id: 'timer',            label: 'Timer',                          tipo: 'texto',    req: false },
        { id: 'peso_kg',          label: 'Peso',           unidad: 'kg',   tipo: 'numero',   req: false },
        { id: 'medidas_cm',       label: 'Medidas',        unidad: 'cm',   tipo: 'texto',    req: false },
        { id: 'fn_spiedo',        label: 'Spiedo',                         tipo: 'booleano', req: false },
        { id: 'fn_visor',         label: 'Visor',                          tipo: 'booleano', req: false },
        { id: 'fn_luz',           label: 'Luz interior',                   tipo: 'booleano', req: false },
        { id: 'fn_fermentar',     label: 'Fermentar',                      tipo: 'booleano', req: false },
        { id: 'fn_vidrio',        label: 'Cesto vidrio',                   tipo: 'booleano', req: false },
      ]
    }
  },

  tipos: [
    { id: 'vs_competencia', label: 'Lineal vs Competencia', desc: 'Tu producto contra MELI / Amazon',       icon: '⚔️' },
    { id: 'vs_cotizacion',  label: 'Lineal vs Cotización',  desc: 'Tu producto contra cotización proveedor', icon: '📦' },
    { id: 'mixto',          label: 'Cotización vs Mercado', desc: 'Para lineales nuevos sin producto propio', icon: '🔀' },
  ],

  fuentes: {
    propio:      { label: 'Propio (Bidcom)',       color: '#6366f1' },
    cotizacion:  { label: 'Cotización propia',     color: '#8b5cf6' },
    proveedor:   { label: 'Cotización proveedor',  color: '#f59e0b' },
    competencia: { label: 'Competencia',           color: '#ef4444' },
  }
};
