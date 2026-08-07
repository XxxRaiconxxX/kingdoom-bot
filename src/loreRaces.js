import fs from 'node:fs';
import path from 'node:path';

const LORE_DIRECTORY = process.env.LORE_DIRECTORY || 'C:\\Users\\e_grado\\Desktop\\kingdoom-lore\\razas';

// Embedded default archetypes fallback when disk directory is not accessible
const FALLBACK_RACES = [
  {
    key: 'humanos',
    name: 'Humano Imperial',
    faction: 'Kaelum-Gard',
    fue: 2, des: 2, con: 2, arc: 1,
    forceKn: 4.2, speedMs: 11.5, reactionMs: 140, hpJoules: 4800, magicMw: 12.0,
    passive: 'Adaptabilidad Táctica: +15% de defensa tras recibir un impacto crítico.',
    skill: 'Sentencia de Acero (1d20+FUE vs CD 13, daño masivo y aturdimiento).',
    weakness: 'Vulnerabilidad ante magia mental o venenos arcanos.',
  },
  {
    key: 'berserker-bestia',
    name: 'Berserker Bestia',
    faction: 'Los Páramos',
    fue: 4, des: 2, con: 3, arc: 0,
    forceKn: 7.8, speedMs: 13.0, reactionMs: 110, hpJoules: 6200, magicMw: 0.0,
    passive: 'Furia Sangrienta: El daño aumenta un 40% cuando el HP cae por debajo del 30%.',
    skill: 'Embate Sísmico (1d20+FUE vs CD 14, quiebra guardias y causa 25 de daño).',
    weakness: 'Defensa mágica reducida (-2 contra conjuros elementales).',
  },
  {
    key: 'altos-elfos',
    name: 'Alto Elfo Solar',
    faction: 'Kaelum-Gard',
    fue: 1, des: 3, con: 1, arc: 4,
    forceKn: 3.1, speedMs: 14.5, reactionMs: 95, hpJoules: 3900, magicMw: 38.0,
    passive: 'Aura Radiante: Quema a enemigos cercanos por 12 de daño de luz por turno.',
    skill: 'Ráfaga de Flechas de Luz (1d20+ARC vs CD 14, 3 proyectiles de 15 daño).',
    weakness: 'Resistencia física baja ante armas pesadas y contundentes.',
  },
  {
    key: 'golems-de-piedra',
    name: 'Golem de Piedra Rúnica',
    faction: 'Kaelum-Gard',
    fue: 5, des: 0, con: 5, arc: 2,
    forceKn: 12.5, speedMs: 7.0, reactionMs: 250, hpJoules: 8500, magicMw: 18.0,
    passive: 'Piel Pétrea: Reduce todo el daño físico directo en un 30%.',
    skill: 'Martillazo Telúrico (1d20+FUE vs CD 15, fractura armaduras enemigas).',
    weakness: 'Velocidad muy baja y lentitud extrema ante ataques rápidos.',
  },
  {
    key: 'aasimar',
    name: 'Aasimar de Luz',
    faction: 'Nexo de Arcania',
    fue: 2, des: 2, con: 2, arc: 4,
    forceKn: 3.5, speedMs: 12.5, reactionMs: 130, hpJoules: 4200, magicMw: 30.0,
    passive: 'Resistencia Celestial: Absorbe daño necrótico y radiante.',
    skill: 'Alma Radiante (Alas de luz por 2 turnos con +18 daño radiante).',
    weakness: 'Desventaja al canalizar runas astrales prolongadas.',
  },
  {
    key: 'lycans',
    name: 'Lycan de Sangre Alfa',
    faction: 'Oakhaven',
    fue: 4, des: 4, con: 3, arc: 0,
    forceKn: 6.8, speedMs: 15.2, reactionMs: 85, hpJoules: 5600, magicMw: 0.0,
    passive: 'Regeneración Bestial: Recupera 10 HP al inicio de cada asalto.',
    skill: 'Fauces Desgarradoras (1d20+FUE vs CD 13, desangrado continuo).',
    weakness: 'Vulnerabilidad letal a armas de plata o fuego arcano.',
  },
  {
    key: 'orcos-de-hierro',
    name: 'Orco de Hierro',
    faction: 'Kaelum-Gard',
    fue: 4, des: 1, con: 4, arc: 0,
    forceKn: 8.2, speedMs: 10.0, reactionMs: 160, hpJoules: 6400, magicMw: 0.0,
    passive: 'Determinación de Acero: Inmune a aturdimiento en el primer asalto.',
    skill: 'Tajo Decapitador (1d20+FUE vs CD 14, golpe demoledor de 30 daño).',
    weakness: 'Baja agilidad contra atacantes a distancia.',
  },
  {
    key: 'sombras-vivientes',
    name: 'Sombra Viviente',
    faction: 'Nexo de Arcania',
    fue: 1, des: 5, con: 1, arc: 3,
    forceKn: 2.8, speedMs: 16.0, reactionMs: 70, hpJoules: 3500, magicMw: 25.0,
    passive: 'Forma Ectoplásmica: 35% de probabilidad de evadir cualquier ataque físico.',
    skill: 'Daga de Sombras (1d20+DES vs CD 15, daño directo ignorando armadura).',
    weakness: 'Daño duplicado ante magia radiante o luz solar pura.',
  },
];

let loadedRacesCache = null;

export function loadAllLoreRaces() {
  if (loadedRacesCache) return loadedRacesCache;

  const catalog = [];

  try {
    if (fs.existsSync(LORE_DIRECTORY)) {
      const factions = fs.readdirSync(LORE_DIRECTORY);
      for (const factionDir of factions) {
        const factionPath = path.join(LORE_DIRECTORY, factionDir);
        if (!fs.statSync(factionPath).isDirectory()) continue;

        const raceDirs = fs.readdirSync(factionPath);
        for (const raceDir of raceDirs) {
          const racePath = path.join(factionPath, raceDir);
          if (!fs.statSync(racePath).isDirectory()) continue;

          const dndFile = path.join(racePath, 'raza-dnd.md');
          const numFile = path.join(racePath, 'raza-numerico.md');

          let dndContent = '';
          let numContent = '';
          if (fs.existsSync(dndFile)) dndContent = fs.readFileSync(dndFile, 'utf8');
          if (fs.existsSync(numFile)) numContent = fs.readFileSync(numFile, 'utf8');

          const parsed = parseLoreRaceMarkdown(factionDir, raceDir, dndContent, numContent);
          if (parsed) {
            catalog.push(parsed);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[loreRaces] Error leyendo directorio de lore, usando fallback:', err.message);
  }

  if (catalog.length === 0) {
    loadedRacesCache = FALLBACK_RACES;
  } else {
    loadedRacesCache = catalog;
  }

  return loadedRacesCache;
}

function parseLoreRaceMarkdown(factionDir, raceDir, dndText, numText) {
  const nameMatch = dndText.match(/🏰\s*([^\n\r]+)/i) || numText.match(/🏰\s*([^\n\r]+)/i);
  const rawName = nameMatch ? nameMatch[1].trim() : formatRaceName(raceDir);

  const fueMatch = dndText.match(/FUE\s*([+-]?\d+)/i);
  const desMatch = dndText.match(/DES\s*([+-]?\d+)/i);
  const conMatch = dndText.match(/CON\s*([+-]?\d+)/i);
  const arcMatch = dndText.match(/ARC\s*([+-]?\d+)/i);

  const forceMatch = numText.match(/Fuerza m[aá]xima:\s*([\d\.]+)\s*kN/i);
  const speedMatch = numText.match(/Velocidad de sprint:\s*([\d\.]+)\s*m\/s/i);
  const reactMatch = numText.match(/Tiempo de reacci[oó]n:\s*([\d\.]+)\s*ms/i);
  const hpMatch = numText.match(/Resistencia.*?:\s*([\d\.,]+)\s*J/i);
  const arcMwMatch = numText.match(/Potencia arcana:\s*([\d\.]+)\s*MW/i);

  const passiveMatch = dndText.match(/⚔️\s*RASGO PASIVO\s*[\n\r]+([^\n\r]+)/i)
    || numText.match(/⚔️\s*RASGO PASIVO\s*[\n\r]+([^\n\r]+)/i);
  const skillMatch = dndText.match(/✨\s*HABILIDAD ESPECIAL DE RAZA\s*[\n\r]+([^\n\r]+)/i)
    || numText.match(/✨\s*HABILIDAD ESPECIAL DE RAZA\s*[\n\r]+([^\n\r]+)/i);
  const weaknessMatch = dndText.match(/⚠️\s*(?:DEBILIDAD|L[IÍ]MITE F[IÍ]SICO)\s*[\n\r]+([^\n\r]+)/i)
    || numText.match(/⚠️\s*(?:DEBILIDAD|L[IÍ]MITE F[IÍ]SICO)\s*[\n\r]+([^\n\r]+)/i);

  return {
    key: raceDir,
    name: rawName,
    faction: formatFactionName(factionDir),
    fue: fueMatch ? Number.parseInt(fueMatch[1], 10) : 2,
    des: desMatch ? Number.parseInt(desMatch[1], 10) : 2,
    con: conMatch ? Number.parseInt(conMatch[1], 10) : 2,
    arc: arcMatch ? Number.parseInt(arcMatch[1], 10) : 1,
    forceKn: forceMatch ? Number.parseFloat(forceMatch[1]) : 4.0,
    speedMs: speedMatch ? Number.parseFloat(speedMatch[1]) : 11.0,
    reactionMs: reactMatch ? Number.parseFloat(reactMatch[1]) : 140,
    hpJoules: hpMatch ? Number.parseFloat(hpMatch[1].replace(/,/g, '')) : 4500,
    magicMw: arcMwMatch ? Number.parseFloat(arcMwMatch[1]) : 10.0,
    passive: passiveMatch ? passiveMatch[1].trim() : 'Determinación marcial en la arena.',
    skill: skillMatch ? skillMatch[1].trim() : 'Impacto demoledor de combate.',
    weakness: weaknessMatch ? weaknessMatch[1].trim() : 'Desgaste por combate prolongado.',
  };
}

function formatRaceName(str) {
  return str
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatFactionName(str) {
  if (str === 'kaelum-gard') return 'Kaelum-Gard';
  if (str === 'arcania') return 'Nexo de Arcania';
  if (str === 'los-paramos') return 'Los Páramos';
  if (str === 'oakhaven') return 'Oakhaven';
  return formatRaceName(str);
}

const GLADIATOR_FIRST_NAMES = [
  'Aurelius', 'Valerius', 'Kaelen', 'Voss', 'Grom\'Gar', 'Baelor', 'Ignis', 'Morrigan',
  'Lyra', 'Drakar', 'Thorn', 'Zephyrus', 'Malakar', 'Skal', 'Fenrir', 'Azazel',
  'Orion', 'Kagura', 'Vaelin', 'Nyx', 'Ragnor', 'Sylas', 'Typhon', 'Zarek',
];

const GLADIATOR_EPITHETS = [
  'El Rompehuesos', 'La Sombra Danzante', 'El Martillo del Alba', 'El Segador del Páramo',
  'Luz del Juicio', 'El Coloso Pétreo', 'La Espada Silenciosa', 'Furia Carmesí',
  'El Heraldo del Viento', 'El Devorador de Éter', 'La Hoja Nocturna', 'El Bastión Inquebrantable',
  'La Garras de Sangre', 'El Ojo del Abismo', 'El Titán de Fuego', 'El Azote Rúnico',
];

const WEAPONS_CATALOG = [
  { name: 'Mandoble Pesado de Acero Forjado', type: 'físico', bonusAtk: 6, bonusDef: 2 },
  { name: 'Hacha de Guerra de Dos Filos', type: 'físico', bonusAtk: 8, bonusDef: 0 },
  { name: 'Lanza Rúnica y Broquel Sagrado', type: 'mixto', bonusAtk: 5, bonusDef: 4 },
  { name: 'Dagas Gemelas de Titanio Envenenadas', type: 'agilidad', bonusAtk: 7, bonusDef: -1 },
  { name: 'Báculo de Cristal Astral', type: 'mágico', bonusAtk: 9, bonusDef: 0 },
  { name: 'Cestus de Hierro con Púas', type: 'físico', bonusAtk: 6, bonusDef: 3 },
  { name: 'Mayal de Guerra Espinado', type: 'físico', bonusAtk: 7, bonusDef: 1 },
  { name: 'Espada Larga Celestial', type: 'mixto', bonusAtk: 6, bonusDef: 3 },
];

export function generateColosseumFighter(seedRace = null, excludedKey = null) {
  const races = loadAllLoreRaces();
  const available = races.filter((r) => r.key !== excludedKey);
  const race = seedRace || available[Math.floor(Math.random() * available.length)] || races[0];

  const name = GLADIATOR_FIRST_NAMES[Math.floor(Math.random() * GLADIATOR_FIRST_NAMES.length)];
  const epithet = GLADIATOR_EPITHETS[Math.floor(Math.random() * GLADIATOR_EPITHETS.length)];
  const weapon = WEAPONS_CATALOG[Math.floor(Math.random() * WEAPONS_CATALOG.length)];

  const heightMeters = (1.70 + Math.random() * 0.55).toFixed(2);
  const weightKg = Math.round(75 + Math.random() * 85 + (race.fue * 10));

  const str = Math.max(1, Math.min(10, Math.round(race.fue + 3 + Math.random() * 2)));
  const dex = Math.max(1, Math.min(10, Math.round(race.des + 3 + Math.random() * 2)));
  const con = Math.max(1, Math.min(10, Math.round(race.con + 3 + Math.random() * 2)));
  const arc = Math.max(0, Math.min(10, Math.round(race.arc + 2 + Math.random() * 2)));
  const res = Math.max(1, Math.min(10, Math.round((race.con + race.fue) / 2 + 2)));

  const maxHp = 100 + (con * 5);
  const basePowerScore = (str * 2.5) + (dex * 2.2) + (con * 2.0) + (arc * 2.4) + (res * 1.5) + weapon.bonusAtk + weapon.bonusDef;

  return {
    id: `fighter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name,
    epithet: `"${epithet}"`,
    fullName: `${name} ${epithet}`,
    raceKey: race.key,
    raceName: race.name,
    faction: race.faction,
    height: `${heightMeters}m`,
    weight: `${weightKg}kg`,
    profession: 'Gladiador de la Arena Imperial',
    weapon: weapon.name,
    weaponType: weapon.type,
    weaponBonusAtk: weapon.bonusAtk,
    weaponBonusDef: weapon.bonusDef,
    stats: {
      str,
      dex,
      con,
      arc,
      res,
    },
    metrics: {
      forceKn: Number((race.forceKn + (str * 0.3)).toFixed(1)),
      speedMs: Number((race.speedMs + (dex * 0.4)).toFixed(1)),
      reactionMs: Math.max(40, Math.round(race.reactionMs - (dex * 5))),
      magicMw: Number((race.magicMw + (arc * 2.0)).toFixed(1)),
    },
    maxHp,
    currentHp: maxHp,
    passiveTrait: race.passive,
    specialSkill: race.skill,
    weakness: race.weakness,
    powerScore: Number(basePowerScore.toFixed(1)),
    odds: 2.0,
    buffs: [],
    nerfs: [],
  };
}

export function pairColosseumFighters() {
  const fighterA = generateColosseumFighter();
  const fighterB = generateColosseumFighter(null, fighterA.raceKey);

  const totalPower = fighterA.powerScore + fighterB.powerScore;
  const probA = Math.max(0.25, Math.min(0.75, fighterA.powerScore / totalPower));
  const probB = 1 - probA;

  const houseMargin = 0.90;
  const rawOddsA = (1 / probA) * houseMargin;
  const rawOddsB = (1 / probB) * houseMargin;

  fighterA.odds = Number(Math.max(1.30, Math.min(4.50, rawOddsA)).toFixed(2));
  fighterB.odds = Number(Math.max(1.30, Math.min(4.50, rawOddsB)).toFixed(2));

  return { fighterA, fighterB };
}
