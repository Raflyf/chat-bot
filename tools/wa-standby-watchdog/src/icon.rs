use windows::{
    core::{Error, Result},
    Win32::{
        Foundation::E_INVALIDARG,
        UI::WindowsAndMessaging::{
            CreateIconFromResourceEx, DestroyIcon, GetSystemMetrics, HICON, LR_DEFAULTCOLOR,
            SM_CXICON, SM_CXSMICON,
        },
    },
};

const STANDBY_ICO: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/standby.ico"));
const ACTIVE_ICO: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/active.ico"));

fn select_ico_slice(ico: &[u8], target_px: i32) -> Result<&[u8]> {
    if ico.len() < 6 || ico[..4] != [0, 0, 1, 0] {
        return Err(Error::from(E_INVALIDARG));
    }
    let count = u16::from_le_bytes([ico[4], ico[5]]) as usize;
    let mut best: Option<(i32, usize, usize)> = None;
    for index in 0..count {
        let start = 6 + 16 * index;
        let entry = ico
            .get(start..start + 16)
            .ok_or_else(|| Error::from(E_INVALIDARG))?;
        let width = if entry[0] == 0 { 256 } else { entry[0] as i32 };
        let length = u32::from_le_bytes(
            entry[8..12]
                .try_into()
                .map_err(|_| Error::from(E_INVALIDARG))?,
        ) as usize;
        let offset = u32::from_le_bytes(
            entry[12..16]
                .try_into()
                .map_err(|_| Error::from(E_INVALIDARG))?,
        ) as usize;
        let score = (width - target_px).abs();
        if best.as_ref().is_none_or(|(b, _, _)| score < *b) {
            best = Some((score, offset, length));
        }
    }
    let (_, offset, length) = best.ok_or_else(|| Error::from(E_INVALIDARG))?;
    let end = offset
        .checked_add(length)
        .ok_or_else(|| Error::from(E_INVALIDARG))?;
    ico.get(offset..end).ok_or_else(|| Error::from(E_INVALIDARG))
}

fn load_icon_size(ico: &[u8], target_px: i32) -> Result<HICON> {
    let slice = select_ico_slice(ico, target_px)?;
    // SAFETY: slice points into static embedded ICO payload; CreateIconFromResourceEx reads it immutably.
    unsafe { CreateIconFromResourceEx(slice, true, 0x0003_0000, target_px, target_px, LR_DEFAULTCOLOR) }
}

pub struct AppIcons {
    pub standby_sm: HICON,
    pub standby_lg: HICON,
    pub active_sm: HICON,
    pub active_lg: HICON,
}

// SAFETY: Win32 HICON handles are read-only process-wide UI handles created at startup and only drawn on the UI thread.
unsafe impl Send for AppIcons {}
unsafe impl Sync for AppIcons {}

impl AppIcons {
    pub fn load() -> Result<Self> {
        let sm_px = unsafe { GetSystemMetrics(SM_CXSMICON) }.max(16);
        let lg_px = unsafe { GetSystemMetrics(SM_CXICON) }.max(32);
        let standby_sm = load_icon_size(STANDBY_ICO, sm_px)?;
        let standby_lg = load_icon_size(STANDBY_ICO, lg_px)?;
        let active_sm = load_icon_size(ACTIVE_ICO, sm_px)?;
        let active_lg = load_icon_size(ACTIVE_ICO, lg_px)?;
        Ok(Self {
            standby_sm,
            standby_lg,
            active_sm,
            active_lg,
        })
    }

    pub fn tray_icon(&self, active_failover: bool) -> HICON {
        if active_failover {
            self.active_sm
        } else {
            self.standby_sm
        }
    }

    pub fn panel_icon(&self, active_failover: bool) -> HICON {
        if active_failover {
            self.active_lg
        } else {
            self.standby_lg
        }
    }
}

impl Drop for AppIcons {
    fn drop(&mut self) {
        // SAFETY: each HICON was created uniquely via CreateIconFromResourceEx.
        unsafe {
            for hicon in [
                self.standby_sm,
                self.standby_lg,
                self.active_sm,
                self.active_lg,
            ] {
                if !hicon.is_invalid() {
                    let _ = DestroyIcon(hicon);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_icos_have_multi_res_and_256px_png() {
        assert_eq!(u16::from_le_bytes([STANDBY_ICO[4], STANDBY_ICO[5]]), 8);
        assert_eq!(u16::from_le_bytes([ACTIVE_ICO[4], ACTIVE_ICO[5]]), 8);
        let png_slice = select_ico_slice(STANDBY_ICO, 256).unwrap();
        assert!(png_slice.starts_with(b"\x89PNG\r\n\x1a\n"));
        let sm_slice = select_ico_slice(ACTIVE_ICO, 16).unwrap();
        assert_eq!(u32::from_le_bytes(sm_slice[0..4].try_into().unwrap()), 40);
    }
}
