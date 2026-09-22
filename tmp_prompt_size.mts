// Ukur panjang prompt sistem produksi (tanpa jaringan/DB).
import { systemPrompt } from './src/skills.js';
try {
  const s = systemPrompt(undefined as any, null, 'halo');
  console.log('systemPrompt chars =', s.length, '| estimasi token (÷3.3) =', Math.ceil(s.length / 3.3), '| (÷4) =', Math.ceil(s.length / 4));
} catch (e: any) {
  console.log('GAGAL ukur systemPrompt:', e?.message);
}
