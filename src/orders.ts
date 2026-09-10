import { chat } from './providers.js';
import { db } from './db.js';

export interface OrderItem {
  name: string;
  qty: number;
  price?: number | null;
}

export interface ParsedOrder {
  is_order: boolean;
  customer?: string | null;
  items: OrderItem[];
  total?: number | null;
}

export interface OrderRow {
  customer: string | null;
  items: OrderItem[];
  total: number | null;
  created_at: string;
}

/** Heuristik murah: hanya panggil LLM jika pesan tampak seperti order. */
export function looksLikeOrder(text: string): boolean {
  return /\d/.test(text) && /(pesan|order|beli|mau|ambil|total|pcs|pack|bungkus|porsi|kg|liter|rp\b)/i.test(text);
}

export async function parseOrder(text: string): Promise<ParsedOrder | null> {
  const prompt = [
    'Ekstrak pesanan dari chat berikut ke JSON persis format:',
    '{"is_order":true|false,"customer":string|null,"items":[{"name":string,"qty":number,"price":number|null}],"total":number|null}',
    'Balas HANYA JSON valid, tanpa teks lain. Jika bukan pesanan: {"is_order":false,"items":[]}.',
    `Chat: ${text.slice(0, 500)}`,
  ].join('\n');
  try {
    const { text: out } = await chat([{ role: 'user', content: prompt }]);
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]) as ParsedOrder;
    if (!o.is_order || !Array.isArray(o.items) || o.items.length === 0) return { is_order: false, items: [] };
    return o;
  } catch {
    return null;
  }
}

export async function saveOrder(chatId: string, o: ParsedOrder): Promise<boolean> {
  const c = db();
  if (!c) return false;
  try {
    const computed = o.items.reduce((s, i) => s + i.qty * (i.price ?? 0), 0);
    const { error } = await c.from('orders').insert({
      chat_id: chatId,
      customer: o.customer ?? null,
      items: o.items,
      total: o.total ?? (computed > 0 ? computed : null),
      status: 'baru',
    });
    if (error) {
      console.error(`[orders] insert: ${error.code} ${error.message}`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function confirmText(o: ParsedOrder, saved: boolean): string {
  const lines = o.items.map((i) => {
    const price = i.price ? ` @Rp${i.price.toLocaleString('id-ID')}` : '';
    return `- ${i.name} x${i.qty}${price}`;
  });
  const totalLine = o.total ? `\nTotal: Rp${o.total.toLocaleString('id-ID')}` : '';
  const dbLine = saved ? '' : '\n(Catatan: arsip DB belum tersimpan.)';
  return `Pesanan tercatat kak:\n${lines.join('\n')}${totalLine}${dbLine}\nMohon konfirmasi jika sudah benar.`;
}

export async function todayOrders(): Promise<OrderRow[]> {
  const c = db();
  if (!c) return [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  try {
    const { data, error } = await c
      .from('orders')
      .select('customer,items,total,created_at')
      .gte('created_at', start.toISOString())
      .order('created_at', { ascending: true });
    if (error || !data) {
      if (error) console.error(`[orders] rekap: ${error.code} ${error.message}`);
      return [];
    }
    return data as unknown as OrderRow[];
  } catch {
    return [];
  }
}

export function formatRecap(rows: OrderRow[]): string {
  if (rows.length === 0) return 'Belum ada pesanan tercatat hari ini.';
  const lines = rows.map((r, i) => {
    const items = r.items.map((it) => `${it.name} x${it.qty}`).join(', ');
    const total = r.total ? ` = Rp${r.total.toLocaleString('id-ID')}` : '';
    const cust = r.customer ? ` (${r.customer})` : '';
    return `${i + 1}. ${items}${cust}${total}`;
  });
  const grand = rows.reduce((s, r) => s + (r.total ?? 0), 0);
  const grandLine = grand > 0 ? `\nOmzet tercatat: Rp${grand.toLocaleString('id-ID')}` : '';
  return `Rekap order hari ini (${rows.length} pesanan):\n${lines.join('\n')}${grandLine}`;
}
