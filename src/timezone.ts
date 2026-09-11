/**
 * Mesin Zona Waktu Global & Universal Real-Time Clock
 * Menangani waktu dinamis untuk pengguna di seluruh belahan bumi:
 * - Waktu Universal (UTC/GMT)
 * - 3 Zona Waktu Indonesia (WIB, WITA, WIT)
 * - Deteksi otomatis negara asal dari nomor telepon pengguna (E.164)
 * - Deteksi nama kota, provinsi, negara, atau zona waktu spesifik dari pesan pengguna
 * - Matriks kota acuan utama dunia (Tokyo, London, New York, Berlin, Mekkah, Sydney, dll)
 */

export interface FormattedTime {
  time: string;
  dateStr: string;
  dayName: string;
  tzName: string;
  full: string;
}

export function formatInZone(date: Date, timeZone: string): FormattedTime {
  try {
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const dayName = get('weekday');
    const time = `${get('hour')}:${get('minute')}:${get('second')}`;
    const dateStr = `${get('day')} ${get('month')} ${get('year')}`;
    const tzName = get('timeZoneName');
    const full = `${dayName}, ${dateStr} ${time} ${tzName}`.trim();
    return { time, dateStr, dayName, tzName, full };
  } catch {
    const time = date.toISOString().slice(11, 19);
    const dateStr = date.toISOString().slice(0, 10);
    return {
      time,
      dateStr,
      dayName: '',
      tzName: 'UTC',
      full: `${dateStr} ${time} UTC`,
    };
  }
}

export interface CountryTz {
  prefix: string;
  country: string;
  zone: string;
  note: string;
}

const COUNTRY_CODES: CountryTz[] = [
  { prefix: '62', country: 'Indonesia', zone: 'Asia/Jakarta', note: 'Indonesia (WIB UTC+7, WITA UTC+8, WIT UTC+9)' },
  { prefix: '60', country: 'Malaysia', zone: 'Asia/Kuala_Lumpur', note: 'Malaysia (MYT UTC+8)' },
  { prefix: '65', country: 'Singapura', zone: 'Asia/Singapore', note: 'Singapura (SGT UTC+8)' },
  { prefix: '673', country: 'Brunei', zone: 'Asia/Brunei', note: 'Brunei (BNT UTC+8)' },
  { prefix: '63', country: 'Filipina', zone: 'Asia/Manila', note: 'Filipina (PHT UTC+8)' },
  { prefix: '66', country: 'Thailand', zone: 'Asia/Bangkok', note: 'Thailand (ICT UTC+7)' },
  { prefix: '84', country: 'Vietnam', zone: 'Asia/Ho_Chi_Minh', note: 'Vietnam (ICT UTC+7)' },
  { prefix: '855', country: 'Kamboja', zone: 'Asia/Phnom_Penh', note: 'Kamboja (ICT UTC+7)' },
  { prefix: '856', country: 'Laos', zone: 'Asia/Vientiane', note: 'Laos (ICT UTC+7)' },
  { prefix: '95', country: 'Myanmar', zone: 'Asia/Yangon', note: 'Myanmar (MMT UTC+6:30)' },
  { prefix: '81', country: 'Jepang', zone: 'Asia/Tokyo', note: 'Jepang (JST UTC+9)' },
  { prefix: '82', country: 'Korea Selatan', zone: 'Asia/Seoul', note: 'Korea Selatan (KST UTC+9)' },
  { prefix: '86', country: 'China', zone: 'Asia/Shanghai', note: 'China (CST UTC+8)' },
  { prefix: '886', country: 'Taiwan', zone: 'Asia/Taipei', note: 'Taiwan (CST UTC+8)' },
  { prefix: '852', country: 'Hong Kong', zone: 'Asia/Hong_Kong', note: 'Hong Kong (HKT UTC+8)' },
  { prefix: '91', country: 'India', zone: 'Asia/Kolkata', note: 'India (IST UTC+5:30)' },
  { prefix: '92', country: 'Pakistan', zone: 'Asia/Karachi', note: 'Pakistan (PKT UTC+5)' },
  { prefix: '880', country: 'Bangladesh', zone: 'Asia/Dhaka', note: 'Bangladesh (BST UTC+6)' },
  { prefix: '966', country: 'Arab Saudi', zone: 'Asia/Riyadh', note: 'Arab Saudi (AST UTC+3)' },
  { prefix: '971', country: 'Uni Emirat Arab', zone: 'Asia/Dubai', note: 'UAE (GST UTC+4)' },
  { prefix: '974', country: 'Qatar', zone: 'Asia/Qatar', note: 'Qatar (AST UTC+3)' },
  { prefix: '965', country: 'Kuwait', zone: 'Asia/Kuwait', note: 'Kuwait (AST UTC+3)' },
  { prefix: '968', country: 'Oman', zone: 'Asia/Muscat', note: 'Oman (GST UTC+4)' },
  { prefix: '973', country: 'Bahrain', zone: 'Asia/Bahrain', note: 'Bahrain (AST UTC+3)' },
  { prefix: '962', country: 'Yordania', zone: 'Asia/Amman', note: 'Yordania (EEST/AST UTC+3)' },
  { prefix: '90', country: 'Turki', zone: 'Europe/Istanbul', note: 'Turki (TRT UTC+3)' },
  { prefix: '20', country: 'Mesir', zone: 'Africa/Cairo', note: 'Mesir (EET UTC+2/3)' },
  { prefix: '27', country: 'Afrika Selatan', zone: 'Africa/Johannesburg', note: 'Afrika Selatan (SAST UTC+2)' },
  { prefix: '44', country: 'Inggris / Britania Raya', zone: 'Europe/London', note: 'UK (GMT/BST UTC+0/+1)' },
  { prefix: '49', country: 'Jerman', zone: 'Europe/Berlin', note: 'Jerman (CET/CEST UTC+1/+2)' },
  { prefix: '33', country: 'Prancis', zone: 'Europe/Paris', note: 'Prancis (CET/CEST UTC+1/+2)' },
  { prefix: '31', country: 'Belanda', zone: 'Europe/Amsterdam', note: 'Belanda (CET/CEST UTC+1/+2)' },
  { prefix: '39', country: 'Italia', zone: 'Europe/Rome', note: 'Italia (CET/CEST UTC+1/+2)' },
  { prefix: '34', country: 'Spanyol', zone: 'Europe/Madrid', note: 'Spanyol (CET/CEST UTC+1/+2)' },
  { prefix: '41', country: 'Swiss', zone: 'Europe/Zurich', note: 'Swiss (CET/CEST UTC+1/+2)' },
  { prefix: '43', country: 'Austria', zone: 'Europe/Vienna', note: 'Austria (CET/CEST UTC+1/+2)' },
  { prefix: '32', country: 'Belgia', zone: 'Europe/Brussels', note: 'Belgia (CET/CEST UTC+1/+2)' },
  { prefix: '46', country: 'Swedia', zone: 'Europe/Stockholm', note: 'Swedia (CET/CEST UTC+1/+2)' },
  { prefix: '47', country: 'Norwegia', zone: 'Europe/Oslo', note: 'Norwegia (CET/CEST UTC+1/+2)' },
  { prefix: '45', country: 'Denmark', zone: 'Europe/Copenhagen', note: 'Denmark (CET/CEST UTC+1/+2)' },
  { prefix: '358', country: 'Finlandia', zone: 'Europe/Helsinki', note: 'Finlandia (EET/EEST UTC+2/+3)' },
  { prefix: '353', country: 'Irlandia', zone: 'Europe/Dublin', note: 'Irlandia (GMT/IST UTC+0/+1)' },
  { prefix: '48', country: 'Polandia', zone: 'Europe/Warsaw', note: 'Polandia (CET/CEST UTC+1/+2)' },
  { prefix: '7', country: 'Rusia', zone: 'Europe/Moscow', note: 'Rusia (MSK UTC+3)' },
  { prefix: '61', country: 'Australia', zone: 'Australia/Sydney', note: 'Australia (AEST/AEDT UTC+10/+11)' },
  { prefix: '64', country: 'Selandia Baru', zone: 'Pacific/Auckland', note: 'Selandia Baru (NZST/NZDT UTC+12/+13)' },
  { prefix: '1', country: 'Amerika Serikat / Kanada', zone: 'America/New_York', note: 'AS / Kanada (Eastern EDT/EST UTC-4/-5)' },
  { prefix: '52', country: 'Meksiko', zone: 'America/Mexico_City', note: 'Meksiko (CST UTC-6)' },
  { prefix: '55', country: 'Brasil', zone: 'America/Sao_Paulo', note: 'Brasil (BRT UTC-3)' },
  { prefix: '54', country: 'Argentina', zone: 'America/Argentina/Buenos_Aires', note: 'Argentina (ART UTC-3)' },
];

export function detectUserCountry(chatKey?: string): CountryTz | null {
  if (!chatKey || typeof chatKey !== 'string') return null;
  const numMatch = chatKey.match(/(?:wa:|\+)?(\d{7,15})/);
  if (!numMatch) return null;
  const digits = numMatch[1];
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const c of sorted) {
    if (digits.startsWith(c.prefix)) {
      return c;
    }
  }
  return null;
}

export interface LocationMatch {
  keywords: string[];
  zone: string;
  label: string;
}

const LOCATION_MAP: LocationMatch[] = [
  // Indonesian WITA (UTC+8)
  { keywords: ['bali', 'denpasar', 'kuta', 'ubud', 'gianyar', 'sanur', 'badung', 'tabanan', 'singaraja', 'buleleng'], zone: 'Asia/Makassar', label: 'Bali / WITA' },
  { keywords: ['lombok', 'mataram', 'sumbawa', 'bima', 'ntb'], zone: 'Asia/Makassar', label: 'NTB / WITA' },
  { keywords: ['kupang', 'flores', 'labuan bajo', 'sumba', 'ende', 'ntt'], zone: 'Asia/Makassar', label: 'NTT / WITA' },
  { keywords: ['banjarmasin', 'banjarbaru', 'kalsel', 'kalimantan selatan'], zone: 'Asia/Makassar', label: 'Kalimantan Selatan / WITA' },
  { keywords: ['samarinda', 'balikpapan', 'ikn', 'nusantara', 'bontang', 'kaltim', 'kalimantan timur'], zone: 'Asia/Makassar', label: 'Kalimantan Timur / WITA' },
  { keywords: ['tarakan', 'tanjung selor', 'kaltara', 'kalimantan utara'], zone: 'Asia/Makassar', label: 'Kalimantan Utara / WITA' },
  { keywords: ['makassar', 'gowa', 'maros', 'bone', 'palopo', 'parepare', 'sulsel', 'sulawesi selatan'], zone: 'Asia/Makassar', label: 'Sulawesi Selatan / WITA' },
  { keywords: ['manado', 'bitung', 'tomohon', 'sulut', 'sulawesi utara'], zone: 'Asia/Makassar', label: 'Sulawesi Utara / WITA' },
  { keywords: ['palu', 'luwuk', 'poso', 'sulteng', 'sulawesi tengah'], zone: 'Asia/Makassar', label: 'Sulawesi Tengah / WITA' },
  { keywords: ['kendari', 'bau-bau', 'baubau', 'sultra', 'sulawesi tenggara'], zone: 'Asia/Makassar', label: 'Sulawesi Tenggara / WITA' },
  { keywords: ['gorontalo'], zone: 'Asia/Makassar', label: 'Gorontalo / WITA' },
  { keywords: ['mamuju', 'sulbar', 'sulawesi barat'], zone: 'Asia/Makassar', label: 'Sulawesi Barat / WITA' },
  { keywords: ['wita', 'utc+8', 'gmt+8'], zone: 'Asia/Makassar', label: 'WITA (Waktu Indonesia Tengah)' },

  // Indonesian WIT (UTC+9)
  { keywords: ['jayapura', 'merauke', 'timika', 'mimika', 'wamena', 'nabire', 'biak', 'serui', 'papua'], zone: 'Asia/Jayapura', label: 'Papua / WIT' },
  { keywords: ['sorong', 'manokwari', 'fakfak', 'kaimana', 'papua barat', 'papua barat daya'], zone: 'Asia/Jayapura', label: 'Papua Barat / WIT' },
  { keywords: ['ambon', 'tual', 'banda', 'maluku'], zone: 'Asia/Jayapura', label: 'Maluku / WIT' },
  { keywords: ['ternate', 'tidore', 'sofifi', 'halmahera', 'maluku utara'], zone: 'Asia/Jayapura', label: 'Maluku Utara / WIT' },
  { keywords: ['wit', 'utc+9', 'gmt+9'], zone: 'Asia/Jayapura', label: 'WIT (Waktu Indonesia Timur)' },

  // Indonesian WIB (UTC+7)
  { keywords: ['jakarta', 'bogor', 'depok', 'tangerang', 'bekasi', 'jabodetabek'], zone: 'Asia/Jakarta', label: 'Jakarta / WIB' },
  { keywords: ['bandung', 'cirebon', 'sukabumi', 'tasikmalaya', 'jabar', 'jawa barat'], zone: 'Asia/Jakarta', label: 'Jawa Barat / WIB' },
  { keywords: ['serang', 'cilegon', 'banten'], zone: 'Asia/Jakarta', label: 'Banten / WIB' },
  { keywords: ['semarang', 'solo', 'surakarta', 'magelang', 'pekalongan', 'tegal', 'purwokerto', 'jateng', 'jawa tengah'], zone: 'Asia/Jakarta', label: 'Jawa Tengah / WIB' },
  { keywords: ['jogja', 'yogyakarta', 'sleman', 'bantul', 'diy'], zone: 'Asia/Jakarta', label: 'Yogyakarta / WIB' },
  { keywords: ['surabaya', 'malang', 'sidoarjo', 'banyuwangi', 'kediri', 'jember', 'madiun', 'jatim', 'jawa timur'], zone: 'Asia/Jakarta', label: 'Jawa Timur / WIB' },
  { keywords: ['aceh', 'banda aceh'], zone: 'Asia/Jakarta', label: 'Aceh / WIB' },
  { keywords: ['medan', 'sumut', 'sumatera utara'], zone: 'Asia/Jakarta', label: 'Sumatera Utara / WIB' },
  { keywords: ['padang', 'bukittinggi', 'sumbar', 'sumatera barat'], zone: 'Asia/Jakarta', label: 'Sumatera Barat / WIB' },
  { keywords: ['pekanbaru', 'dumai', 'riau'], zone: 'Asia/Jakarta', label: 'Riau / WIB' },
  { keywords: ['batam', 'tanjungpinang', 'bintan', 'kepri', 'kepulauan riau'], zone: 'Asia/Jakarta', label: 'Kepulauan Riau / WIB' },
  { keywords: ['palembang', 'sumsel', 'sumatera selatan'], zone: 'Asia/Jakarta', label: 'Sumatera Selatan / WIB' },
  { keywords: ['lampung', 'bandar lampung'], zone: 'Asia/Jakarta', label: 'Lampung / WIB' },
  { keywords: ['pontianak', 'singkawang', 'kalbar', 'kalimantan barat'], zone: 'Asia/Jakarta', label: 'Kalimantan Barat / WIB' },
  { keywords: ['palangkaraya', 'kalteng', 'kalimantan tengah'], zone: 'Asia/Jakarta', label: 'Kalimantan Tengah / WIB' },
  { keywords: ['wib', 'utc+7', 'gmt+7'], zone: 'Asia/Jakarta', label: 'WIB (Waktu Indonesia Barat)' },

  // Asia & Oceania
  { keywords: ['tokyo', 'kyoto', 'osaka', 'yokohama', 'nagoya', 'sapporo', 'fukuoka', 'jepang', 'japan', 'jst'], zone: 'Asia/Tokyo', label: 'Jepang (Tokyo)' },
  { keywords: ['seoul', 'busan', 'incheon', 'korea', 'korea selatan', 'south korea', 'kst'], zone: 'Asia/Seoul', label: 'Korea Selatan (Seoul)' },
  { keywords: ['beijing', 'shanghai', 'guangzhou', 'shenzhen', 'china', 'tiongkok'], zone: 'Asia/Shanghai', label: 'China (Beijing/Shanghai)' },
  { keywords: ['taipei', 'taiwan'], zone: 'Asia/Taipei', label: 'Taiwan (Taipei)' },
  { keywords: ['hong kong', 'hongkong', 'hk', 'hkt'], zone: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { keywords: ['singapore', 'singapura', 'sgt'], zone: 'Asia/Singapore', label: 'Singapura' },
  { keywords: ['kuala lumpur', 'penang', 'johor', 'malaysia', 'myt'], zone: 'Asia/Kuala_Lumpur', label: 'Malaysia (Kuala Lumpur)' },
  { keywords: ['bangkok', 'phuket', 'chiang mai', 'thailand'], zone: 'Asia/Bangkok', label: 'Thailand (Bangkok)' },
  { keywords: ['hanoi', 'ho chi minh', 'saigon', 'vietnam'], zone: 'Asia/Ho_Chi_Minh', label: 'Vietnam (Hanoi)' },
  { keywords: ['manila', 'cebu', 'filipina', 'philippines', 'pht'], zone: 'Asia/Manila', label: 'Filipina (Manila)' },
  { keywords: ['new delhi', 'delhi', 'mumbai', 'bangalore', 'bengaluru', 'chennai', 'kolkata', 'india', 'ist'], zone: 'Asia/Kolkata', label: 'India (New Delhi)' },
  { keywords: ['karachi', 'lahore', 'islamabad', 'pakistan', 'pkt'], zone: 'Asia/Karachi', label: 'Pakistan (Islamabad)' },
  { keywords: ['dhaka', 'bangladesh'], zone: 'Asia/Dhaka', label: 'Bangladesh (Dhaka)' },
  { keywords: ['dubai', 'abu dhabi', 'uae', 'uni emirat arab', 'gst'], zone: 'Asia/Dubai', label: 'Uni Emirat Arab (Dubai)' },
  { keywords: ['riyadh', 'mekkah', 'makkah', 'madinah', 'medina', 'jeddah', 'arab saudi', 'saudi arabia', 'saudi', 'ast'], zone: 'Asia/Riyadh', label: 'Arab Saudi (Mekkah/Riyadh)' },
  { keywords: ['doha', 'qatar'], zone: 'Asia/Qatar', label: 'Qatar (Doha)' },
  { keywords: ['kuwait', 'kuwait city'], zone: 'Asia/Kuwait', label: 'Kuwait' },
  { keywords: ['yerusalem', 'jerusalem', 'tel aviv', 'israel', 'palestina'], zone: 'Asia/Jerusalem', label: 'Yerusalem / Tel Aviv' },
  { keywords: ['tehran', 'teheran', 'iran'], zone: 'Asia/Tehran', label: 'Iran (Tehran)' },
  { keywords: ['istanbul', 'ankara', 'turki', 'turkey', 'trt'], zone: 'Europe/Istanbul', label: 'Turki (Istanbul)' },
  { keywords: ['sydney', 'melbourne', 'canberra', 'brisbane', 'australia timur', 'aest', 'aedt'], zone: 'Australia/Sydney', label: 'Australia (Sydney/Melbourne)' },
  { keywords: ['adelaide', 'darwin', 'acst', 'acdt'], zone: 'Australia/Adelaide', label: 'Australia (Adelaide)' },
  { keywords: ['perth', 'australia barat', 'awst'], zone: 'Australia/Perth', label: 'Australia (Perth)' },
  { keywords: ['auckland', 'wellington', 'selandia baru', 'new zealand', 'nzst', 'nzdt'], zone: 'Pacific/Auckland', label: 'Selandia Baru (Auckland)' },

  // Europe
  { keywords: ['london', 'manchester', 'birmingham', 'liverpool', 'edinburgh', 'inggris', 'uk', 'united kingdom', 'britania', 'bst', 'gmt'], zone: 'Europe/London', label: 'Inggris (London)' },
  { keywords: ['paris', 'lyon', 'marseille', 'nice', 'prancis', 'france'], zone: 'Europe/Paris', label: 'Prancis (Paris)' },
  { keywords: ['berlin', 'munich', 'frankfurt', 'hamburg', 'koln', 'stuttgart', 'jerman', 'germany', 'cet', 'cest'], zone: 'Europe/Berlin', label: 'Jerman (Berlin)' },
  { keywords: ['amsterdam', 'rotterdam', 'den haag', 'belanda', 'netherlands', 'holland'], zone: 'Europe/Amsterdam', label: 'Belanda (Amsterdam)' },
  { keywords: ['roma', 'rome', 'milan', 'napoli', 'italia', 'italy'], zone: 'Europe/Rome', label: 'Italia (Roma)' },
  { keywords: ['madrid', 'barcelona', 'valencia', 'spanyol', 'spain'], zone: 'Europe/Madrid', label: 'Spanyol (Madrid)' },
  { keywords: ['zurich', 'geneva', 'jenewa', 'bern', 'swiss', 'switzerland'], zone: 'Europe/Zurich', label: 'Swiss (Zurich)' },
  { keywords: ['wina', 'vienna', 'austria'], zone: 'Europe/Vienna', label: 'Austria (Wina)' },
  { keywords: ['brussels', 'belgia', 'belgium'], zone: 'Europe/Brussels', label: 'Belgia (Brussels)' },
  { keywords: ['stockholm', 'swedia', 'sweden'], zone: 'Europe/Stockholm', label: 'Swedia (Stockholm)' },
  { keywords: ['oslo', 'norwegia', 'norway'], zone: 'Europe/Oslo', label: 'Norwegia (Oslo)' },
  { keywords: ['kopenhagen', 'copenhagen', 'denmark'], zone: 'Europe/Copenhagen', label: 'Denmark (Kopenhagen)' },
  { keywords: ['helsinki', 'finlandia', 'finland', 'eet', 'eest'], zone: 'Europe/Helsinki', label: 'Finlandia (Helsinki)' },
  { keywords: ['reykjavik', 'islandia', 'iceland'], zone: 'Atlantic/Reykjavik', label: 'Islandia (Reykjavik)' },
  { keywords: ['dublin', 'irlandia', 'ireland'], zone: 'Europe/Dublin', label: 'Irlandia (Dublin)' },
  { keywords: ['warsawa', 'warsaw', 'polandia', 'poland'], zone: 'Europe/Warsaw', label: 'Polandia (Warsawa)' },
  { keywords: ['praha', 'prague', 'ceko', 'czech'], zone: 'Europe/Prague', label: 'Ceko (Praha)' },
  { keywords: ['moskow', 'moscow', 'saint petersburg', 'rusia', 'russia', 'msk'], zone: 'Europe/Moscow', label: 'Rusia (Moskow)' },
  { keywords: ['kyiv', 'kiev', 'ukraina', 'ukraine'], zone: 'Europe/Kyiv', label: 'Ukraina (Kyiv)' },
  { keywords: ['athena', 'athens', 'yunani', 'greece'], zone: 'Europe/Athens', label: 'Yunani (Athena)' },

  // Americas
  { keywords: ['new york', 'nyc', 'washington', 'washington dc', 'boston', 'philadelphia', 'miami', 'atlanta', 'florida', 'est', 'edt', 'us eastern'], zone: 'America/New_York', label: 'AS Eastern (New York)' },
  { keywords: ['chicago', 'houston', 'dallas', 'austin', 'san antonio', 'cst', 'cdt', 'us central'], zone: 'America/Chicago', label: 'AS Central (Chicago)' },
  { keywords: ['denver', 'phoenix', 'arizona', 'salt lake city', 'colorado', 'mst', 'mdt', 'us mountain'], zone: 'America/Denver', label: 'AS Mountain (Denver)' },
  { keywords: ['los angeles', 'la', 'san francisco', 'sf', 'seattle', 'san diego', 'las vegas', 'california', 'portland', 'pst', 'pdt', 'us pacific'], zone: 'America/Los_Angeles', label: 'AS Pacific (Los Angeles)' },
  { keywords: ['honolulu', 'hawaii', 'hst'], zone: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { keywords: ['anchorage', 'alaska', 'akst', 'akdt'], zone: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { keywords: ['toronto', 'ottawa', 'montreal', 'quebec', 'kanada', 'canada'], zone: 'America/Toronto', label: 'Kanada (Toronto)' },
  { keywords: ['vancouver', 'calgary'], zone: 'America/Vancouver', label: 'Kanada (Vancouver)' },
  { keywords: ['mexico city', 'guadalajara', 'monterrey', 'meksiko', 'mexico'], zone: 'America/Mexico_City', label: 'Meksiko (Mexico City)' },
  { keywords: ['sao paulo', 'rio de janeiro', 'brasilia', 'brasil', 'brazil', 'brt'], zone: 'America/Sao_Paulo', label: 'Brasil (Sao Paulo)' },
  { keywords: ['buenos aires', 'argentina', 'art'], zone: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
  { keywords: ['bogota', 'kolombia', 'colombia'], zone: 'America/Bogota', label: 'Kolombia (Bogota)' },
  { keywords: ['santiago', 'chili', 'chile'], zone: 'America/Santiago', label: 'Chili (Santiago)' },
  { keywords: ['lima', 'peru'], zone: 'America/Lima', label: 'Peru (Lima)' },

  // Africa
  { keywords: ['kairo', 'cairo', 'mesir', 'egypt'], zone: 'Africa/Cairo', label: 'Mesir (Kairo)' },
  { keywords: ['johannesburg', 'cape town', 'pretoria', 'afrika selatan', 'south africa', 'sast'], zone: 'Africa/Johannesburg', label: 'Afrika Selatan (Johannesburg)' },
  { keywords: ['lagos', 'abuja', 'nigeria'], zone: 'Africa/Lagos', label: 'Nigeria (Lagos)' },
  { keywords: ['nairobi', 'kenya', 'eat'], zone: 'Africa/Nairobi', label: 'Kenya (Nairobi)' },
  { keywords: ['casablanca', 'rabat', 'maroko', 'morocco'], zone: 'Africa/Casablanca', label: 'Maroko (Casablanca)' },
];

export function detectLocation(text?: string): LocationMatch | null {
  if (!text || typeof text !== 'string') return null;
  const q = text.toLowerCase();
  for (const item of LOCATION_MAP) {
    for (const kw of item.keywords) {
      const reg = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (reg.test(q)) {
        return item;
      }
    }
  }
  return null;
}

/**
 * Resolusi zona waktu dari koordinat GPS latitude dan longitude
 */
export function resolveTimezoneFromCoords(lat: number, lon: number): { zone: string; label: string } {
  // Indonesia bounds: Lat -11.5 to 6.5, Lon 94.5 to 141.5
  if (lat >= -11.5 && lat <= 6.5 && lon >= 94.5 && lon <= 141.5) {
    if (lon < 114.3) {
      return { zone: 'Asia/Jakarta', label: 'WIB (Waktu Indonesia Barat)' };
    } else if (lon < 125.0) {
      return { zone: 'Asia/Makassar', label: 'WITA (Waktu Indonesia Tengah)' };
    } else {
      return { zone: 'Asia/Jayapura', label: 'WIT (Waktu Indonesia Timur)' };
    }
  }

  // Luar Indonesia
  if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) {
    if (lon >= -85) return { zone: 'America/New_York', label: 'AS Eastern (EDT/EST)' };
    if (lon >= -100) return { zone: 'America/Chicago', label: 'AS Central (CDT/CST)' };
    if (lon >= -115) return { zone: 'America/Denver', label: 'AS Mountain (MDT/MST)' };
    return { zone: 'America/Los_Angeles', label: 'AS Pacific (PDT/PST)' };
  }
  if (lat >= 35 && lat <= 70 && lon >= -10 && lon <= 40) {
    if (lon < 2) return { zone: 'Europe/London', label: 'Inggris / UK (GMT/BST)' };
    if (lon < 25) return { zone: 'Europe/Berlin', label: 'Eropa Tengah (CET/CEST)' };
    return { zone: 'Europe/Helsinki', label: 'Eropa Timur (EET/EEST)' };
  }
  if (lat >= -45 && lat <= -10 && lon >= 110 && lon <= 160) {
    if (lon < 129) return { zone: 'Australia/Perth', label: 'Australia Barat (AWST)' };
    if (lon < 138) return { zone: 'Australia/Adelaide', label: 'Australia Tengah (ACST)' };
    return { zone: 'Australia/Sydney', label: 'Australia Timur (AEST/AEDT)' };
  }
  if (lat >= 20 && lat <= 45 && lon >= 125 && lon <= 145) {
    return { zone: 'Asia/Tokyo', label: 'Jepang (JST)' };
  }

  const offsetHours = Math.round(lon / 15);
  return { zone: 'UTC', label: `UTC${offsetHours >= 0 ? '+' : ''}${offsetHours}` };
}

/**
 * Bangun blok konteks waktu universal yang dinamis untuk systemPrompt.
 */
export function buildUniversalTimePrompt(
  now: Date = new Date(),
  chatKey: string = '',
  userPrompt: string = '',
  profileOrHistoryText: string = '',
): string {
  const parts: string[] = [];
  const utc = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  parts.push(`[WAKTU & KALENDER GLOBAL (UNIVERSAL REAL-TIME CLOCK)]:`);
  parts.push(`- Waktu Universal Standar: ${utc}`);

  // 1. Deteksi lokasi spesifik yang ditanyakan pengguna di pesan saat ini atau tersimpan di profil/histori
  const promptLoc = detectLocation(userPrompt);
  const profileLoc = detectLocation(profileOrHistoryText);
  const matchedLoc = promptLoc || profileLoc;

  if (matchedLoc) {
    const locTime = formatInZone(now, matchedLoc.zone);
    const sourceLabel = promptLoc
      ? `LOKASI SPESIFIK YANG DITANYAKAN PENGGUNA`
      : `LOKASI TERSIMPAN DARI PROFIL / RIWAYAT PENGGUNA`;
    parts.push(`- ${sourceLabel} (${matchedLoc.label}):`);
    parts.push(`  * Jam & Waktu: ${locTime.time} ${locTime.tzName} (${locTime.full})`);
    parts.push(`  * DIREKTIF: Jawab langsung pertanyaan jam pengguna menggunakan waktu lokasi ${matchedLoc.label} ini secara presisi!`);
  }

  // 2. Deteksi negara asal nomor pengguna (WhatsApp prefix)
  const detectedUserCountry = detectUserCountry(chatKey);
  if (detectedUserCountry) {
    const userTzTime = formatInZone(now, detectedUserCountry.zone);
    parts.push(`- LOKASI ASAL NOMOR PENGGUNA TERDETEKSI: ${detectedUserCountry.note}`);
    parts.push(`  * Waktu di Negara Pengguna: ${userTzTime.time} ${userTzTime.tzName} (${userTzTime.dayName}, ${userTzTime.dateStr})`);
  }

  // 3. Matriks Tiga Zona Waktu Indonesia Lengkap
  const wib = formatInZone(now, 'Asia/Jakarta');
  const wita = formatInZone(now, 'Asia/Makassar');
  const wit = formatInZone(now, 'Asia/Jayapura');
  parts.push(`- WAKTU INDONESIA (3 ZONA RESMI):`);
  parts.push(`  * WIB (Indonesia Barat): ${wib.time} WIB (${wib.dayName}, ${wib.dateStr})`);
  parts.push(`  * WITA (Indonesia Tengah): ${wita.time} WITA`);
  parts.push(`  * WIT (Indonesia Timur): ${wit.time} WIT`);

  // 4. Matriks Kota Acuan Global Utama Dunia
  const tokyo = formatInZone(now, 'Asia/Tokyo');
  const london = formatInZone(now, 'Europe/London');
  const ny = formatInZone(now, 'America/New_York');
  const berlin = formatInZone(now, 'Europe/Berlin');
  const mekkah = formatInZone(now, 'Asia/Riyadh');
  const sydney = formatInZone(now, 'Australia/Sydney');
  parts.push(`- ACUAN KOTA DUNIA LAINNYA SAAT INI:`);
  parts.push(`  * Tokyo: ${tokyo.time} ${tokyo.tzName} | Mekkah: ${mekkah.time} ${mekkah.tzName} | London: ${london.time} ${london.tzName}`);
  parts.push(`  * Berlin/Paris: ${berlin.time} ${berlin.tzName} | New York: ${ny.time} ${ny.tzName} | Sydney: ${sydney.time} ${sydney.tzName}`);

  // 5. Panduan Respon Jam Cerdas & Dinamis
  parts.push(`[PANDUAN MENJAWAB JAM & WAKTU SECARA DINAMIS]:`);
  parts.push(`1. Jika temanmu bertanya jam/waktu di kota/negara/daerah tertentu (misal: "jam berapa di Tokyo/London/Bali/Merauke/Paris/New York"): jawab tepat jam di kota tersebut.`);
  parts.push(`2. Jika temanmu memiliki lokasi tersimpan di profil/riwayat (${profileLoc?.label || 'belum ada'}): jawab langsung menggunakan waktu lokasinya.`);
  parts.push(`3. Jika temanmu bilang dia berada di daerah/negara tertentu (misal: "aku lagi di Bali/Jerman/Makassar, jam berapa sekarang?"): gunakan waktu zona tempat tinggalnya.`);
  parts.push(`4. Jika temanmu memakai nomor luar negeri (${detectedUserCountry?.country || 'non-ID'}): sesuaikan dengan waktu lokal negaranya.`);
  parts.push(`5. ATURAN KETIKA LOKASI PENGGUNA BELUM DIKETAHUI (NOMOR INDONESIA +62):`);
  parts.push(`   - DILARANG menjabarkan daftar pulau/provinsi panjang seperti ensiklopedia/buku pelajaran.`);
  parts.push(`   - Jawablah santai, hangat, dan ringkas (1-2 kalimat saja):`);
  parts.push(`     Contoh: "Sekarang jam ${wib.time.slice(0, 5)} WIB (atau ${wita.time.slice(0, 5)} WITA / ${wit.time.slice(0, 5)} WIT). Kamu lagi di kota mana nih?"`);
  parts.push(`- Kamu menguasai seluruh zona waktu dunia secara presisi tanpa ragu dan tidak pernah menolak pertanyaan jam/waktu.`);

  return parts.join('\n');
}
