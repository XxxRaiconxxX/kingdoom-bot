import { pairColosseumFighters } from '../src/loreRaces.js';
import { createColosseumMatch, recordColosseumBet } from '../src/colosseumStore.js';

const { fighterA, fighterB } = pairColosseumFighters();

const rawEpithetA = (fighterA.epithet || '').replace(/^"|"$/g, '');
const rawEpithetB = (fighterB.epithet || '').replace(/^"|"$/g, '');

function formatSkillOrTrait(text) {
  if (!text) return '';
  const colonIndex = text.indexOf(':');
  if (colonIndex !== -1) {
    const title = text.slice(0, colonIndex).trim();
    const desc = text.slice(colonIndex + 1).trim();
    return `*${title}*\n${desc}`;
  }
  const parenMatch = text.match(/^([^(]+)\(([^)]+)\)\.?$/);
  if (parenMatch) {
    const title = parenMatch[1].trim();
    let desc = parenMatch[2].trim();
    desc = desc.replace(/,\s*/g, ' → ');
    return `*${title}*\n${desc}`;
  }
  return text;
}

function formatFighterCard(fighter, label, icon) {
  const border = `${icon}━━━━━━━━━━━━━━━━${icon}`;
  const rawEpithet = (fighter.epithet || '').replace(/^"|"$/g, '');
  const passiveFormatted = formatSkillOrTrait(fighter.passiveTrait);
  const skillFormatted = formatSkillOrTrait(fighter.specialSkill);

  return [
    border,
    `   LUCHADOR ${label}`,
    border,
    '',
    `👑 *${fighter.name.toUpperCase()}*`,
    `_"${rawEpithet}"_`,
    '',
    `🏛️ _Raza y Facción_`,
    `${fighter.raceName} · ${fighter.faction}`,
    '',
    `🛡️ _Arma_`,
    `${fighter.weapon}`,
    '',
    `⚖️ _Complexión_`,
    `${fighter.height} · ${fighter.weight}`,
    '',
    `━━━ 📊 ATRIBUTOS ━━━`,
    `FUE ${fighter.stats.str} │ DES ${fighter.stats.dex} │ CON ${fighter.stats.con}`,
    `ARC ${fighter.stats.arc} │ RES ${fighter.stats.res}`,
    '',
    `━━━ 📈 COMBATE ━━━`,
    `💥 ${fighter.metrics.forceKn} kN de impacto`,
    `🏃 ${fighter.metrics.speedMs} m/s`,
    `⚡ ${fighter.metrics.reactionMs} ms de reacción`,
    '',
    `🩸 *Salud Máxima:* ${fighter.maxHp} HP`,
    '',
    `⚔️ _Rasgo Pasivo_`,
    passiveFormatted,
    '',
    `✨ _Habilidad Especial_`,
    skillFormatted,
    '',
    `💰 *Multiplicador de Ganancia:* ${fighter.odds}x`,
    '',
    border,
    '',
    `👉 Cita este mensaje con`,
    `*"!apostar <monto>"*`,
    `para apostar por este gladiador`,
  ].join('\n');
}

console.log("==========================================");
console.log("📜 1. FICHA TÉCNICA - LUCHADOR A");
console.log("==========================================");
console.log(formatFighterCard(fighterA, 'A', '🗡️'));

console.log("\n==========================================");
console.log("📜 2. FICHA TÉCNICA - LUCHADOR B");
console.log("==========================================");
console.log(formatFighterCard(fighterB, 'B', '🪓'));

console.log("\n==========================================");
console.log("⚔️ 3. INICIO DE COMBATE EN LA ARENA");
console.log("==========================================");

const introArenaText = [
  '⚔️━━━━━━━━━━━━━━━━━━━━⚔️',
  '𝕰𝕷 𝕮𝕺𝕷𝕴𝕾𝕰𝕺 𝕯𝕰 𝕷𝕬𝕾',
  '𝕽𝕬𝖅𝕬𝕾 𝕳𝕬 𝕮𝕺𝕸𝕰𝕹𝖅𝕬𝕯𝕺',
  '⚔️━━━━━━━━━━━━━━━━━━━━⚔️',
  '',
  '_Las puertas de hierro forjado se abren',
  'con estruendo sobre las arenas doradas._',
  '',
  '🔵 *ESQUINA NORTE*',
  `*${fighterA.name}* — _${rawEpithetA}_`,
  `🗡️ ${fighterA.weapon}`,
  '',
  '🔴 *ESQUINA SUR*',
  `*${fighterB.name}* — _${rawEpithetB}_`,
  `🪓 ${fighterB.weapon}`,
  '',
  '⚔️━━━━━━━━━━━━━━━━━━━━⚔️',
  '',
  '🩸 *¡Los contendientes lucharán',
  'hasta que uno caiga a 0 HP!*',
  '',
  '⚔️━━━━━━━━━━━━━━━━━━━━⚔️',
].join('\n');

console.log(introArenaText);

console.log("\n==========================================");
console.log("⚔️ 4. ASALTO 1 (ATAQUE Y REACCIÓN)");
console.log("==========================================");

const attackText = [
  `⚔️ [ASALTO 1 · ${fighterA.name.toUpperCase()}]`,
  '',
  `┍━━━━━━━━━┙💥┕━━━━━━━━━┑`,
  `╔═══❖•°❲⚔️❳°•❖═══╗`,
  `  ${fighterA.name} — "${rawEpithetA}"`,
  `╚═══❖•°❲⚔️❳ °❖═══╝`,
  `┕━━━━━━━━━┑⚔️┍━━━━━━━━━┙`,
  `《Ambientación de la Arena》`,
  `> El choque electromagnético entre la fuerza de ${fighterA.raceName} y la defensa de ${fighterB.raceName} retumba en los bloques de basalto, haciendo oscilar las sombras y evaporando el agua estancada.`,
  '',
  `_*|Intencionalidad / Ataque|*_`,
  `_${fighterA.name} avanza a ${fighterA.metrics.speedMs} m/s con postura impecable, descargando su ${fighterA.weapon} con una potencia calculada de ${fighterA.metrics.forceKn} kN buscando fracturar la guardia enemiga._`,
  '',
  `|⚔️|➥ 💭 (Un impacto de ${fighterA.metrics.forceKn} kN a este ángulo romperá el centro de masa del rival si sus reflejos no superan los ${fighterB.metrics.reactionMs} ms.)`,
  '',
  `|⚔️|➥ 💬 — ¡Siente el peso del metal y la determinación de ${fighterA.faction}!`,
].join('\n');

console.log(attackText);

console.log("\n------------------------------------------");

const defendText = [
  `🛡️ [REACCIÓN · ${fighterB.name.toUpperCase()}]`,
  '',
  `┍━━━━━━━━━┙🛡️┕━━━━━━━━━┑`,
  `╔═══❖•°❲🛡️❳°•❖═══╗`,
  `  ${fighterB.name} — "${rawEpithetB}"`,
  `╚═══❖•°❲🛡️❳ °❖═══╝`,
  `┕━━━━━━━━━┑🛡️┍━━━━━━━━━┙`,
  `《Respuesta Táctica》`,
  `> El impacto altera la constante de fricción del suelo, haciendo crujir la cimentación abisal bajo las botas de ${fighterB.name}.`,
  '',
  `_*|Contraataque / Defensa|*_`,
  `_${fighterB.name} reacciona en ${fighterB.metrics.reactionMs} ms, interponiendo la guardia de su ${fighterB.weapon} para absorber la embestida, sufriendo un desgaste de 28 HP en la armadura._`,
  '',
  `|🛡️|➥ 💭 (La fuerza de ${fighterA.metrics.forceKn} kN supera el límite del escáner... debo estabilizar los algoritmos de defensa inmediatamente.)`,
  '',
  `|🛡️|➥ 💬 — Demuéstrame si tu software puede mantener la presión cuando el terreno deje de ser fijo.`,
].join('\n');

console.log(defendText);
