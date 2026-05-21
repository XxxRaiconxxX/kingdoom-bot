function toLineArray(lines) {
  return lines
    .flatMap((line) => String(line ?? '').split('\n'))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

export function heraldCard(title, lines = [], options = {}) {
  const icon = options.icon ? `${options.icon} ` : '';
  const bodyPrefix = options.bodyPrefix ?? '│ ';
  const footer = options.footer ?? '╰────────────────────';
  const header = `╭─〔 ${icon}*${title}* 〕`;
  const body = toLineArray(lines).map((line) => `${bodyPrefix}${line}`).join('\n');
  return `${header}\n${body}\n${footer}`;
}

export function heraldList(items = [], prefix = '•') {
  return items
    .filter(Boolean)
    .map((item) => `${prefix} ${item}`)
    .join('\n');
}

export function heraldStat(label, value) {
  return `• *${label}:* ${value}`;
}

export function heraldCommand(command, description) {
  return `• \`${command}\` ${description}`;
}

export function heraldSection(title) {
  return `┈┈┈ *${title}* ┈┈┈`;
}
