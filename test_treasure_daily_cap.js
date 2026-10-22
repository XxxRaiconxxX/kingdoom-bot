import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./src/handlers/treasure.js', import.meta.url), 'utf8');
assert.match(source, /const numEvents = 2;/, 'El plan diario debe limitarse exactamente a 2 eventos.');
assert.doesNotMatch(source, /Math\.floor\(Math\.random\(\) \* 3\) \+ 2/, 'No debe conservarse el rango aleatorio de 2 a 4 eventos.');
console.log('TREASURE_DAILY_MAX_TWO_OK');
