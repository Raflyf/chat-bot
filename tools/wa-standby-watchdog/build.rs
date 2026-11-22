use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const ICON_SIZES: &[u32] = &[16, 20, 24, 32, 48, 64, 128];

fn sd_rounded_box(px: f32, py: f32, bx: f32, by: f32, r: f32) -> f32 {
    let qx = px.abs() - bx + r;
    let qy = py.abs() - by + r;
    let out_x = qx.max(0.0);
    let out_y = qy.max(0.0);
    (out_x * out_x + out_y * out_y).sqrt() + qx.max(qy).min(0.0) - r
}

fn sd_segment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let pax = px - ax;
    let pay = py - ay;
    let bax = bx - ax;
    let bay = by - ay;
    let h = ((pax * bax + pay * bay) / (bax * bax + bay * bay)).clamp(0.0, 1.0);
    let dx = pax - bax * h;
    let dy = pay - bay * h;
    (dx * dx + dy * dy).sqrt()
}

fn point_in_triangle(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) -> bool {
    let d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    let d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    let d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    let has_neg = (d1 < 0.0) || (d2 < 0.0) || (d3 < 0.0);
    let has_pos = (d1 > 0.0) || (d2 > 0.0) || (d3 > 0.0);
    !(has_neg && has_pos)
}

fn sample_icon_point(u: f32, v: f32, active_failover: bool) -> (f32, f32, f32, f32) {
    // 1. Rounded squircle background
    let d_bg = sd_rounded_box(u - 0.5, v - 0.5, 0.45, 0.45, 0.21);
    if d_bg > 0.0 {
        return (0.0, 0.0, 0.0, 0.0);
    }

    // Background gradient (emerald green for standby, rich teal-emerald with warm highlight for active)
    let t = ((u * 0.45) + (v * 0.75)).clamp(0.0, 1.0);
    let (mut r, mut g, mut b) = if !active_failover {
        // #10B981 -> #047857
        let r0 = 16.0 + (4.0 - 16.0) * t;
        let g0 = 195.0 + (115.0 - 195.0) * t;
        let b0 = 132.0 + (82.0 - 132.0) * t;
        (r0, g0, b0)
    } else {
        // #0D9488 -> #065F46
        let r0 = 20.0 + (6.0 - 20.0) * t;
        let g0 = 184.0 + (95.0 - 184.0) * t;
        let b0 = 146.0 + (70.0 - 146.0) * t;
        (r0, g0, b0)
    };

    // Subtle top-left gloss highlight
    let glow_dist = ((u - 0.30).powi(2) + (v - 0.25).powi(2)).sqrt();
    if glow_dist < 0.45 {
        let k = (1.0 - glow_dist / 0.45).powi(2) * 0.22;
        r = r + (255.0 - r) * k;
        g = g + (255.0 - g) * k;
        b = b + (255.0 - b) * k;
    }

    // Subtle border rim
    if d_bg > -0.032 {
        let rim = if v < 0.5 { 0.28 } else { -0.22 };
        if rim > 0.0 {
            r = r + (255.0 - r) * rim;
            g = g + (255.0 - g) * rim;
            b = b + (255.0 - b) * rim;
        } else {
            let k = 1.0 + rim;
            r *= k;
            g *= k;
            b *= k;
        }
    }

    // 2. Drop shadow for central speech bubble
    let sb_cx = 0.47;
    let sb_cy = 0.45;
    let sb_r = 0.275;
    let sh_dist = ((u - sb_cx).powi(2) + (v - (sb_cy + 0.03)).powi(2)).sqrt();
    let in_sh_tail = point_in_triangle(u, v, 0.23, 0.75, 0.33, 0.56, 0.47, 0.67);
    if sh_dist <= sb_r || in_sh_tail {
        r *= 0.72;
        g *= 0.72;
        b *= 0.72;
    }

    // 3. White WhatsApp-style speech bubble
    let b_dist = ((u - sb_cx).powi(2) + (v - sb_cy).powi(2)).sqrt();
    let in_tail = point_in_triangle(u, v, 0.22, 0.72, 0.32, 0.52, 0.46, 0.64);
    if b_dist <= sb_r || in_tail {
        r = 250.0;
        g = 254.0;
        b = 252.0;

        // 4. Inner Lightning / Failover Sync Bolt inside the speech bubble
        let in_upper_bolt = point_in_triangle(u, v, 0.52, 0.26, 0.37, 0.47, 0.49, 0.47);
        let in_lower_bolt = point_in_triangle(u, v, 0.45, 0.43, 0.58, 0.43, 0.43, 0.64);
        let d_bolt_spine = sd_segment(u, v, 0.50, 0.29, 0.45, 0.61);
        if in_upper_bolt || in_lower_bolt || d_bolt_spine < 0.025 {
            if active_failover {
                // Warm amber-orange bolt when failover is actively running
                r = 217.0;
                g = 119.0;
                b = 6.0;
            } else {
                // Deep emerald bolt in standby
                r = 5.0;
                g = 150.0;
                b = 105.0;
            }
        }
    }

    // 5. Bottom-right status indicator badge (high visibility at 16x16 tray size)
    let dot_cx = 0.76;
    let dot_cy = 0.76;
    let dot_d = ((u - dot_cx).powi(2) + (v - dot_cy).powi(2)).sqrt();
    if dot_d <= 0.205 {
        if dot_d > 0.145 {
            // Dark slate high-contrast separator ring (#0F172A)
            r = 15.0;
            g = 23.0;
            b = 42.0;
        } else if active_failover {
            // Bright Amber-Gold indicator (#FBBF24) when local backup is ACTIVE
            r = 251.0;
            g = 191.0;
            b = 36.0;
        } else {
            // Bright Mint-Cyan indicator (#34D399) when Standby monitoring
            r = 52.0;
            g = 211.0;
            b = 153.0;
        }
    }

    (r.clamp(0.0, 255.0), g.clamp(0.0, 255.0), b.clamp(0.0, 255.0), 255.0)
}

/// Compute 4x4 MSAA supersampled RGBA pixel at `(x, y)` (top-down coordinates)
fn sample_pixel_msaa(size: u32, x: u32, y: u32, active_failover: bool) -> (u8, u8, u8, u8) {
    let mut sum_r = 0.0f32;
    let mut sum_g = 0.0f32;
    let mut sum_b = 0.0f32;
    let mut sum_a = 0.0f32;

    for sy in 0..4 {
        for sx in 0..4 {
            let u = (x as f32 + (sx as f32 + 0.5) / 4.0) / (size as f32);
            let v = (y as f32 + (sy as f32 + 0.5) / 4.0) / (size as f32);
            let (r, g, b, a) = sample_icon_point(u, v, active_failover);
            let alpha_norm = a / 255.0;
            sum_r += r * alpha_norm;
            sum_g += g * alpha_norm;
            sum_b += b * alpha_norm;
            sum_a += a;
        }
    }

    let avg_a = (sum_a / 16.0).round().clamp(0.0, 255.0) as u8;
    let (final_r, final_g, final_b) = if sum_a > 0.0 {
        let denom = sum_a / 255.0;
        (
            (sum_r / denom).round().clamp(0.0, 255.0) as u8,
            (sum_g / denom).round().clamp(0.0, 255.0) as u8,
            (sum_b / denom).round().clamp(0.0, 255.0) as u8,
        )
    } else {
        (0, 0, 0)
    };
    (final_r, final_g, final_b, avg_a)
}

/// Render a single icon resolution into a Win32 32-bit BGRA DIB (BITMAPINFOHEADER + XOR + AND mask)
fn render_icon_dib(size: u32, active_failover: bool) -> Vec<u8> {
    let mut xor_pixels = Vec::with_capacity((size * size * 4) as usize);
    let and_row_bytes = ((size + 31) / 32) * 4;
    let mut and_mask = vec![0u8; (and_row_bytes * size) as usize];

    // DIB rows are stored bottom-up (y = size-1 down to 0)
    for y_inv in 0..size {
        let y = size - 1 - y_inv;
        for x in 0..size {
            let (r, g, b, a) = sample_pixel_msaa(size, x, y, active_failover);

            // BGRA byte order
            xor_pixels.push(b);
            xor_pixels.push(g);
            xor_pixels.push(r);
            xor_pixels.push(a);

            if a < 16 {
                let byte_idx = (y_inv * and_row_bytes + (x / 8)) as usize;
                let bit_idx = 7 - (x % 8);
                and_mask[byte_idx] |= 1u8 << bit_idx;
            }
        }
    }

    let mut dib = Vec::with_capacity(40 + xor_pixels.len() + and_mask.len());
    // BITMAPINFOHEADER (40 bytes)
    dib.extend_from_slice(&40u32.to_le_bytes()); // biSize
    dib.extend_from_slice(&(size as i32).to_le_bytes()); // biWidth
    dib.extend_from_slice(&((size * 2) as i32).to_le_bytes()); // biHeight (XOR + AND)
    dib.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    dib.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    dib.extend_from_slice(&0u32.to_le_bytes()); // biCompression (BI_RGB)
    dib.extend_from_slice(&((xor_pixels.len() + and_mask.len()) as u32).to_le_bytes()); // biSizeImage
    dib.extend_from_slice(&0i32.to_le_bytes()); // biXPelsPerMeter
    dib.extend_from_slice(&0i32.to_le_bytes()); // biYPelsPerMeter
    dib.extend_from_slice(&0u32.to_le_bytes()); // biClrUsed
    dib.extend_from_slice(&0u32.to_le_bytes()); // biClrImportant
    dib.extend_from_slice(&xor_pixels);
    dib.extend_from_slice(&and_mask);
    dib
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320u32 & mask);
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    const MOD_ADLER: u32 = 65521;
    let mut a = 1u32;
    let mut b = 0u32;
    for &byte in bytes {
        a = (a + u32::from(byte)) % MOD_ADLER;
        b = (b + a) % MOD_ADLER;
    }
    (b << 16) | a
}

fn append_png_chunk(out: &mut Vec<u8>, tag: &[u8; 4], payload: &[u8]) {
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    let start = out.len();
    out.extend_from_slice(tag);
    out.extend_from_slice(payload);
    let c = crc32(&out[start..]);
    out.extend_from_slice(&c.to_be_bytes());
}

/// Encode an uncompressed RGBA PNG (valid zlib stored-blocks stream) for 256x256 Vista+ ICO entries
fn render_icon_png(size: u32, active_failover: bool) -> Vec<u8> {
    let row_len = 1 + (size as usize) * 4;
    let mut raw = Vec::with_capacity(row_len * (size as usize));
    for y in 0..size {
        raw.push(0); // PNG filter type 0 (None)
        for x in 0..size {
            let (r, g, b, a) = sample_pixel_msaa(size, x, y, active_failover);
            raw.extend_from_slice(&[r, g, b, a]);
        }
    }

    // Wrap raw scanlines in zlib stored-blocks (max 65535 bytes per block)
    let mut zlib = Vec::with_capacity(raw.len() + 64);
    zlib.extend_from_slice(&[0x78, 0x01]); // CMF=0x78 (deflate 32K), FLG=0x01 (no dict, fastest)
    let mut offset = 0usize;
    while offset < raw.len() {
        let remain = raw.len() - offset;
        let block_len = remain.min(65535);
        let is_last = offset + block_len >= raw.len();
        zlib.push(if is_last { 0x01 } else { 0x00 });
        let len_u16 = block_len as u16;
        let nlen_u16 = !len_u16;
        zlib.extend_from_slice(&len_u16.to_le_bytes());
        zlib.extend_from_slice(&nlen_u16.to_le_bytes());
        zlib.extend_from_slice(&raw[offset..offset + block_len]);
        offset += block_len;
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut png = Vec::with_capacity(zlib.len() + 128);
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&size.to_be_bytes());
    ihdr[4..8].copy_from_slice(&size.to_be_bytes());
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    append_png_chunk(&mut png, b"IHDR", &ihdr);
    append_png_chunk(&mut png, b"IDAT", &zlib);
    append_png_chunk(&mut png, b"IEND", &[]);
    png
}

/// Build a standalone multi-resolution `.ico` file from rendered DIB slices
fn build_ico_file(dibs: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let count = dibs.len() as u16;
    let mut ico = Vec::new();
    // ICONDIR (6 bytes)
    ico.extend_from_slice(&0u16.to_le_bytes()); // idReserved
    ico.extend_from_slice(&1u16.to_le_bytes()); // idType (1 = icon)
    ico.extend_from_slice(&count.to_le_bytes()); // idCount

    let mut offset = 6u32 + (dibs.len() as u32) * 16;
    for (size, dib) in dibs {
        let dim_byte = if *size >= 256 { 0u8 } else { *size as u8 };
        ico.push(dim_byte); // bWidth
        ico.push(dim_byte); // bHeight
        ico.push(0); // bColorCount
        ico.push(0); // bReserved
        ico.extend_from_slice(&1u16.to_le_bytes()); // wPlanes
        ico.extend_from_slice(&32u16.to_le_bytes()); // wBitCount
        ico.extend_from_slice(&(dib.len() as u32).to_le_bytes()); // dwBytesInRes
        ico.extend_from_slice(&offset.to_le_bytes()); // dwImageOffset
        offset += dib.len() as u32;
    }

    for (_, dib) in dibs {
        ico.extend_from_slice(dib);
    }
    ico
}

/// Build `RT_GROUP_ICON` payload (`GRPICONDIR` + 14-byte `GRPICONDIRENTRY` items)
fn build_group_icon_resource(dibs: &[(u32, Vec<u8>)], base_icon_id: u16) -> Vec<u8> {
    let count = dibs.len() as u16;
    let mut grp = Vec::with_capacity(6 + dibs.len() * 14);
    grp.extend_from_slice(&0u16.to_le_bytes()); // idReserved
    grp.extend_from_slice(&1u16.to_le_bytes()); // idType (1 = icon)
    grp.extend_from_slice(&count.to_le_bytes()); // idCount

    for (idx, (size, dib)) in dibs.iter().enumerate() {
        let dim_byte = if *size >= 256 { 0u8 } else { *size as u8 };
        let icon_id = base_icon_id + (idx as u16);
        grp.push(dim_byte); // bWidth
        grp.push(dim_byte); // bHeight
        grp.push(0); // bColorCount
        grp.push(0); // bReserved
        grp.extend_from_slice(&1u16.to_le_bytes()); // wPlanes
        grp.extend_from_slice(&32u16.to_le_bytes()); // wBitCount
        grp.extend_from_slice(&(dib.len() as u32).to_le_bytes()); // dwBytesInRes
        grp.extend_from_slice(&icon_id.to_le_bytes()); // nID (2 bytes)
    }
    grp
}

fn encode_utf16_nul(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity((s.len() + 1) * 2);
    for u in s.encode_utf16() {
        out.extend_from_slice(&u.to_le_bytes());
    }
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn pad4(buf: &mut Vec<u8>) {
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
}

fn build_version_node(
    key: &str,
    w_type: u16,
    value_bytes: &[u8],
    w_value_len: u16,
    children: &[Vec<u8>],
) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend_from_slice(&0u16.to_le_bytes()); // placeholder wLength
    buf.extend_from_slice(&w_value_len.to_le_bytes());
    buf.extend_from_slice(&w_type.to_le_bytes());
    buf.extend_from_slice(&encode_utf16_nul(key));
    pad4(&mut buf);

    if !value_bytes.is_empty() {
        buf.extend_from_slice(value_bytes);
    }

    for child in children {
        pad4(&mut buf);
        buf.extend_from_slice(child);
    }

    let total_len = buf.len() as u16;
    buf[0..2].copy_from_slice(&total_len.to_le_bytes());
    buf
}

fn build_string_pair(key: &str, val: &str) -> Vec<u8> {
    let val_bytes = encode_utf16_nul(val);
    let word_count = (val_bytes.len() / 2) as u16;
    build_version_node(key, 1, &val_bytes, word_count, &[])
}

fn resolve_windows_version() -> (u16, u16, u16, u16, String) {
    let major = env::var("CARGO_PKG_VERSION_MAJOR")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(1);
    let minor = env::var("CARGO_PKG_VERSION_MINOR")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(0);
    let patch = env::var("CARGO_PKG_VERSION_PATCH")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(0);
    let build = env::var("GITHUB_RUN_NUMBER")
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .map(|n| n.min(u16::MAX as u32) as u16)
        .unwrap_or(0);
    let ver_str = format!("{major}.{minor}.{patch}.{build}");
    (major, minor, patch, build, ver_str)
}

fn build_version_info_resource(
    major: u16,
    minor: u16,
    patch: u16,
    build: u16,
    ver_str: &str,
) -> Vec<u8> {
    let ver_ms = ((major as u32) << 16) | (minor as u32);
    let ver_ls = ((patch as u32) << 16) | (build as u32);

    // VS_FIXEDFILEINFO (52 bytes)
    let mut fixed = Vec::with_capacity(52);
    fixed.extend_from_slice(&0xFEEF04BDu32.to_le_bytes()); // dwSignature
    fixed.extend_from_slice(&0x00010000u32.to_le_bytes()); // dwStrucVersion
    fixed.extend_from_slice(&ver_ms.to_le_bytes()); // dwFileVersionMS
    fixed.extend_from_slice(&ver_ls.to_le_bytes()); // dwFileVersionLS
    fixed.extend_from_slice(&ver_ms.to_le_bytes()); // dwProductVersionMS
    fixed.extend_from_slice(&ver_ls.to_le_bytes()); // dwProductVersionLS
    fixed.extend_from_slice(&0x0000003Fu32.to_le_bytes()); // dwFileFlagsMask
    fixed.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileFlags
    fixed.extend_from_slice(&0x00040004u32.to_le_bytes()); // dwFileOS (VOS_NT_WINDOWS32)
    fixed.extend_from_slice(&0x00000001u32.to_le_bytes()); // dwFileType (VFT_APP)
    fixed.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileSubtype
    fixed.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileDateMS
    fixed.extend_from_slice(&0x00000000u32.to_le_bytes()); // dwFileDateLS

    let strings = vec![
        build_string_pair("CompanyName", "FreeAIBot"),
        build_string_pair("FileDescription", "Baileys Backup"),
        build_string_pair("FileVersion", ver_str),
        build_string_pair("InternalName", "BaileysBackup"),
        build_string_pair("OriginalFilename", "BaileysBackup.exe"),
        build_string_pair("ProductName", "Baileys Backup"),
        build_string_pair("ProductVersion", ver_str),
    ];
    let string_table = build_version_node("040904B0", 1, &[], 0, &strings);
    let string_file_info = build_version_node("StringFileInfo", 1, &[], 0, &[string_table]);

    let translation_val = [0x09u8, 0x04, 0xB0, 0x04]; // 0x0409, 1200
    let var_node = build_version_node("Translation", 0, &translation_val, 4, &[]);
    let var_file_info = build_version_node("VarFileInfo", 1, &[], 0, &[var_node]);

    build_version_node(
        "VS_VERSION_INFO",
        0,
        &fixed,
        fixed.len() as u16,
        &[string_file_info, var_file_info],
    )
}

/// Build a standard x86_64 COFF `.o` object file containing a `.rsrc` section
/// with `IMAGE_REL_AMD64_ADDR32NB` (RVA) relocations so GNU `ld` / `lld` / `link.exe`
/// links the icons and `VS_VERSION_INFO` directly into the PE executable without `windres.exe`.
fn build_coff_rsrc_object( mut items: Vec<(u16, u16, u16, Vec<u8>)>) -> Vec<u8> {
    // Sort by (type_id, name_id, lang_id) as required by PE Resource Directory specification
    items.sort_by_key(|&(t, n, l, _)| (t, n, l));

    // Group items by type_id
    let mut type_groups: Vec<(u16, Vec<(u16, u16, Vec<u8>)>)> = Vec::new();
    for (t, n, l, data) in items {
        if let Some(last) = type_groups.last_mut() {
            if last.0 == t {
                last.1.push((n, l, data));
                continue;
            }
        }
        type_groups.push((t, vec![(n, l, data)]));
    }

    let num_types = type_groups.len();
    let total_items: usize = type_groups.iter().map(|(_, v)| v.len()).sum();

    // Calculate directory offsets within `.rsrc`
    let l1_size = 16 + num_types * 8;
    let l2_total_size: usize = type_groups.iter().map(|(_, v)| 16 + v.len() * 8).sum();
    let l3_total_size = total_items * (16 + 8);
    let data_entries_offset = l1_size + l2_total_size + l3_total_size;
    let data_entries_size = total_items * 16;
    let payloads_start = (data_entries_offset + data_entries_size + 7) & !7;

    let mut rsrc = Vec::new();

    // 1. Level 1 Directory (Types)
    rsrc.extend_from_slice(&0u32.to_le_bytes()); // Characteristics
    rsrc.extend_from_slice(&0u32.to_le_bytes()); // TimeDateStamp
    rsrc.extend_from_slice(&0u16.to_le_bytes()); // MajorVersion
    rsrc.extend_from_slice(&0u16.to_le_bytes()); // MinorVersion
    rsrc.extend_from_slice(&0u16.to_le_bytes()); // NumberOfNamedEntries
    rsrc.extend_from_slice(&(num_types as u16).to_le_bytes()); // NumberOfIdEntries

    let mut cur_l2_offset = l1_size;
    for (type_id, group) in &type_groups {
        rsrc.extend_from_slice(&(*type_id as u32).to_le_bytes());
        rsrc.extend_from_slice(&((cur_l2_offset as u32) | 0x8000_0000).to_le_bytes());
        cur_l2_offset += 16 + group.len() * 8;
    }

    // 2. Level 2 Directories (Name IDs per Type)
    let mut cur_l3_offset = l1_size + l2_total_size;
    for (_, group) in &type_groups {
        rsrc.extend_from_slice(&0u32.to_le_bytes());
        rsrc.extend_from_slice(&0u32.to_le_bytes());
        rsrc.extend_from_slice(&0u16.to_le_bytes());
        rsrc.extend_from_slice(&0u16.to_le_bytes());
        rsrc.extend_from_slice(&0u16.to_le_bytes());
        rsrc.extend_from_slice(&(group.len() as u16).to_le_bytes());

        for (name_id, _, _) in group {
            rsrc.extend_from_slice(&(*name_id as u32).to_le_bytes());
            rsrc.extend_from_slice(&((cur_l3_offset as u32) | 0x8000_0000).to_le_bytes());
            cur_l3_offset += 24;
        }
    }

    // 3. Level 3 Directories (Language IDs -> Data Entry offsets)
    let mut item_idx = 0usize;
    for (_, group) in &type_groups {
        for (_, lang_id, _) in group {
            rsrc.extend_from_slice(&0u32.to_le_bytes());
            rsrc.extend_from_slice(&0u32.to_le_bytes());
            rsrc.extend_from_slice(&0u16.to_le_bytes());
            rsrc.extend_from_slice(&0u16.to_le_bytes());
            rsrc.extend_from_slice(&0u16.to_le_bytes());
            rsrc.extend_from_slice(&1u16.to_le_bytes());

            let data_entry_off = data_entries_offset + item_idx * 16;
            rsrc.extend_from_slice(&(*lang_id as u32).to_le_bytes());
            rsrc.extend_from_slice(&(data_entry_off as u32).to_le_bytes());
            item_idx += 1;
        }
    }

    // 4. IMAGE_RESOURCE_DATA_ENTRY array + Payload buffer + Relocations
    let mut payloads = Vec::new();
    let mut relocs: Vec<u32> = Vec::with_capacity(total_items);
    let mut cur_payload_off = payloads_start;

    let mut item_idx = 0usize;
    for (_, group) in &type_groups {
        for (_, _, data) in group {
            let entry_off = data_entries_offset + item_idx * 16;
            relocs.push(entry_off as u32);

            rsrc.extend_from_slice(&(cur_payload_off as u32).to_le_bytes()); // OffsetToData (relocated by ADDR32NB)
            rsrc.extend_from_slice(&(data.len() as u32).to_le_bytes()); // Size
            rsrc.extend_from_slice(&0u32.to_le_bytes()); // CodePage
            rsrc.extend_from_slice(&0u32.to_le_bytes()); // Reserved

            payloads.extend_from_slice(data);
            while payloads.len() % 8 != 0 {
                payloads.push(0);
            }
            cur_payload_off = payloads_start + payloads.len();
            item_idx += 1;
        }
    }

    while rsrc.len() < payloads_start {
        rsrc.push(0);
    }
    rsrc.extend_from_slice(&payloads);

    // Build full COFF object
    let raw_data_ptr = 20u32 + 40u32; // Header (20) + 1 Section Header (40) = 60
    let reloc_ptr = raw_data_ptr + (rsrc.len() as u32);
    let symtab_ptr = reloc_ptr + (relocs.len() as u32) * 10;

    let mut coff = Vec::new();
    // IMAGE_FILE_HEADER (20 bytes)
    coff.extend_from_slice(&0x8664u16.to_le_bytes()); // Machine = AMD64
    coff.extend_from_slice(&1u16.to_le_bytes()); // NumberOfSections = 1
    coff.extend_from_slice(&0u32.to_le_bytes()); // TimeDateStamp
    coff.extend_from_slice(&symtab_ptr.to_le_bytes()); // PointerToSymbolTable
    coff.extend_from_slice(&1u32.to_le_bytes()); // NumberOfSymbols = 1
    coff.extend_from_slice(&0u16.to_le_bytes()); // SizeOfOptionalHeader = 0
    coff.extend_from_slice(&0u16.to_le_bytes()); // Characteristics = 0

    // IMAGE_SECTION_HEADER (40 bytes)
    coff.extend_from_slice(b".rsrc\0\0\0"); // Name
    coff.extend_from_slice(&0u32.to_le_bytes()); // VirtualSize
    coff.extend_from_slice(&0u32.to_le_bytes()); // VirtualAddress
    coff.extend_from_slice(&(rsrc.len() as u32).to_le_bytes()); // SizeOfRawData
    coff.extend_from_slice(&raw_data_ptr.to_le_bytes()); // PointerToRawData
    coff.extend_from_slice(&reloc_ptr.to_le_bytes()); // PointerToRelocations
    coff.extend_from_slice(&0u32.to_le_bytes()); // PointerToLinenumbers
    coff.extend_from_slice(&(relocs.len() as u16).to_le_bytes()); // NumberOfRelocations
    coff.extend_from_slice(&0u16.to_le_bytes()); // NumberOfLinenumbers
    coff.extend_from_slice(&0x4000_0040u32.to_le_bytes()); // Characteristics (INITIALIZED_DATA | MEM_READ)

    // Section data
    coff.extend_from_slice(&rsrc);

    // Relocations (10 bytes each: VirtualAddress u32, SymbolTableIndex u32, Type u16 = 0x0003 ADDR32NB)
    for rva_off in relocs {
        coff.extend_from_slice(&rva_off.to_le_bytes());
        coff.extend_from_slice(&0u32.to_le_bytes()); // Symbol 0 (.rsrc)
        coff.extend_from_slice(&0x0003u16.to_le_bytes()); // IMAGE_REL_AMD64_ADDR32NB
    }

    // Symbol Table (1 symbol = 18 bytes)
    coff.extend_from_slice(b".rsrc\0\0\0"); // Name
    coff.extend_from_slice(&0u32.to_le_bytes()); // Value = 0
    coff.extend_from_slice(&1i16.to_le_bytes()); // SectionNumber = 1
    coff.extend_from_slice(&0u16.to_le_bytes()); // Type = 0
    coff.push(3u8); // StorageClass = IMAGE_SYM_CLASS_STATIC
    coff.push(0u8); // NumberOfAuxSymbols = 0

    // String Table (4 bytes = empty)
    coff.extend_from_slice(&4u32.to_le_bytes());

    coff
}

fn build_app_manifest(ver_str: &str) -> Vec<u8> {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity
    version="{ver_str}"
    processorArchitecture="amd64"
    name="FreeAIBot.BaileysBackup"
    type="win32" />
  <description>Baileys Backup - Standby &amp; Auto-Failover Bot WhatsApp Lokal</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}}" />
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
    </windowsSettings>
  </application>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="amd64"
        publicKeyToken="6595b64144ccf1df"
        language="*" />
    </dependentAssembly>
  </dependency>
</assembly>
"#
    )
    .into_bytes()
}

fn render_icon_set(active_failover: bool) -> Vec<(u32, Vec<u8>)> {
    let mut images: Vec<(u32, Vec<u8>)> = ICON_SIZES
        .iter()
        .map(|&s| (s, render_icon_dib(s, active_failover)))
        .collect();
    images.push((256, render_icon_png(256, active_failover)));
    images
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-env-changed=GITHUB_RUN_NUMBER");

    let (maj, min, pat, bld, ver_str) = resolve_windows_version();

    let standby_images = render_icon_set(false);
    let active_images = render_icon_set(true);
    let standby_ico = build_ico_file(&standby_images);
    let active_ico = build_ico_file(&active_images);

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out_dir.join("standby.ico"), &standby_ico).expect("Failed to write standby.ico");
    fs::write(out_dir.join("active.ico"), &active_ico).expect("Failed to write active.ico");

    // 1. Write standalone .ico files to repo bin/ directory
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let root_bin = Path::new(&manifest_dir)
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("bin"))
            .unwrap_or_else(|| PathBuf::from(&manifest_dir).join("bin"));
        let _ = fs::create_dir_all(&root_bin);
        let _ = fs::write(root_bin.join("baileys-backup.ico"), &standby_ico);
        let _ = fs::write(root_bin.join("baileys-backup-active.ico"), &active_ico);
    }

    // 2. Build x86_64 COFF `.o` resource object file (`.rsrc`)
    // RT_ICON = 3, RT_GROUP_ICON = 14, RT_VERSION = 16, RT_MANIFEST = 24
    let mut items: Vec<(u16, u16, u16, Vec<u8>)> = Vec::new();
    for (idx, (_, img)) in standby_images.iter().enumerate() {
        items.push((3, 1 + (idx as u16), 0x0409, img.clone()));
    }
    items.push((14, 1, 0x0409, build_group_icon_resource(&standby_images, 1)));

    for (idx, (_, img)) in active_images.iter().enumerate() {
        items.push((3, 21 + (idx as u16), 0x0409, img.clone()));
    }
    items.push((14, 2, 0x0409, build_group_icon_resource(&active_images, 21)));

    items.push((
        16,
        1,
        0x0409,
        build_version_info_resource(maj, min, pat, bld, &ver_str),
    ));
    items.push((24, 1, 0x0409, build_app_manifest(&ver_str)));

    let coff_bytes = build_coff_rsrc_object(items);
    let obj_path = out_dir.join("baileys_backup_rsrc.obj");
    fs::write(&obj_path, &coff_bytes).expect("Failed to write baileys_backup_rsrc.obj");

    println!("cargo:rustc-link-arg-bins={}", obj_path.display());
}
