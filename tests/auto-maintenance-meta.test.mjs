import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Isolasi penuh: pastikan test tidak pernah menulis ke Supabase produksi atau mengirim Telegram nyata.
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_PATH = '__nonexistent_env_for_test__';
process.env.SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_SECRET_KEY = '';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.OWNER_CHAT_ID = '';

const {
  klasifikasiErrorMeta,
  evaluasiHealthStatusMeta,
  catatHasilKirimMeta,
  catatStatusDeliveryMeta,
  statusAutoMaintenanceWa,
  resetMonitorWaUntukTest,
} = await import('../src/wa_monitor.js');

const baca = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

beforeEach(() => {
  resetMonitorWaUntukTest();
});

test('1. klasifikasiErrorMeta membedakan blokir akun, gangguan sementara, dan error per-penerima', () => {
  for (const code of [141006, 131042, 131031, 190, 368, 131048]) {
    assert.equal(klasifikasiErrorMeta({ httpStatus: 400, metaCode: code }), 'blokir_akun', `kode ${code}`);
  }
  assert.equal(klasifikasiErrorMeta({ httpStatus: 401 }), 'blokir_akun');
  assert.equal(klasifikasiErrorMeta({ httpStatus: 403 }), 'blokir_akun');

  assert.equal(klasifikasiErrorMeta({ networkError: true }), 'sementara');
  assert.equal(klasifikasiErrorMeta({ httpStatus: 500 }), 'sementara');
  assert.equal(klasifikasiErrorMeta({ httpStatus: 503 }), 'sementara');
  assert.equal(klasifikasiErrorMeta({ httpStatus: 429 }), 'sementara');
  for (const code of [131016, 130429, 131000]) {
    assert.equal(klasifikasiErrorMeta({ httpStatus: 500, metaCode: code }), 'sementara', `kode ${code}`);
  }

  for (const code of [131047, 131026, 131051, 131052, 131056, 131009, 100]) {
    assert.equal(klasifikasiErrorMeta({ httpStatus: 400, metaCode: code }), 'abaikan', `kode ${code}`);
  }
});

test('2. Blokir silent-HTTP-200 (141006): langsung aktif, tidak mati oleh HTTP 200, hanya pulih oleh delivered', async () => {
  let st = await statusAutoMaintenanceWa();
  assert.equal(st.aktif, false);

  await catatStatusDeliveryMeta('failed', [{ code: 141006, title: 'Payment method error' }]);
  st = await statusAutoMaintenanceWa();
  assert.equal(st.aktif, true);
  assert.match(st.alasan, /^blokir:.*141006/);

  // Simulasi POST /messages tetap balas HTTP 200 saat payment method bermasalah
  await catatHasilKirimMeta(true);
  st = await statusAutoMaintenanceWa();
  assert.equal(st.aktif, true, 'HTTP 200 dari Meta tidak boleh mematikan status blokir akun');

  // Hanya pulih bila pesan benar-benar delivered ke HP penerima
  await catatStatusDeliveryMeta('delivered');
  st = await statusAutoMaintenanceWa();
  assert.equal(st.aktif, false);
});

test('3. Gangguan sementara / tidak merespon: butuh 3x berturut-turut, pulih oleh HTTP 200', async () => {
  await catatHasilKirimMeta(false, { networkError: true, message: 'fetch timeout' });
  assert.equal((await statusAutoMaintenanceWa()).aktif, false);

  await catatHasilKirimMeta(false, { httpStatus: 503, message: 'Service Unavailable' });
  assert.equal((await statusAutoMaintenanceWa()).aktif, false);

  await catatHasilKirimMeta(false, { networkError: true, message: 'fetch timeout' });
  const st = await statusAutoMaintenanceWa();
  assert.equal(st.aktif, true);
  assert.match(st.alasan, /^sementara:/);

  await catatHasilKirimMeta(true);
  assert.equal((await statusAutoMaintenanceWa()).aktif, false);
});

test('4. Error per-penerima (131047 lewat 24 jam) tidak pernah menyalakan maintenance meski berulang', async () => {
  for (let i = 0; i < 6; i++) {
    await catatHasilKirimMeta(false, { httpStatus: 400, metaCode: 131047, message: 'Re-engagement message' });
    await catatStatusDeliveryMeta('failed', [{ code: 131047, message: 'More than 24 hours' }]);
  }
  const st = await statusAutoMaintenanceWa();
  assert.equal(st.aktif, false);
});

test('5. evaluasiHealthStatusMeta mengabaikan SIP BLOCKED & LIMITED, menangkap WABA BLOCKED', () => {
  const sehatTapiLimited = {
    health_status: {
      can_send_message: 'LIMITED',
      entities: [
        {
          entity_type: 'PHONE_NUMBER',
          can_send_message: 'LIMITED',
          can_receive_call_sip: 'BLOCKED',
          errors: [{ error_code: 138024 }],
        },
        { entity_type: 'WABA', can_send_message: 'AVAILABLE' },
        {
          entity_type: 'BUSINESS',
          can_send_message: 'LIMITED',
          errors: [{ error_code: 141010 }],
        },
        {
          entity_type: 'APP',
          can_send_message: 'AVAILABLE',
          can_receive_call_sip: 'BLOCKED',
          errors: [{ error_code: 138025 }],
        },
      ],
    },
  };
  assert.deepEqual(evaluasiHealthStatusMeta(sehatTapiLimited), { blocked: false });

  const terblokirPayment = {
    health_status: {
      can_send_message: 'BLOCKED',
      entities: [
        {
          entity_type: 'WABA',
          can_send_message: 'BLOCKED',
          errors: [{ error_code: 141006, error_description: 'There is an error with the payment method.' }],
        },
      ],
    },
  };
  const hasil = evaluasiHealthStatusMeta(terblokirPayment);
  assert.equal(hasil.blocked, true);
  assert.match(hasil.reason || '', /141006/);
});

test('6. Isolasi sumber: error model AI (providers/skills) dan Baileys tidak memicu auto-maintenance Meta', () => {
  for (const file of ['src/providers.ts', 'src/skills.ts', 'src/whatsapp_baileys.ts']) {
    const src = baca(file);
    assert.ok(!src.includes('catatHasilKirimMeta'), `${file} tidak boleh memanggil catatHasilKirimMeta`);
    assert.ok(!src.includes('catatStatusDeliveryMeta'), `${file} tidak boleh memanggil catatStatusDeliveryMeta`);
    assert.ok(!src.includes('periksaHealthStatusMeta'), `${file} tidak boleh memanggil periksaHealthStatusMeta`);
    assert.ok(!src.includes('statusAutoMaintenanceWa'), `${file} tidak boleh bergantung ke statusAutoMaintenanceWa`);
  }
});
