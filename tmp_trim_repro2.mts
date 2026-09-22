// Repro 2: jalur potong LAST MESSAGE (bukan buang riwayat) — inilah yang bikin crash
// ketika total token sudah turun di bawah budget setelah riwayat dibuang.
import { trimMessagesToTokenBudget } from './src/providers.js';

// Skenario 1: system 14k char (~4.2k tok) + 1 pesan user 20k char (~6k tok) -> >8k, riwayat cuma 1 msg
const sys = { role: 'system', content: 'S'.repeat(14000) };
const last = { role: 'user', content: 'Pertanyaan di atas.\n' + 'KONTEKS WEB '.repeat(1800) }; // ~21k char

try {
  const out = trimMessagesToTokenBudget([sys, last] as any, 8000);
  console.log('SKENARIO 1 OK. pesan =', out.length, 'panjang akhir =', String((out[out.length - 1] as any).content).length);
} catch (e: any) {
  console.log('SKENARIO 1 CRASH:', e.constructor.name, '-', e.message);
}

// Skenario 2: system besar + 2 riwayat + last besar (kasus pertama saya)
const h1 = { role: 'user', content: 'x'.repeat(5000) };
const h2 = { role: 'assistant', content: 'y'.repeat(5000) };
const last2 = { role: 'user', content: 'z'.repeat(30000) };
try {
  const out = trimMessagesToTokenBudget([{ role: 'system', content: 'S'.repeat(19000) }, h1, h2, last2] as any, 8000);
  console.log('SKENARIO 2 OK. pesan =', out.length);
} catch (e: any) {
  console.log('SKENARIO 2 CRASH:', e.constructor.name, '-', e.message);
}

// Skenario 3: lastIdx == 0 (system saja + lastIdx 0?) — messages [system, last] dengan out.length=2
const sys3 = { role: 'system', content: 'S'.repeat(40000) }; // system > budget sendirian
try {
  const out = trimMessagesToTokenBudget([sys3, { role: 'user', content: 'halo' }] as any, 8000);
  console.log('SKENARIO 3 OK. pesan =', out.length, '| konten terakhir =', JSON.stringify(String((out[out.length-1] as any).content).slice(0, 80)));
} catch (e: any) {
  console.log('SKENARIO 3 CRASH:', e.constructor.name, '-', e.message);
}
