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

export interface LocationEntry {
  keywords: string[];
  zone: string;
  label: string;
}

export interface LocationMatch {
  zone: string;
  label: string;
  matchedKeyword?: string;
  keywords?: string[];
}

const LOCATION_MAP: LocationEntry[] = [
  // Indonesian WITA (UTC+8)
  { keywords: ['bali', 'denpasar', 'kuta', 'ubud', 'gianyar', 'sanur', 'badung', 'tabanan', 'singaraja', 'buleleng', 'seminyak', 'canggu', 'jimbaran', 'nusa dua', 'klungkung', 'bangli', 'karangasem', 'jembrana', 'negara bali'], zone: 'Asia/Makassar', label: 'Bali / WITA' },
  { keywords: ['lombok', 'mataram', 'praya', 'selong', 'sumbawa', 'sumbawa besar', 'bima', 'dompu', 'ntb', 'nusa tenggara barat'], zone: 'Asia/Makassar', label: 'NTB / WITA' },
  { keywords: ['kupang', 'labuan bajo', 'flores', 'ende', 'maumere', 'sikka', 'ruteng', 'manggarai', 'bajawa', 'ngada', 'sumba', 'waingapu', 'waikabubak', 'alor', 'kalabahi', 'rote', 'atambua', 'belu', 'timor', 'ntt', 'nusa tenggara timur'], zone: 'Asia/Makassar', label: 'NTT / WITA' },
  { keywords: ['banjarmasin', 'banjarbaru', 'martapura', 'kotabaru', 'barabai', 'kandangan', 'amuntai', 'tanjung kalsel', 'batulicin', 'tanah bumbu', 'pelaihari', 'tanah laut', 'tapin', 'rantau', 'kalsel', 'kalimantan selatan'], zone: 'Asia/Makassar', label: 'Kalimantan Selatan / WITA' },
  { keywords: ['samarinda', 'balikpapan', 'bontang', 'ikn', 'nusantara', 'tenggarong', 'kutai', 'kutai kartanegara', 'berau', 'tanjung redeb', 'sangatta', 'penajam', 'paser', 'tanah grogot', 'kaltim', 'kalimantan timur'], zone: 'Asia/Makassar', label: 'Kalimantan Timur / WITA' },
  { keywords: ['tarakan', 'tanjung selor', 'bulungan', 'nunukan', 'malinau', 'tana tidung', 'kaltara', 'kalimantan utara'], zone: 'Asia/Makassar', label: 'Kalimantan Utara / WITA' },
  { keywords: ['makassar', 'ujung pandang', 'gowa', 'sungguminasa', 'maros', 'bone', 'watampone', 'palopo', 'parepare', 'bulukumba', 'bantaeng', 'jeneponto', 'takalar', 'sinjai', 'barru', 'pangkep', 'pinrang', 'sidrap', 'sidenreng rappang', 'soppeng', 'wajo', 'sengkang', 'tana toraja', 'toraja', 'makale', 'rantepao', 'luwu', 'belopa', 'masamba', 'malili', 'sulsel', 'sulawesi selatan'], zone: 'Asia/Makassar', label: 'Sulawesi Selatan / WITA' },
  { keywords: ['mamuju', 'majene', 'polewali mandar', 'polman', 'mamasa', 'pasangkayu', 'sulbar', 'sulawesi barat'], zone: 'Asia/Makassar', label: 'Sulawesi Barat / WITA' },
  { keywords: ['palu', 'luwuk', 'poso', 'donggala', 'morowali', 'bungku', 'kolonodale', 'parigi', 'toli-toli', 'tolitoli', 'banggai', 'buol', 'sigi', 'sulteng', 'sulawesi tengah'], zone: 'Asia/Makassar', label: 'Sulawesi Tengah / WITA' },
  { keywords: ['kendari', 'bau-bau', 'baubau', 'kolaka', 'konawe', 'unaaha', 'muna', 'raha', 'wakatobi', 'wangi-wangi', 'bombana', 'sultra', 'sulawesi tenggara'], zone: 'Asia/Makassar', label: 'Sulawesi Tenggara / WITA' },
  { keywords: ['manado', 'bitung', 'tomohon', 'kotamobagu', 'minahasa', 'tondano', 'amurang', 'airmadidi', 'sangihe', 'tahuna', 'talaud', 'bolmong', 'sulut', 'sulawesi utara'], zone: 'Asia/Makassar', label: 'Sulawesi Utara / WITA' },
  { keywords: ['gorontalo', 'bone bolango', 'boalemo', 'pohuwato', 'kwandang'], zone: 'Asia/Makassar', label: 'Gorontalo / WITA' },
  { keywords: ['wita', 'waktu indonesia tengah'], zone: 'Asia/Makassar', label: 'WITA (Waktu Indonesia Tengah)' },

  // Indonesian WIT (UTC+9)
  { keywords: ['ambon', 'tual', 'banda', 'banda neira', 'masohi', 'seram', 'buru', 'namlea', 'saumlaki', 'tanimbar', 'aru', 'dobo', 'maluku'], zone: 'Asia/Jayapura', label: 'Maluku / WIT' },
  { keywords: ['ternate', 'tidore', 'sofifi', 'halmahera', 'tobelo', 'jailolo', 'weda', 'labuha', 'morotai', 'sula', 'sanana', 'maluku utara', 'malut'], zone: 'Asia/Jayapura', label: 'Maluku Utara / WIT' },
  { keywords: ['jayapura', 'merauke', 'timika', 'mimika', 'wamena', 'nabire', 'biak', 'serui', 'sarmi', 'sorong', 'manokwari', 'fakfak', 'kaimana', 'raja ampat', 'boven digoel', 'asmat', 'paniai', 'puncak jaya', 'mulia', 'pegunungan bintang', 'oksibil', 'yahukimo', 'tolikara', 'lanny jaya', 'papua', 'papua barat', 'papua barat daya', 'papua tengah', 'papua pegunungan', 'papua selatan'], zone: 'Asia/Jayapura', label: 'Papua / WIT' },
  { keywords: ['wit', 'waktu indonesia timur'], zone: 'Asia/Jayapura', label: 'WIT (Waktu Indonesia Timur)' },

  // Indonesian WIB (UTC+7)
  { keywords: ['jakarta', 'jaksel', 'jakbar', 'jaktim', 'jakpus', 'jakut', 'jabodetabek', 'kepulauan seribu'], zone: 'Asia/Jakarta', label: 'DKI Jakarta / WIB' },
  { keywords: ['bandung', 'cimahi', 'bekasi', 'depok', 'bogor', 'cirebon', 'sukabumi', 'tasikmalaya', 'banjar', 'cianjur', 'garut', 'kuningan', 'majalengka', 'sumedang', 'indramayu', 'subang', 'purwakarta', 'karawang', 'ciamis', 'pangandaran', 'jabar', 'jawa barat', 'soreang', 'ngamprah', 'cikarang', 'cibinong', 'singaparna'], zone: 'Asia/Jakarta', label: 'Jawa Barat / WIB' },
  { keywords: ['serang', 'cilegon', 'tangerang', 'tangsel', 'tangerang selatan', 'lebak', 'pandeglang', 'rangkasbitung', 'banten'], zone: 'Asia/Jakarta', label: 'Banten / WIB' },
  { keywords: ['semarang', 'solo', 'surakarta', 'salatiga', 'magelang', 'pekalongan', 'tegal', 'cilacap', 'banyumas', 'purwokerto', 'brebes', 'kudus', 'jepara', 'pati', 'demak', 'kendal', 'batang', 'pemalang', 'purbalingga', 'banjarnegara', 'kebumen', 'purworejo', 'wonosobo', 'boyolali', 'klaten', 'sukoharjo', 'wonogiri', 'karanganyar', 'sragen', 'grobogan', 'purwodadi', 'blora', 'rembang', 'temanggung', 'jateng', 'jawa tengah', 'bumiayu'], zone: 'Asia/Jakarta', label: 'Jawa Tengah / WIB' },
  { keywords: ['jogja', 'yogyakarta', 'sleman', 'bantul', 'kulon progo', 'wates', 'gunungkidul', 'wonosari', 'diy'], zone: 'Asia/Jakarta', label: 'DI Yogyakarta / WIB' },
  { keywords: ['surabaya', 'malang', 'batu', 'kediri', 'blitar', 'madiun', 'mojokerto', 'pasuruan', 'probolinggo', 'sidoarjo', 'gresik', 'lamongan', 'tuban', 'bojonegoro', 'ngawi', 'magetan', 'ponorogo', 'pacitan', 'trenggalek', 'tulungagung', 'nganjuk', 'jombang', 'lumajang', 'jember', 'bondowoso', 'situbondo', 'banyuwangi', 'bangkalan', 'sampang', 'pamekasan', 'sumenep', 'madura', 'jatim', 'jawa timur', 'kepanjen', 'caruban'], zone: 'Asia/Jakarta', label: 'Jawa Timur / WIB' },
  { keywords: ['aceh', 'banda aceh', 'sabang', 'lhokseumawe', 'langsa', 'subulussalam', 'meulaboh', 'bireuen', 'sigli', 'takengon', 'kutacane', 'tapaktuan', 'sinabang', 'calang', 'jantho', 'idi rayeuk'], zone: 'Asia/Jakarta', label: 'Aceh / WIB' },
  { keywords: ['medan', 'binjai', 'tebing tinggi', 'pematangsiantar', 'siantar', 'tanjungbalai', 'sibolga', 'padangsidimpuan', 'gunungsitoli', 'nias', 'karo', 'kabanjahe', 'simalungun', 'toba', 'balige', 'dairi', 'sidikalang', 'samosir', 'deli serdang', 'asahan', 'kisaran', 'labuhanbatu', 'rantau prapat', 'langkat', 'stabat', 'sumut', 'sumatera utara'], zone: 'Asia/Jakarta', label: 'Sumatera Utara / WIB' },
  { keywords: ['padang', 'bukittinggi', 'pariaman', 'payakumbuh', 'padang panjang', 'solok', 'sawahlunto', 'agam', 'lubuk basung', 'mentawai', 'tanah datar', 'batusangkar', 'pesisir selatan', 'painan', 'pasaman', 'dharmasraya', 'sijunjung', 'sumbar', 'sumatera barat'], zone: 'Asia/Jakarta', label: 'Sumatera Barat / WIB' },
  { keywords: ['pekanbaru', 'dumai', 'bengkalis', 'duri', 'indragiri', 'tembilahan', 'rengat', 'kampar', 'bangkinang', 'meranti', 'selatpanjang', 'kuantan singingi', 'pelalawan', 'rokan', 'bagansiapiapi', 'pasir pengaraian', 'siak', 'riau'], zone: 'Asia/Jakarta', label: 'Riau / WIB' },
  { keywords: ['batam', 'tanjungpinang', 'bintan', 'karimun', 'tanjung balai karimun', 'natuna', 'ranai', 'anambas', 'tarempa', 'lingga', 'kepri', 'kepulauan riau'], zone: 'Asia/Jakarta', label: 'Kepulauan Riau / WIB' },
  { keywords: ['jambi', 'sungai penuh', 'kerinci', 'bungo', 'muara bungo', 'merangin', 'bangko', 'sarolangun', 'tebo', 'muaro jambi', 'batanghari'], zone: 'Asia/Jakarta', label: 'Jambi / WIB' },
  { keywords: ['bengkulu', 'curup', 'rejang lebong', 'mukomuko', 'kaur', 'manna', 'kepahiang', 'lebong', 'seluma'], zone: 'Asia/Jakarta', label: 'Bengkulu / WIB' },
  { keywords: ['palembang', 'lubuklinggau', 'prabumulih', 'pagar alam', 'lahat', 'banyuasin', 'muara enim', 'sekayu', 'musi banyuasin', 'musi rawas', 'ogan ilir', 'indralaya', 'oki', 'kayuagung', 'oku', 'baturaja', 'sumsel', 'sumatera selatan'], zone: 'Asia/Jakarta', label: 'Sumatera Selatan / WIB' },
  { keywords: ['pangkalpinang', 'bangka belitung', 'pulau bangka', 'sungailiat', 'belitung', 'tanjung pandan', 'mentok', 'toboali', 'koba', 'manggar', 'babel'], zone: 'Asia/Jakarta', label: 'Bangka Belitung / WIB' },
  { keywords: ['lampung', 'bandar lampung', 'metro', 'kalianda', 'lampung selatan', 'gunung sugih', 'lampung tengah', 'kotabumi', 'pringsewu', 'tanggamus', 'kota agung', 'tulang bawang', 'menggala', 'way kanan'], zone: 'Asia/Jakarta', label: 'Lampung / WIB' },
  { keywords: ['pontianak', 'singkawang', 'sambas', 'ketapang', 'sintang', 'sanggau', 'bengkayang', 'kubu raya', 'landak', 'ngabang', 'melawi', 'sekadau', 'kapuas hulu', 'putussibau', 'kalbar', 'kalimantan barat'], zone: 'Asia/Jakarta', label: 'Kalimantan Barat / WIB' },
  { keywords: ['palangkaraya', 'palangka raya', 'sampit', 'pangkalan bun', 'kotawaringin', 'kapuas kalteng', 'kuala kapuas', 'barito', 'muara teweh', 'buntok', 'katingan', 'kasongan', 'seruyan', 'lamandau', 'kalteng', 'kalimantan tengah'], zone: 'Asia/Jakarta', label: 'Kalimantan Tengah / WIB' },
  { keywords: ['wib', 'utc+7', 'gmt+7'], zone: 'Asia/Jakarta', label: 'WIB (Waktu Indonesia Barat)' },

  // Asia & Oceania
  { keywords: ['tokyo', 'kyoto', 'osaka', 'yokohama', 'nagoya', 'sapporo', 'fukuoka', 'jepang', 'japan', 'jst'], zone: 'Asia/Tokyo', label: 'Jepang (Tokyo)' },
  { keywords: ['seoul', 'busan', 'incheon', 'korea', 'korea selatan', 'south korea', 'kst'], zone: 'Asia/Seoul', label: 'Korea Selatan (Seoul)' },
  { keywords: ['beijing', 'shanghai', 'guangzhou', 'shenzhen', 'china', 'tiongkok'], zone: 'Asia/Shanghai', label: 'China (Beijing/Shanghai)' },
  { keywords: ['taipei', 'taiwan'], zone: 'Asia/Taipei', label: 'Taiwan (Taipei)' },
  { keywords: ['hong kong', 'hongkong', 'hkt'], zone: 'Asia/Hong_Kong', label: 'Hong Kong' },
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
  { keywords: ['los angeles', 'san francisco', 'seattle', 'san diego', 'las vegas', 'california', 'portland', 'pst', 'pdt', 'us pacific'], zone: 'America/Los_Angeles', label: 'AS Pacific (Los Angeles)' },
  { keywords: ['honolulu', 'hawaii', 'hst'], zone: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
  { keywords: ['anchorage', 'alaska', 'akst', 'akdt'], zone: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { keywords: ['toronto', 'ottawa', 'montreal', 'quebec', 'kanada', 'canada'], zone: 'America/Toronto', label: 'Kanada (Toronto)' },
  { keywords: ['vancouver', 'calgary'], zone: 'America/Vancouver', label: 'Kanada (Vancouver)' },
  { keywords: ['mexico city', 'guadalajara', 'monterrey', 'meksiko', 'mexico'], zone: 'America/Mexico_City', label: 'Meksiko (Mexico City)' },
  { keywords: ['sao paulo', 'rio de janeiro', 'brasilia', 'brasil', 'brazil'], zone: 'America/Sao_Paulo', label: 'Brasil (Sao Paulo)' },
  { keywords: ['buenos aires', 'argentina'], zone: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
  { keywords: ['bogota', 'kolombia', 'colombia'], zone: 'America/Bogota', label: 'Kolombia (Bogota)' },
  { keywords: ['santiago', 'chili', 'chile'], zone: 'America/Santiago', label: 'Chili (Santiago)' },
  { keywords: ['lima', 'peru'], zone: 'America/Lima', label: 'Peru (Lima)' },

  // Africa
  { keywords: ['kairo', 'cairo', 'mesir', 'egypt'], zone: 'Africa/Cairo', label: 'Mesir (Kairo)' },
  { keywords: ['johannesburg', 'cape town', 'pretoria', 'afrika selatan', 'south africa'], zone: 'Africa/Johannesburg', label: 'Afrika Selatan (Johannesburg)' },
  { keywords: ['lagos', 'abuja', 'nigeria'], zone: 'Africa/Lagos', label: 'Nigeria (Lagos)' },
  { keywords: ['nairobi', 'kenya'], zone: 'Africa/Nairobi', label: 'Kenya (Nairobi)' },
  { keywords: ['casablanca', 'rabat', 'maroko', 'morocco'], zone: 'Africa/Casablanca', label: 'Maroko (Casablanca)' },
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Precompile regex untuk menghindari kompilasi ~400 RegExp pada setiap pesan masuk
const COMPILED_LOCATION_MAP = LOCATION_MAP.map((item) => ({
  ...item,
  compiled: item.keywords.map((kw) => {
    const escaped = escapeRegex(kw).replace(/\s+/g, '\\s+');
    const leftBoundary = /^\w/.test(kw) ? '\\b' : '(?:^|\\s|[.,!?;:])';
    const rightBoundary = /\w$/.test(kw) ? '\\b' : '(?:$|\\s|[.,!?;:])';
    return {
      kw,
      reg: new RegExp(`${leftBoundary}${escaped}${rightBoundary}`, 'i'),
    };
  }),
}));

export function detectLocation(text?: string): LocationMatch | null {
  if (!text || typeof text !== 'string') return null;
  // Bersihkan identifier zona waktu IANA agar substring tidak memicu false-positive
  const q = text.toLowerCase().replace(/asia\/(?:jakarta|makassar|jayapura|tokyo|seoul|singapore|bangkok)/gi, '');
  for (const item of COMPILED_LOCATION_MAP) {
    for (const { kw, reg } of item.compiled) {
      if (reg.test(q)) {
        return { keywords: item.keywords, zone: item.zone, label: item.label, matchedKeyword: kw };
      }
    }
  }
  return null;
}

/**
 * Periksa apakah user sedang bertanya tentang waktu/jam/kalender/jadwal
 * Qualifier kata tanya diwajibkan agar tidak false trigger pada kalimat umum yang memuat kata 'jam' atau 'waktu'.
 */
export function isAskingTime(text?: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const q = text.toLowerCase().trim();
  if (/\b(jam|pukul|waktu)\s+(berapa|brp|skrg|sekarang|saat ini)\b/i.test(q)) return true;
  if (/\b(hari|tanggal)\s+(apa|berapa|brp)\s*(sekarang|skrg|ini)?\b/i.test(q)) return true;
  if (/\b(sekarang|saat ini|hari ini)\s+(jam|pukul|tanggal|hari apa)\b/i.test(q)) return true;
  if (/\b(jam|pukul)\s+berapa\?/i.test(q) || /\bjam\s*\?/i.test(q)) return true;
  if (/\b(what time is it|current time|what day is today|what date is today)\b/i.test(q)) return true;
  return false;
}

/**
 * Periksa apakah user sedang menyatakan lokasi tempat tinggal / keberadaan dirinya
 * Pola: saya di cianjur, aku di bali, lagi di surabaya, tinggal di jepang, cianjur, dll.
 */
export function detectUserLocationDeclaration(text?: string): LocationMatch | null {
  if (!text || typeof text !== 'string') return null;
  const q = text.toLowerCase().trim();

  // Abaikan ekspresi/idiom yang bukan deklarasi lokasi tempat (misal: "tua bangka", "si bangka")
  if (/\b(?:tua\s+bangka|si\s+bangka)\b/i.test(q)) return null;

  // Jika pesan adalah pertanyaan waktu (misal "jam berapa di tokyo"), BUKAN deklarasi lokasi diri
  if (isAskingTime(q)) {
    const selfMatch = q.match(/\b(?:saya|aku|gua|gw|posisi|tinggal|rumah|domisili|lagi|sedang)\s*(?:di|daerah)\s+([a-z\s]+)/i);
    if (selfMatch) {
      return detectLocation(selfMatch[1]);
    }
    return null;
  }

  // Cek pola kalimat penanda lokasi diri (wajib diikuti preposisi tempat: di, ke, daerah, tinggal di, posisi di, berada di)
  const selfMatch = q.match(/\b(?:saya|aku|gua|gw|kami|posisi|tinggal|rumah|domisili|lagi|sedang|berada|dari)\s+(?:di|ke|daerah|tinggal di|posisi di|berada di)\s+([a-z\s]+)/i);
  if (selfMatch) {
    const matched = detectLocation(selfMatch[1]);
    if (matched) return matched;
  }

  // Jika user menjawab dengan jawaban sangat pendek (misal menjawab "cianjur", "di cianjur", atau "bali")
  const words = q.split(/\s+/);
  if (words.length <= 3 && !/\b(?:apa|gimana|kenapa|siapa|tua|bangka)\b/i.test(q)) {
    const matched = detectLocation(q);
    if (matched) return matched;
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
  if (offsetHours === 0) {
    return { zone: 'UTC', label: 'UTC' };
  }
  const clampedOffset = Math.max(-12, Math.min(14, offsetHours));
  // Standar IANA POSIX Etc/GMT: tanda terbalik (Etc/GMT-8 = UTC+8, Etc/GMT+5 = UTC-5)
  const gmtSign = clampedOffset > 0 ? `-${clampedOffset}` : `+${Math.abs(clampedOffset)}`;
  const labelSign = clampedOffset > 0 ? `+${clampedOffset}` : `${clampedOffset}`;
  return { zone: `Etc/GMT${gmtSign}`, label: `UTC${labelSign}` };
}

/**
 * Membangun prompt waktu universal yang sadar konteks geografis pengguna:
 * - Waktu Server (UTC & WIB)
 * - Waktu Pengiriman Asli Pesan Pengguna (jika tersedia)
 * - Waktu di lokasi/kota spesifik yang ditanyakan pengguna di chat
 * - Waktu di lokasi pengguna yang tersimpan di memori/profil
 * - 3 Zona Waktu Indonesia (WIB, WITA, WIT) jika pengguna +62 belum punya profil lokasi
 */
export function buildUniversalTimePrompt(
  now: Date = new Date(),
  chatKey: string = '',
  userPrompt: string = '',
  profileOrHistoryText: string = '',
  msgSentAt?: Date | null,
): string {
  const parts: string[] = [];
  const utc = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const wib = formatInZone(now, 'Asia/Jakarta');
  const wita = formatInZone(now, 'Asia/Makassar');
  const wit = formatInZone(now, 'Asia/Jayapura');

  const promptLoc = detectLocation(userPrompt);
  const profileLoc = detectLocation(profileOrHistoryText);
  const userDeclaringLoc = detectUserLocationDeclaration(userPrompt);
  const askingTime = isAskingTime(userPrompt);
  // Hanya WhatsApp yang chat key-nya memuat nomor telepon asli (wa_<jid>).
  // ID numerik Telegram BUKAN nomor telepon — ID seperti "1073..." jangan sampai
  // dibaca sebagai kode negara +1 (AS/Kanada) yang membuat zona waktu salah.
  const detectedUserCountry = /^wa[_:]/i.test(chatKey) ? detectUserCountry(chatKey) : null;

  const targetZone = profileLoc?.zone || detectedUserCountry?.zone || 'Asia/Jakarta';
  const sentTime = msgSentAt instanceof Date && !isNaN(msgSentAt.getTime()) ? formatInZone(msgSentAt, targetZone) : null;

  // KASUS 1: PENGGUNA TIDAK BERTANYA JAM DAN TIDAK MENYATAKAN LOKASI
  // Berikan info waktu server & waktu kirim secara pasif (hanya latar belakang).
  // Larang keras bot mengungkit waktu atau menanyakan kota pengguna!
  if (!askingTime && !userDeclaringLoc) {
    parts.push(`[WAKTU & KALENDER SISTEM (BACKGROUND CONTEXT)]:`);
    parts.push(`- Waktu Server Saat Ini: ${wib.dayName}, ${wib.dateStr} ${wib.time} WIB (UTC+7)`);
    if (sentTime) {
      parts.push(`- Waktu Pengiriman Pesan Ini oleh Pengguna: ${sentTime.dayName}, ${sentTime.dateStr} ${sentTime.time.slice(0, 5)} ${sentTime.tzName}`);
    }
    if (profileLoc) {
      parts.push(`- Lokasi Pengguna Tersimpan: ${profileLoc.label} (Zona: ${profileLoc.zone})`);
    } else if (detectedUserCountry) {
      parts.push(`- Negara Pengguna: ${detectedUserCountry.country} (${detectedUserCountry.note})`);
    }
    parts.push(`[DIREKTIF MUTLAK KOMUNIKASI]:`);
    parts.push(`- Teman bicaramu TIDAK sedang bertanya tentang jam, waktu, atau jadwal!`);
    parts.push(`- DILARANG KERAS membuka jawaban dengan menyebutkan jam saat ini atau mengomentari jam kirim pesan (dilarang latah "tumben kirim jam sekian")!`);
    parts.push(`- DILARANG KERAS basa-basi meminta maaf soal delay jaringan atau antrean server!`);
    parts.push(`- DILARANG KERAS menanyakan lokasi, tempat tinggal, atau kota pengguna karena sama sekali tidak relevan dengan topik obrolan!`);
    parts.push(`- Tanggapi HANYA pesan dan topik yang sedang dibahas oleh temanmu secara natural, hangat, dan mengalir!`);
    return parts.join('\n');
  }

  // KASUS 2: PENGGUNA BARU SAJA MENYATAKAN / MENGONFIRMASI LOKASINYA (misal: "saya di cianjur", "lagi di bali")
  if (userDeclaringLoc) {
    const locTime = formatInZone(now, userDeclaringLoc.zone);
    const specificCity = userDeclaringLoc.matchedKeyword ? (userDeclaringLoc.matchedKeyword.charAt(0).toUpperCase() + userDeclaringLoc.matchedKeyword.slice(1)) : '';
    const displayLocation = specificCity ? `${specificCity} (${userDeclaringLoc.label})` : userDeclaringLoc.label;
    parts.push(`[PENGGUNA MENGONFIRMASI LOKASI KEBERADAANNYA]:`);
    parts.push(`- Lokasi Pengguna: ${displayLocation} (Zona Waktu: ${userDeclaringLoc.zone})`);
    parts.push(`- Jam Saat Ini di ${displayLocation}: ${locTime.time.slice(0, 5)} ${locTime.tzName} (${locTime.dayName}, ${locTime.dateStr})`);
    parts.push(`[DIREKTIF MENJAWAB KONFIRMASI LOKASI]:`);
    parts.push(`- Temanmu memberitahukan bahwa dia berada di ${displayLocation}.`);
    parts.push(`- Jawab singkat, hangat, to-the-point mengakui lokasinya dan sebutkan waktu di kotanya secara presisi (${locTime.time.slice(0, 5)} ${locTime.tzName} di ${specificCity || userDeclaringLoc.label}). Gunakan gayamu sendiri secara variatif tanpa kalimat template hafalan.`);
    parts.push(`- DILARANG SALAH ZONA: Pastikan zona waktunya sesuai data resmi di atas (${userDeclaringLoc.label} adalah ${locTime.tzName})! DILARANG menyebut WITA jika lokasinya di Jawa/Sumatera (WIB), dan DILARANG menyebut WIB jika lokasinya di Bali/Sulawesi (WITA)!`);
    parts.push(`- DILARANG MENANYAKAN KOTA LAGI: Lokasi ini sudah otomatis tersimpan ke memori sistem, DILARANG menanyakan kembali kotanya ke depannya!`);
    parts.push(`- DILARANG KERAS MENAMBAHKAN FILLER BASA-BASI SOK AKRAB: DILARANG KERAS menempelkan celetukan penutup klise seperti "santai aja terus bro", "santai aja bro", "santuy aja dulu", "semangat terus ya", dsb! Jawaban selesai di situ to-the-point tanpa embel-embel tidak perlu.`);
    return parts.join('\n');
  }

  // KASUS 3: PENGGUNA BERTANYA TENTANG JAM / WAKTU (askingTime = true)
  parts.push(`[WAKTU & KALENDER GLOBAL (UNIVERSAL REAL-TIME CLOCK)]:`);
  parts.push(`- Waktu Universal Standar: ${utc}`);

  // 3a. Pengguna menanyakan jam berapa dia mengirim pesan atau kapan pesan masuk
  if (/\b(?:kirim|terkirim|dikirim|ngechat|pesan\s*ini|chat\s*ini)\b/i.test(userPrompt) && sentTime) {
    parts.push(`- PERTANYAAN KHUSUS WAKTU PENGIRIMAN PESAN: Temanmu menanyakan jam berapa dia mengirim pesan.`);
    parts.push(`  * Jam Pengiriman Asli Pengguna: ${sentTime.time.slice(0, 5)} ${sentTime.tzName} (${sentTime.dayName}, ${sentTime.dateStr})`);
    parts.push(`  * Jam Server AI Memproses: ${wib.time.slice(0, 5)} WIB`);
    parts.push(`  * DIREKTIF: Jawab langsung to-the-point bahwa pesannya terkirim pada jam ${sentTime.time.slice(0, 5)} ${sentTime.tzName} secara santai, ramah, dan bersahabat tanpa kalimat template hafalan.`);
    return parts.join('\n');
  }

  // 3b. Pengguna menanyakan jam kota/negara spesifik di pesannya (misal "jam berapa di Tokyo/London/Bali")
  if (promptLoc) {
    const locTime = formatInZone(now, promptLoc.zone);
    parts.push(`- LOKASI SPESIFIK YANG DITANYAKAN: ${promptLoc.label}`);
    parts.push(`  * Jam & Waktu: ${locTime.time.slice(0, 5)} ${locTime.tzName} (${locTime.full})`);
    parts.push(`  * DIREKTIF: Jawab langsung jam di ${promptLoc.label} saat ini secara presisi!`);
    return parts.join('\n');
  }

  // 3b. Pengguna bertanya "jam berapa sekarang?" dan lokasinya sudah tersimpan di profil/riwayat
  if (profileLoc) {
    const locTime = formatInZone(now, profileLoc.zone);
    const specificCity = profileLoc.matchedKeyword ? (profileLoc.matchedKeyword.charAt(0).toUpperCase() + profileLoc.matchedKeyword.slice(1)) : '';
    const displayCity = specificCity ? `${specificCity}` : profileLoc.label;
    parts.push(`- LOKASI PENGGUNA TERSIMPAN DI MEMORI: ${profileLoc.label}${specificCity ? ` (Kota: ${specificCity})` : ''}`);
    parts.push(`  * Jam di Lokasi Pengguna: ${locTime.time.slice(0, 5)} ${locTime.tzName} (${locTime.full})`);
    parts.push(`  * DIREKTIF: Temanmu bertanya jam sekarang. Karena kamu sudah tahu dia di ${displayCity}, sampaikan langsung waktu saat ini (${locTime.time.slice(0, 5)} ${locTime.tzName} di ${displayCity}) secara to-the-point dan santai tanpa kalimat hafalan.`);
    parts.push(`  * DILARANG menanyakan kembali dia berada di kota mana karena kamu sudah tahu dan mengingat lokasinya!`);
    parts.push(`  * DILARANG KERAS menambahkan celetukan penutup filler seperti "santai aja terus bro" atau semacamnya! Cukup sampaikan waktu to-the-point dan selesai.`);
    return parts.join('\n');
  }

  // 3c. Pengguna nomor luar negeri
  if (detectedUserCountry && detectedUserCountry.country !== 'Indonesia') {
    const userTzTime = formatInZone(now, detectedUserCountry.zone);
    parts.push(`- LOKASI ASAL NOMOR PENGGUNA: ${detectedUserCountry.country} (${detectedUserCountry.note})`);
    parts.push(`  * Waktu di Negara Pengguna: ${userTzTime.time.slice(0, 5)} ${userTzTime.tzName}`);
    parts.push(`  * DIREKTIF: Jawab sesuai waktu di negara asal nomor pengguna (${userTzTime.time.slice(0, 5)} ${userTzTime.tzName}).`);
    return parts.join('\n');
  }

  // 3d. Pengguna nomor Indonesia (+62) bertanya jam sekarang tapi lokasinya belum diketahui sama sekali
  parts.push(`- WAKTU INDONESIA (3 ZONA RESMI):`);
  parts.push(`  * WIB: ${wib.time.slice(0, 5)} WIB (${wib.dayName}, ${wib.dateStr})`);
  parts.push(`  * WITA: ${wita.time.slice(0, 5)} WITA`);
  parts.push(`  * WIT: ${wit.time.slice(0, 5)} WIT`);
  parts.push(`[DIREKTIF MENJAWAB KARENA LOKASI BELUM DIKETAHUI]:`);
  parts.push(`- Sampaikan waktu santai dan ringkas (1-2 kalimat saja) menyebutkan jam saat ini (${wib.time.slice(0, 5)} WIB, ${wita.time.slice(0, 5)} WITA, atau ${wit.time.slice(0, 5)} WIT), lalu tanyakan secara wajar dia sedang berada di daerah/kota mana.`);
  parts.push(`- DILARANG kalimat template hafalan dan DILARANG menjabarkan daftar pulau/provinsi panjang seperti buku pelajaran.`);

  return parts.join('\n');
}
