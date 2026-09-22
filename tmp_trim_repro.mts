// Repro: trimMessagesToTokenBudget — kapan "TAHAP 2" menyentuh out[lastIdx] yang sudah tidak valid?
import { trimMessagesToTokenBudget } from './src/providers.js';

const sys = 'S'.repeat(19000); // system prompt besar (≈5.754 token per komentar kode)
const h1 = { role: 'user', content: 'x'.repeat(5000) };
const h2 = { role: 'assistant', content: 'y'.repeat(5000) };
const last = { role: 'user', content: 'z'.repeat(30000) }; // pesan terakhir besar (konteks web/dokumen)

try {
  const out = trimMessagesToTokenBudget(
    [{ role: 'system', content: sys }, h1, h2, last] as any,
    8000,
  );
  console.log('TANPA CRASH. jumlah pesan =', out.length, 'panjang pesan terakhir =', String((out[out.length - 1] as any).content).length);
} catch (e: any) {
  console.log('CRASH:', e.constructor.name, '-', e.message);
}
