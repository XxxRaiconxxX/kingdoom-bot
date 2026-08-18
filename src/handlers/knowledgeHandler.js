import { getKnowledgeDocuments } from '../supabase.js';
import { heraldCard, heraldStat, heraldSection, treeSection, treeList, treeCommand } from '../formatting.js';

export const CANON_LORE_FILES = [
  {
    index: 1,
    id: 'shadow-garden-lore',
    filename: 'SHADOW_GARDEN_LORE_CANON.txt',
    title: 'Shadow Garden: Crónicas Noveladas y las 7 Sombras',
    category: 'Círculo Secreto & Éter',
    aliases: ['sombras', 'shadow', 'garden', 'prima', 'fuente', 'compresion', '1'],
    summary: 'Rescate biológico y curación rúnica de las Siete Sombras Primordiales (I a VII), técnica secreta de combate "Compresión Cero (I Am the Source)", la fachada de lujo de la Casa Lux Aeterna y la guerra encubierta contra los 12 Prelados de la Orden del Eclipse.',
    excerpt: 'En el código fundacional de Shadow Garden existía un axioma inviolable: "No somos tiranos de la noche; somos los cirujanos invisibles que extirpan el cáncer del mundo para que la luz continúe viva." Cada joven rescatada de la Podredumbre del Circuito fue sanada con precisión de frecuencia cero.',
    highlights: [
      '✦ Rescate biológico de Prima, Secunda, Tertia, Quarta, Quinta, Sexta y Séptima.',
      '✦ Trajes simbióticos de Piel de Sombra e Hilos invisibles de la Parca.',
      '✦ El Sanctum del Vacío y la esteganografía en bordados de vestidos de lujo.',
    ],
  },
  {
    index: 2,
    id: 'shadow-garden-schism',
    filename: 'SHADOW_GARDEN_SCHISM_CANON.txt',
    title: 'Shadow Garden: El Cisma del Jardín de Espinas',
    category: 'Herejías & Contrainteligencia',
    aliases: ['espinas', 'cisma', 'spina', 'traicion', 'marionetas', 'veridia', '2'],
    summary: 'La rebelión de la Primogénita disidente (Spina), la doctrina de la Herejía de la Carne, el desfalco de 420.000 monedas de oro a Lux Aeterna, las marionetas biomecánicas de hueso y el duelo a muerte en las ciénagas de Veridia.',
    excerpt: 'Spina no vio en la salvación un regalo de piedad: "La Podredumbre del Circuito no es un error, es la corona". Su laboratorio sumergido en las ciénagas de Veridia forjaba autómatas con espinas de hueso y nervios esclavizados hasta el asalto nocturno de Sombra I Prima.',
    highlights: [
      '✦ Spina, la Reina de las Espinas: "La corrupción no es un error, es la corona".',
      '✦ Cámaras de aerosol de miasma e injertos de espinas cerebrales de mando.',
      '✦ Duelo nocturno en los pantanos: Prima vs. Spina y el protocolo de exterminio Null-Omega.',
    ],
  },
  {
    index: 3,
    id: 'valdren-first-era',
    filename: 'VALDREN_FIRST_ERA_CANON.txt',
    title: 'Historia de Valdren y la Primera Era: La Corona de Carbón',
    category: 'Arqueología & Civilizaciones Perdidas',
    aliases: ['valdren', 'historia de valdren', 'primera era', 'corona', 'carbon', 'aurelius', 'llaves', '3'],
    summary: 'El apogeo de la Primera Era bajo el Rey Aurelius Valdren I, la tecnología perdida de motores de gravedad cero, la Noche de la Traición, las Siete Llaves Ancestrales y el ejército durmiente de dos millones de autómatas.',
    excerpt: 'Tres siglos antes de la noche eterna, el continente entero estuvo unido bajo el trono de Valdren. La Noche de la Traición sepultó la Ciudad de las Siete Torres bajo el Velo Negro, dejando la Corona de Carbón esperando a quien reúna las Siete Llaves Ancestrales.',
    highlights: [
      '✦ La Ciudad de las Siete Torres y las fragatas celestes de titanio rúnico.',
      '✦ La Corona de Carbón: comando telepático de autómatas y Fuego Negro para impostores.',
      '✦ Localización de los Siete Sellos Arcanos para abrir el Velo Negro.',
    ],
  },
  {
    index: 4,
    id: 'realm-stock-exchange',
    filename: 'REALM_STOCK_EXCHANGE_CANON.txt',
    title: 'Bolsa de Valores del Reino y Megacorporaciones',
    category: 'Economía & Geopolítica Financiera',
    aliases: ['bolsa', 'mercado', 'acciones', 'valerius', 'luxley', 'mezli', 'crash', '4'],
    summary: 'El Gran Parqué de Mercantia y la Campana de Oro de la Primera Era. Dossier de las 5 Megacorporaciones ($VAL, $LUX, $MZT, $AET, $BAL) y la crónica novelada del Gran Crash de 718 ("El Viernes Negro").',
    excerpt: 'En el parqué de Mercantia se cotiza el destino de los reinos. A través de la venta en corto, Sombra VI destruyó financieramente a la corrupta Casa Lancaster durante el Crash de 718, asegurando el dominio económico invisible de Lux Aeterna.',
    highlights: [
      '✦ Las 5 Grandes: Fundiciones Valerius, Consorcio Lux-Ley, Transportes Mezli, Lux Aeterna y El Baluarte.',
      '✦ La jugada maestra de venta en corto de Sombra VI que quebró a los Lancaster.',
      '✦ El arte de la guerra bursátil y la manipulación de la deuda de guerra.',
    ],
  },
  {
    index: 5,
    id: 'potions-and-artifacts',
    filename: 'POTIONS_AND_ARTIFACTS_CANON.txt',
    title: 'Compendio Alquímico: Grace Chariot y Reliquias',
    category: 'Alquimia & Artefactos Prohibidos',
    aliases: ['pocion', 'pociones', 'alquimia', 'grace', 'chariot', 'fuego blanco', 'reliquias', '5'],
    summary: 'La Poción Dorada y el cautiverio de la alquimista Grace Chariot en Aurelia (50.000 oro/frasco), el Fuego Blanco de la Orden del Sol Marchito (1.800 °C), las Láminas de Fase de Arcania y la Ceniza de Éter del Eclipse.',
    excerpt: 'La Poción Dorada es el milagro biológico de Aurelia: regenera extremidades completas en media hora y devuelve diez años de juventud. Mientras tanto, el Fuego Blanco arde a 1.800 °C y las Láminas de Fase cortan órganos ignorando armaduras.',
    highlights: [
      '✦ Fisiología molecular de la Poción Dorada: regeneración de extremidades y juventud de 10 años.',
      '✦ El Fuego Blanco incombustible que explota violentamente al contacto con el agua.',
      '✦ Las Láminas de Fase que ignoran el acero para cortar directamente órganos internos.',
    ],
  },
  {
    index: 6,
    id: 'religions-pantheon',
    filename: 'RELIGIONS_PANTHEON_CANON.txt',
    title: 'Teología y Panteón de los Cinco Arcontes',
    category: 'Religión & Mitología Divina',
    aliases: ['religion', 'dioses', 'arcontes', 'panteon', 'kaelvael', 'solignis', 'aethelia', '6'],
    summary: 'Cosmogonia de los Cinco Arcontes Rúnicos (Kael-Vael, Sol-Ignis, Aethelia, Aethel-Nox, Khor-Drak), las 4 Iglesias oficiales de Aethelgardia, las liturgias de purga y las Cuatro Reliquias Sagradas.',
    excerpt: 'Antes de los mortales, los Cinco Arcontes forjaron el tejido de las Líneas Ley. La Iglesia de la Luz Rúnica rige en Kaelum-Gard, mientras la Orden del Sol Marchito purga con fuego y Oakhaven venera al Árbol Madre de Veridia.',
    highlights: [
      '✦ La Iglesia de la Luz Rúnica y la Ortodoxia Imperial de Kaelum-Gard.',
      '✦ La Orden Militar del Sol Marchito y su cruzada contra mutaciones.',
      '✦ El Gran Árbol Madre de Veridia y el Culto de la Savia Primordial.',
    ],
  },
  {
    index: 7,
    id: 'realms-and-dynasties',
    filename: 'REALMS_AND_DYNASTIES_CANON.txt',
    title: 'Atlas Geopolítico y Dinastías de Aethelgardia',
    category: 'Geopolítica & Coronas Reales',
    aliases: ['reinos', 'dinastias', 'reyes', 'kaelumgard', 'oakhaven', 'arcania', 'paramos', 'aurelia', '7'],
    summary: 'Atlas histórico de las Casas Reales de Kaelum-Gard, Oakhaven, Arcania, Unión de los Páramos, Aurelia y Valdren. Árboles genealógicos, monopolios comerciales, fuerzas militares y secretos clasificados de estado.',
    excerpt: 'El continente de Aethelgardia es un mosaico de coronas enfrentadas: la Falange del Azabache en Kaelum-Gard, los guardianes druídicos en Oakhaven, los archimagos de Arcania y las plataformas a vapor de los Páramos.',
    highlights: [
      '✦ Dinastía Kaelen-Gard y la Falange del Azabache.',
      '✦ El Círculo Druídico de Oakhaven y los Guardianes de la Madera Viva.',
      '✦ El Senado de los Nueve Prismas de Arcania y las plataformas a vapor de los Páramos.',
    ],
  },
];

function normalizeQuery(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export async function handleDataVer(query = '') {
  const cleanQuery = normalizeQuery(query);

  let supabaseDocs = [];
  try {
    supabaseDocs = await getKnowledgeDocuments();
  } catch (err) {
    console.warn('[knowledgeHandler] Error obteniendo knowledge_documents de Supabase:', err.message);
  }

  // 1. Si no hay query o pide listar ("lista", "list", "todos", "all")
  if (!cleanQuery || cleanQuery === 'lista' || cleanQuery === 'list' || cleanQuery === 'todos' || cleanQuery === 'all') {
    const canonItems = CANON_LORE_FILES.map((item) =>
      treeCommand(`!dataver ${item.index}`, `${item.filename} ➔ ${item.title}`)
    );

    const menuLines = [
      '> _Archivos y Documentos Asimilados en la Memoria del Bot._',
      '────────────────────────────',
      treeSection('01. ARCHIVOS CANÓNICOS MAESTROS (.TXT)'),
      treeList(canonItems),
    ];

    if (supabaseDocs && supabaseDocs.length > 0) {
      const dbItems = supabaseDocs.slice(0, 10).map((doc) =>
        treeCommand(`!dataver ${doc.id || doc.title}`, `${doc.title} [${String(doc.category || doc.type || 'Grimorio').toUpperCase()}]`)
      );

      menuLines.push(
        '',
        treeSection(`02. DOCUMENTOS DEL GRIMORIO EN SUPABASE (${supabaseDocs.length})`),
        treeList(dbItems)
      );

      if (supabaseDocs.length > 10) {
        menuLines.push(`_...y ${supabaseDocs.length - 10} documentos más en la base de datos._`);
      }
    }

    menuLines.push(
      '',
      treeSection('INSPECCIÓN DE CONTENIDO'),
      treeList([
        '📄 Usa `!dataver <número>` (ej: `!dataver 3`) para ver un archivo.',
        '🔍 Usa `!dataver <nombre>` (ej: `!dataver historia de valdren`) para abrirlo.',
      ])
    );

    const totalCount = CANON_LORE_FILES.length + (supabaseDocs ? supabaseDocs.length : 0);

    return heraldCard('ARCHIVOS Y LORE SUBIDOS AL BOT', menuLines, {
      icon: '📂',
      footer: `✦ Total de archivos disponibles: ${totalCount} · _Usa !dataver <nombre>_`,
    });
  }

  // 2. Búsqueda por índice numérico (1..7)
  const numericIndex = Number.parseInt(cleanQuery, 10);
  if (!Number.isNaN(numericIndex) && String(numericIndex) === cleanQuery && numericIndex >= 1 && numericIndex <= CANON_LORE_FILES.length) {
    const item = CANON_LORE_FILES[numericIndex - 1];
    return formatFileContentCard(item);
  }

  // 3. Búsqueda por nombre de archivo o coincidencia en CANON_LORE_FILES
  const queryWords = cleanQuery.split(/\s+/).filter(Boolean);
  const matchedFile = CANON_LORE_FILES.find((item) => {
    const normFilename = normalizeQuery(item.filename);
    const normTitle = normalizeQuery(item.title);
    const normSummary = normalizeQuery(item.summary);

    if (normFilename.includes(cleanQuery) || cleanQuery.includes(normFilename)) {
      return true;
    }

    if (item.aliases.some((alias) => alias === cleanQuery || queryWords.includes(alias))) {
      return true;
    }

    if (normTitle.includes(cleanQuery) || normSummary.includes(cleanQuery)) {
      return true;
    }

    return item.aliases.some((alias) => alias.length >= 3 && cleanQuery.includes(alias));
  });

  if (matchedFile) {
    return formatFileContentCard(matchedFile);
  }

  // 4. Búsqueda en documentos de Supabase
  if (supabaseDocs && supabaseDocs.length > 0) {
    const matchedDbDoc = supabaseDocs.find((doc) => {
      const docId = normalizeQuery(doc.id);
      const docTitle = normalizeQuery(doc.title);
      const docContent = normalizeQuery(doc.content);
      return docId.includes(cleanQuery) || docTitle.includes(cleanQuery) || docContent.includes(cleanQuery);
    });

    if (matchedDbDoc) {
      const contentSnippet = matchedDbDoc.summary || (matchedDbDoc.content ? matchedDbDoc.content.slice(0, 600) + (matchedDbDoc.content.length > 600 ? '...' : '') : 'Sin contenido.');

      return heraldCard(`Documento: ${matchedDbDoc.title}`, [
        heraldStat('ID', `\`${matchedDbDoc.id || 'db_doc'}\``),
        heraldStat('Categoría', `*${String(matchedDbDoc.category || matchedDbDoc.type || 'Grimorio').toUpperCase()}*`),
        heraldStat('Fuente', `*${matchedDbDoc.source || 'Supabase / Bot'}*`),
        '',
        heraldSection('Extracto de Contenido'),
        contentSnippet,
        '',
        `_Usa \`!dataver\` para volver a la lista de archivos._`,
      ], { icon: '📜' });
    }
  }

  // 5. Sin coincidencias
  return heraldCard('Archivo no encontrado', [
    `No se encontró ningún archivo o documento que coincida con "*${query}*".`,
    '',
    '✦ Usa `!dataver` sin argumentos para ver la lista completa de archivos.',
    '✦ Ejemplos válidos: `!dataver 3`, `!dataver historia de valdren`, `!dataver espinas`, `!dataver bolsa`, `!dataver pociones`.',
  ], { icon: '❓' });
}

function formatFileContentCard(item) {
  const lines = [
    heraldStat('Archivo', `\`${item.filename}\``),
    heraldStat('Categoría', `*${item.category}*`),
    heraldStat('Tomo Canon', `*#${item.index}*`),
    '',
    heraldSection('Sinopsis del Archivo'),
    item.summary,
    '',
    heraldSection('Extracto del Texto'),
    `"${item.excerpt}"`,
    '',
    heraldSection('Puntos Destacados'),
    ...item.highlights,
    '',
    `_Usa \`!dataver\` para ver otros archivos disponibles._`,
  ];

  return heraldCard(item.title, lines, {
    icon: '📄',
    footer: `✦ Archivo Canónico · _Kingdoom Bot Lore_`,
  });
}
