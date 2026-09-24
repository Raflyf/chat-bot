#!/usr/bin/env python3
"""
Tulis ulang manifest stiker dari pelabelan MANUAL (bukan model API).

Kenapa manual: pelabelan vision otomatis menghasilkan label yang sering SALAH
karena hanya membaca ekspresi wajah, bukan makna teks di stiker. Contoh nyata
dari manifest lama: stk_007 (adegan orang dimarahi atasan) dilabeli "😂" —
padahal maknanya kena tegur/tegang, bukan tawa. Akibatnya bot mengirim stiker
tertawa saat user sedang tegang.

Pelabelan di sini dibaca langsung dari teks + konsep tiap stiker (montase
scratch/_sheets/sheet_01..09.jpg), satu per satu.

Struktur data per stiker:
  no    : nomor global (1..221) -> stk_<no>.webp
  emoji : emoji utama (kunci manifest, dipakai model lewat tag [[sticker:<emoji>]])
  teks  : tulisan di stiker ('' bila tidak ada)
  pakai : kapan stiker ini pantas dikirim

Jalankan:
    python scripts/build_sticker_manifest.py            # tulis manifest + JSON
    python scripts/build_sticker_manifest.py --check     # hanya lapor
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "src", "sticker-manifest.ts")
LABELS_JSON = os.path.join(ROOT, "scratch", "_sticker_labels_manual.json")

# nomor -> (emoji, teks, konteks pemakaian)
LABELS: dict[int, tuple[str, str, str]] = {
    1:  ("🤫", "", "minta rahasia / jangan bilang siapa-siapa"),
    2:  ("🥺", "", "sok polos / tidak mengerti"),
    3:  ("😔", "", "kesepian / capek sendirian"),
    4:  ("🤯", "", "panik / kesal berat"),
    5:  ("😜", "wleowleowleo", "ngejek bercanda"),
    6:  ("🖕", "Pakyu", "umpatan marah/bercanda"),
    7:  ("😬", "", "kena tegur / situasi tegang"),
    8:  ("😈", "mwehehehe", "ketawa jahat / ledek"),
    9:  ("🐷", "BABI", "umpatan bercanda"),
    10: ("😒", "gw dah muak", "muak / kesal"),
    11: ("😩", "MALAS", "mager / tidak mau bergerak"),
    12: ("😿", "sniff sniff", "menahan nangis / sedih"),
    13: ("😂", "LU DONGO APA GIMANA", "ngejek kebodohan bercanda"),
    14: ("🧠", "Akal Dipake", "sindiran supaya berpikir"),
    15: ("🆗", "ok", "pasrah / ya sudah"),
    16: ("👌", "Kolay", "bilang gampang / tenang"),
    17: ("😭", "WHEN YAH JAGO NGEDIT", "memuji / menyindir hasil edit"),
    18: ("😏", "JANGAN LUPA MALAM INI YA", "mengingatkan janji"),
    19: ("😎", "MIMIK TUTU", "santai / cuek"),
    20: ("😔", "GAGAL BOOYAH", "kalah main game"),
    21: ("🧘", "SABARAHA", "menyuruh sabar"),
    22: ("🎮", "INFOKAN PERMABARAN", "ajak / info mabar"),
    23: ("🔔", "CEK NOTIP", "suruh cek notifikasi"),
    24: ("🤪", "Aku: UTIWI", "respon random / lucu"),
    25: ("👍", "SECARA HARFIAH IYA", "menegaskan iya"),
    26: ("🍜", "NGAPAIN INJR MENDING MASAK SARIMI", "alihkan topik ke aktivitas receh"),
    27: ("⭐", "MENAMBAHKAN KE FAVORIT", "menyimpan sesuatu yang lucu/penting"),
    28: ("🙄", "NYAWIT NI ORANG", "sindiran kesal pada kelakuan orang"),
    29: ("😭", "", "sedih berlebihan / drama"),
    30: ("👎", "BODOH AMAT", "menghina kecerdasan bercanda"),
    31: ("🤨", "GAK MANUK AKAL", "sesuatu absurd / tidak logis"),
    32: ("🤥", "MENCIUM BAU KEBOHONGAN", "tahu sedang dibohongi"),
    33: ("🚶", "GW NGIKUT LU AJA", "pasrah / ikut saja"),
    34: ("😈", "xixixixii", "tawa licik / rencana jahil"),
    35: ("🤯", "Pusing aku mah da ku kalian", "pusing menghadapi orang lain"),
    36: ("😒", "Wahh Seru Nih", "sarkasme pura-pura antusias"),
    37: ("😾", "LIHAT WAJAHKU AKU SUDAH MUAK", "kesal / muak"),
    38: ("🙈", "PURA-PURA GAK LIAT", "sengaja mengabaikan"),
    39: ("🤭", "", "menahan tawa / tidak boleh bicara"),
    40: ("🙉", "", "tidak mau dengar / denial"),
    41: ("🙏", "Assalamualaikum", "salam pembuka"),
    42: ("🏃", "", "ngacir / kabur"),
    43: ("😈", "xixixixii", "tawa licik (duplikat 34)"),
    44: ("🐱", "", "bertahan / terjepit dalam situasi sulit"),
    45: ("🚗", "otw", "sedang dalam perjalanan"),
    46: ("🙅", "OGAH", "menolak dengan tegas"),
    47: ("🥺", "", "gemas / sayang / peluk"),
    48: ("🙂", "tersenyum dengan elegan", "menahan kesal tapi tetap sopan"),
    49: ("😴", "", "santai / tidur / tidak peduli"),
    50: ("🤝", "SEPAKAT", "menyatakan setuju"),
    51: ("⬜", "", "placeholder / tanpa reaksi"),
    52: ("🙏", "SALIM", "menghormati orang lebih tua"),
    53: ("🚫", "NO BUKTI = HOAX", "sindiran klaim tanpa bukti"),
    54: ("😮", "Wawww", "kagum / terkesan"),
    55: ("🐶", "", "santai / rebahan / malas gerak"),
    56: ("😿", "", "pilu / minta kasihan"),
    57: ("😭", "", "menangis histeris / tantrum"),
    58: ("🤨", "", "tatapan curiga"),
    59: ("🤷", "", "terserah / bodo amat"),
    60: ("🐱", "", "bingung / menghakimi"),
    61: ("😴", "AING MAH CAPE, PENGEN SARE", "keluhan lelah (Sunda)"),
    62: ("😏", "IRI GUABOS", "sindiran untuk orang iri"),
    63: ("😁", "", "senyum tidak tulus / sinis"),
    64: ("🙏", "MAAF BARU BANGUN", "telat membalas karena baru bangun"),
    65: ("🤨", "YANG BENER?", "tidak percaya"),
    66: ("💡", "Terus terang", "berkata jujur"),
    67: ("🐱", "", "tatapan serius / ada apa"),
    68: ("😧", "WADUH", "kaget / mengeluh"),
    69: ("😫", "", "stres / kewalahan"),
    70: ("😴", "", "tidur pulas / jangan diganggu"),
    71: ("🐱", "", "menggemaskan"),
    72: ("❄️", "", "tema kakak-adik / perempuan"),
    73: ("🙏", "", "memohon / minta ampun"),
    74: ("🏃", "", "kabur / menghindar"),
    75: ("😡", "", "marah besar"),
    76: ("😤", "sialan", "kesal / umpatan lucu"),
    77: ("😂", "GELAK TAWA", "tertawa terbahak-bahak"),
    78: ("💪", "Secara mental aku hancur, secara fisik aku hitam", "self-roast humor gelap"),
    79: ("🐶", "", "side-eye / aku tahu tapi diam"),
    80: ("🐱", "", "geli / curiga / menahan komentar"),
    81: ("😂", "", "ketawa ngakak sampai blur"),
    82: ("🥱", "Besok aja", "menunda pekerjaan"),
    83: ("🙏", "", "memohon / pasrah"),
    84: ("🎓", "Hai guys", "stiker wisuda / menyapa"),
    85: ("🎓", "Lala Komala Ratnasari", "stiker wisuda custom"),
    86: ("🚗", "OTW", "sedang berangkat"),
    87: ("📍", "Info lokasi", "minta / bagikan lokasi"),
    88: ("😱", "", "kaget / panik / tidak percaya"),
    89: ("🥺", "Aww atut", "gemas / takut versi lucu"),
    90: ("🙏", "maaf belum bisa", "menolak dengan sopan"),
    91: ("🚀", "MELUNCUR", "pamit / berangkat"),
    92: ("🚀", "MELUNCUR", "pamit / berangkat (duplikat 91)"),
    93: ("✋", "Chotto Matte", "minta tunggu sebentar"),
    94: ("🍳", "Let Him Kuk", "dukung orang yang sedang unjuk kemampuan"),
    95: ("😼", "", "kucing ngomel / kesal"),
    96: ("👍", "", "setuju / good job"),
    97: ("😐", "", "datar / tidak peduli"),
    98: ("😤", "SABAR GW MH", "menahan emosi"),
    99: ("🫡", "XIAP", "siap laksanakan"),
    100: ("🐱", "", "siap / siaga (versi tanpa teks)"),
    101: ("🧒", "", "santai / polos / bodo amat"),
    102: ("🐶", "CUKUP TAU SELEBIHNYA GATAU", "tidak mau tahu lebih jauh"),
    103: ("🐱", "", "binguing / situasi chaos"),
    104: ("🐷", "BABI", "umpatan bercanda (duplikat 9)"),
    105: ("🤠", "", "kagum / terpukau"),
    106: ("🤠", "", "terkejut melihat sesuatu"),
    107: ("🖐️", "Ga dlu", "menolak halus"),
    108: ("🧒", "", "polos / tidak paham"),
    109: ("🤫", "jaga bicaramu tuaa", "peringatan bercanda"),
    110: ("🐟", "JANGAN NGOTOT!", "jangan memaksa pendapat"),
    111: ("📱", "SINI KU PIRALKAN", "menawarkan versi bajakan (bercanda)"),
    112: ("🐌", "DASAR TUMAN", "umpatan ke orang manja"),
    113: ("🧠", "ADA OTAQ GA", "menghina tidak pakai otak"),
    114: ("👀", "MATAKU TERNODAI", "melihat hal cringe/menjijikkan"),
    115: ("🤝", "SAMA SAMA", "membalas terima kasih"),
    116: ("💔", "kta unpren ajalh", "ancaman unfriend bercanda"),
    117: ("🤬", "DASAR TOLOL", "umpatan kesal"),
    118: ("😒", "APASI GA GUNA", "menanggapi sesuatu tidak berguna"),
    119: ("🚿", "SINI MANDI DULU", "menyuruh mandi (bercanda)"),
    120: ("🔍", "KALO NGOMONG YANG JELAS", "minta bicara jelas"),
    121: ("😒", "OGAH GAK MOOD", "menolak karena tidak mood"),
    122: ("😂", "MANAA TAHAAANNN", "tidak tahan (tertawa/tergoda)"),
    123: ("😯", "OWH", "oh begitu / sadar"),
    124: ("📝", "CATAT GUYS", "menyuruh mencatat info penting"),
    125: ("🤬", "dasar Anak Bangsad", "umpatan marah"),
    126: ("😡", "BACOT KAU BABI", "menyuruh diam karena omongannya menyebalkan"),
    127: ("🏃", "LARI DARI KENYATAANNNN", "menyindir orang denial"),
    128: ("🤨", "EH, LUU SIAPAAAA?", "meremehkan orang sok akrab"),
    129: ("😤", "mrah trus ky sapi qurban", "sindiran orang gampang marah"),
    130: ("🙄", "APA AKU PEDULI", "acuh tak acuh"),
    131: ("🤔", "tidakkah kau gunakan otakmu untuk berfikir?", "menyindir supaya berpikir"),
    132: ("🙄", "TERSERAH GUA CAK PEDULI", "pasrah / apatis"),
    133: ("😏", "SUDAH SAATNYA", "waktunya bertindak (bercanda)"),
    134: ("💸", "DUIT GUE TINGGAL SEGINI", "mengeluh bokek"),
    135: ("🙏", "MAAPIN YA", "minta maaf (sering sarkastis)"),
    136: ("🤥", "TAPI BOONG", "just kidding"),
    137: ("😳", "", "gemas / terpana / malu"),
    138: ("🐱", "", "lucu / blep"),
    139: ("👶", "", "kaget / tidak percaya"),
    140: ("🤨", "", "curiga / tidak percaya"),
    141: ("🛁", "sedang memandang kebodohan mu yang luar biasa", "menghakimi kebodohan (sarkas)"),
    142: ("🗣️", "AH NGOMONG DOANG LU KAGAA ADA AKSI", "menyindir orang cuma bisa bicara"),
    143: ("😈", "SEDANG MEMPERBAIKI DIRI AGAR LEBIH JAHAT LAGI", "lelucon self-improvement gelap"),
    144: ("📄", "MANA BUKTINYAAAA?", "menantang menunjukkan bukti"),
    145: ("😢", "", "sedih / terharu / simpati"),
    146: ("😜", "", "nakal / iseng"),
    147: ("😲", "AH LU", "kesal / capek menghadapi seseorang"),
    148: ("💁", "", "sassy / meremehkan"),
    149: ("🤬", "PAKYU ANJING", "umpatan paling kasar"),
    150: ("🤨", "MENCURIGAKAN", "curiga / ada yang aneh"),
    151: ("🤠", "BENTAR", "minta jeda sebentar"),
    152: ("🤫", "brisik lu tua", "nyuruh diam (bercanda kasar)"),
    153: ("🤫", "brisik lu tua", "nyuruh diam (duplikat 152)"),
    154: ("🗣️", "udah yappingnya?", "menanyakan omongan sudah selesai"),
    155: ("🤦", "ni orang bego apa tolol si", "frustrasi melihat kebodohan"),
    156: ("👑", "seriusan seorang princess diginiin?", "drama self-pity bercanda"),
    157: ("🧼", "tolong ketikannya yang suci dong", "minta bicara sopan"),
    158: ("🧠", "OTAK DIPAKE", "sindiran supaya berpikir"),
    159: ("😍", "hai gantengk", "sapaan genit bercanda"),
    160: ("😭", "ijin of mau nangis", "sedih / terharu / drama"),
    161: ("😡", "GW TANDAIN MUKA LO!", "ancaman bercanda"),
    162: ("😳", "", "syok / speechless"),
    163: ("😿", "", "capek / stres / pengen teriak"),
    164: ("😊", "", "bahagia / malu / gemas"),
    165: ("📝", "SYAP SYA CATAT", "noted sarkastis"),
    166: ("😂", "", "ngakak"),
    167: ("😾", "", "marah / awas ya"),
    168: ("💥", "BHAAAPPP", "efek suara tamparan"),
    169: ("🐱", "", "santai / pasrah"),
    170: ("😱", "WUS Kaget", "kaget mendadak"),
    171: ("🐱", "", "gemas / imut"),
    172: ("😊", "", "gemas / malu-malu"),
    173: ("😅", "senyum tertekan", "senyum terpaksa saat tertekan"),
    174: ("🕴️", "", "tegang / curiga"),
    175: ("😊", "", "gemas / bahagia"),
    176: ("😵", "", "pusing / berpikir keras"),
    177: ("😱", "141 km/h", "ngebut / panik"),
    178: ("🖕", "Pakyu", "umpatan (duplikat 6)"),
    179: ("👍", "MEMBERI LAIK", "apresiasi / setuju"),
    180: ("😹", "", "ngakak"),
    181: ("🛌", "YA UDAH BESOK AJA", "menunda"),
    182: ("😴", "", "tidur nyenyak"),
    183: ("😧", "HAH?", "bingung / tidak paham"),
    184: ("😁", "", "senang"),
    185: ("😐", "", "bodo amat / malas"),
    186: ("😾", "", "marah / kesal"),
    187: ("🤭", "", "kaget / malu / menahan tawa"),
    188: ("🎂", "happy birthday", "ucapan ulang tahun"),
    189: ("🤝", "Sama-sama", "membalas terima kasih"),
    190: ("😔", "", "kesepian / sedih menyendiri"),
    191: ("😺", "", "bingung / melongo"),
    192: ("😊", "", "senang / tenang"),
    193: ("🥺", "sniff sniff", "sedih / baper"),
    194: ("😱", "", "teriak / kaget"),
    195: ("😰", "", "takut / panik"),
    196: ("🐱", "", "bingung / menatap kosong"),
    197: ("😅", "UPS", "kesalahan kecil / tidak sengaja"),
    198: ("🏍️", "", "siap / berangkat / berkendara"),
    199: ("😂", "", "ngakak"),
    200: ("😛", "", "jail / bercanda bahagia"),
    201: ("💩", "TAI!", "umpatan kesal"),
    202: ("🤣", "Cukurukuk", "tertawa terhibur"),
    203: ("🤔", "MIKIR KRIDS", "berpikir terlalu keras / sok pintar"),
    204: ("😭", "", "sedih / lelah / putus asa"),
    205: ("😲", "SIAPA SANGKA", "keterkejutan"),
    206: ("🙏", "MINTA MAAF DIATAS MATERAI", "minta maaf berlebihan (bercanda)"),
    207: ("🤲", "MOGA DIPERMUDAH ALLAH SEGALANYA", "doa / memberi semangat"),
    208: ("😂", "BAKEKOK", "ekspresi kocak"),
    209: ("📞", "MENELPON USTAD", "bercanda minta nasihat agama"),
    210: ("👎", "MEMBERI DISLIKE", "tidak setuju"),
    211: ("😎", "Gua / ADMIN", "menantang admin (bercanda)"),
    212: ("🫡", "BAIK BUNDA", "menyatakan kesediaan (sering sarkastis)"),
    213: ("😊", "", "senyum ramah (bisa sarkastis)"),
    214: ("🤫", "jaga bicaramu tuaa", "peringatan bercanda"),
    215: ("😊", "", "gemas / malu / sindiran halus"),
    216: ("🤔", "", "bingung / menimbang sesuatu"),
    217: ("😔", "", "sedih / kesepian / minder"),
    218: ("😹", "wlcowlcowleo", "ekspresi lucu"),
    219: ("😲", "", "kaget / tidak percaya"),
    220: ("💀", "I forgor", "mengaku lupa (bercanda)"),
    221: ("😱", "", "kaget / panik / menyesal"),
}


def build_manifest() -> dict[str, str]:
    """Pilih satu file per emoji (nomor terkecil menang) + kumpulkan JSON label."""
    by_emoji: dict[str, str] = {}
    records: list[dict[str, str]] = []
    for no in sorted(LABELS):
        emoji, teks, pakai = LABELS[no]
        fname = f"stk_{no:03d}.webp"
        by_emoji.setdefault(emoji, fname)
        records.append({"file": fname, "emoji": emoji, "teks": teks, "pakai": pakai})
    return by_emoji, records


def render_ts(by_emoji: dict[str, str]) -> str:
    lines = [
        "/**",
        " * Manifest stiker: emoji -> nama file di public/stickers/.",
        " *",
        " * DILABELI MANUAL (bukan model API) dengan membaca TEKS di setiap stiker lebih",
        " * dulu, baru konsep gambarnya. Alasan: pelabelan otomatis hanya melihat ekspresi",
        " * wajah sehingga sering salah — contoh nyata: stk_007 (orang dimarahi atasan)",
        " * dilabeli tawa, padahal maknanya kena tegur/tegang.",
        " *",
        " * Sumber kebenaran: scripts/build_sticker_manifest.py (nomor -> emoji/teks/konteks).",
        " * Jalankan ulang setelah mengubah label:",
        " *   python scripts/build_sticker_manifest.py",
        " */",
        "export const STICKER_MANIFEST: Record<string, string> = {",
    ]
    for emoji in sorted(by_emoji):
        lines.append(f'  {json.dumps(emoji, ensure_ascii=False)}: {json.dumps(by_emoji[emoji])},')
    lines.append("};")
    lines.append("")
    lines.append("/**")
    lines.append(' * Emoji "keras" (umpatan/provokasi). Boleh dipakai bot HANYA saat konteks bercanda')
    lines.append(" * (user bercanda/roasting/mengirim stiker serupa lebih dulu) — lihat guard di runtime.")
    lines.append(" */")
    lines.append("export const EDGY_STICKER_EMOJIS: string[] = [")
    for e in ["👊", "🖕", "😈", "😠", "🤬", "💩", "💀"]:
        if e in by_emoji:
            lines.append(f"  {json.dumps(e, ensure_ascii=False)},")
    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    by_emoji, records = build_manifest()
    missing = [r["file"] for r in records if not os.path.exists(os.path.join(ROOT, "public", "stickers", r["file"]))]

    print(f"stiker dilabeli : {len(records)}")
    print(f"emoji unik      : {len(by_emoji)}")
    print(f"file hilang     : {len(missing)}" + (f" -> {missing[:5]}" if missing else ""))

    # Cek semua file stiker terwakili
    all_files = {f for f in os.listdir(os.path.join(ROOT, "public", "stickers")) if f.endswith(".webp")}
    covered = {r["file"] for r in records}
    print(f"file di disk    : {len(all_files)}")
    print(f"belum dilabeli  : {len(all_files - covered)}" + (f" -> {sorted(all_files - covered)[:5]}" if all_files - covered else ""))

    if "--check" in sys.argv:
        return

    with open(MANIFEST, "w", encoding="utf-8") as fh:
        fh.write(render_ts(by_emoji))
    with open(LABELS_JSON, "w", encoding="utf-8") as fh:
        json.dump(records, fh, ensure_ascii=False, indent=1)
    print(f"\nmanifest ditulis: {os.path.relpath(MANIFEST, ROOT)}")
    print(f"label JSON     : {os.path.relpath(LABELS_JSON, ROOT)}")


if __name__ == "__main__":
    main()
