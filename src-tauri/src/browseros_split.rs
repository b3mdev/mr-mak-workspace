use std::{
    env, fs, path::{Path, PathBuf}, process::Command, ptr::null_mut,
    thread, time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, RECT},
    System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, IsZoomed, SetWindowPos, ShowWindowAsync, GWL_EXSTYLE, GW_OWNER,
        HWND_TOP, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SW_SHOWNOACTIVATE, WS_EX_TOOLWINDOW,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

fn split_bounds(work_area: Bounds, scale: f64) -> Option<(Bounds, Bounds)> {
    let minimum_chats = (350.0 * scale).ceil() as i32;
    let minimum_browser = (500.0 * scale).ceil() as i32;
    if work_area.width < minimum_chats + minimum_browser || work_area.height < (450.0 * scale).ceil() as i32 {
        return None;
    }
    let left_width = (work_area.width * 45 / 100).clamp(minimum_chats, work_area.width - minimum_browser);
    Some((
        Bounds { width: left_width, ..work_area },
        Bounds { x: work_area.x + left_width, width: work_area.width - left_width, ..work_area },
    ))
}

fn browser_executables() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(local) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        folders.push(local.clone());
        folders.push(local.join("Programs"));
    }
    folders.extend(["ProgramFiles", "ProgramFiles(x86)"].into_iter().filter_map(env::var_os).map(PathBuf::from));
    let mut candidates = Vec::new();
    for folder in folders {
        for product in ["BrowserOS neo", "BrowserOS", "BrowserClaw"] {
            let product_folder = folder.join(product);
            for directory in [product_folder.join("Application"), product_folder] {
                for name in ["chrome.exe", "BrowserOS neo.exe", "BrowserOS.exe", "BrowserClaw.exe"] {
                    let candidate = directory.join(name);
                    if candidate.is_file() {
                        candidates.push(candidate);
                    }
                }
            }
        }
    }
    candidates
}

fn canonical_image(path: &Path) -> String {
    let normalized = fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
    let normalized = normalized.to_string_lossy();
    normalized.strip_prefix("\\\\?\\").unwrap_or(&normalized).to_lowercase()
}

fn image_path(window: HWND) -> Option<PathBuf> {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut buffer = vec![0u16; 32768];
    let mut size = buffer.len() as u32;
    let result = unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) };
    unsafe { CloseHandle(process) };
    (result != 0).then(|| PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize])))
}

struct BrowserSearch<'a> {
    allowed_images: &'a [String],
    window: HWND,
}

unsafe extern "system" fn collect_browser_window(window: HWND, context: LPARAM) -> i32 {
    if IsWindowVisible(window) == 0 || !GetWindow(window, GW_OWNER).is_null()
        || GetWindowLongPtrW(window, GWL_EXSTYLE) as usize & WS_EX_TOOLWINDOW as usize != 0
    {
        return 1;
    }
    let mut class = [0u16; 64];
    let size = GetClassNameW(window, class.as_mut_ptr(), class.len() as i32);
    if size <= 0 || String::from_utf16_lossy(&class[..size as usize]) != "Chrome_WidgetWin_1" {
        return 1;
    }

    let search = &mut *(context as *mut BrowserSearch<'_>);
    if let Some(image) = image_path(window) {
        if search.allowed_images.contains(&canonical_image(&image)) {
            search.window = window;
            return 0;
        }
    }
    1
}

fn browser_window(allowed_images: &[String]) -> Option<HWND> {
    let mut search = BrowserSearch { allowed_images, window: null_mut() };
    unsafe { EnumWindows(Some(collect_browser_window), &mut search as *mut _ as LPARAM) };
    (!search.window.is_null()).then_some(search.window)
}

fn place(window: HWND, bounds: Bounds) -> bool {
    unsafe {
        if IsIconic(window) != 0 || IsZoomed(window) != 0 {
            ShowWindowAsync(window, SW_SHOWNOACTIVATE);
        }
        SetWindowPos(
            window, HWND_TOP, bounds.x, bounds.y, bounds.width, bounds.height,
            SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        ) != 0
    }
}

fn positioned_at(window: HWND, bounds: Bounds) -> bool {
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if unsafe { GetWindowRect(window, &mut rect) } == 0 {
        return false;
    }
    [rect.left - bounds.x, rect.top - bounds.y, rect.right - bounds.x - bounds.width, rect.bottom - bounds.y - bounds.height]
        .iter().all(|difference| difference.abs() <= 12)
}

pub(crate) fn split(chats: HWND, work_area: Bounds, scale: f64) -> Result<(), &'static str> {
    let (left, right) = split_bounds(work_area, scale).ok_or("screenTooSmall")?;
    let executables = browser_executables();
    let executable = executables.first().ok_or("missing")?;
    let allowed_images: Vec<_> = executables.iter().map(|path| canonical_image(path)).collect();
    let browser = match browser_window(&allowed_images) {
        Some(window) => window,
        None => {
            // Let neo pick its normal profile and reuse the browser process when it exists.
            Command::new(executable).arg("--new-window").spawn().map_err(|_| "startFailed")?;
            let started = Instant::now();
            loop {
                if let Some(window) = browser_window(&allowed_images) {
                    break window;
                }
                if started.elapsed() >= Duration::from_secs(12) {
                    return Err("windowMissing");
                }
                thread::sleep(Duration::from_millis(200));
            }
        }
    };
    if !place(browser, right) || !place(chats, left) {
        return Err("moveFailed");
    }
    let moved = Instant::now();
    while moved.elapsed() < Duration::from_secs(2) {
        if positioned_at(chats, left) && positioned_at(browser, right) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(80));
    }
    Err("moveFailed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_a_secondary_monitor_without_using_taskbar_space() {
        let work_area = Bounds { x: -1920, y: 24, width: 1920, height: 1056 };
        let (left, right) = split_bounds(work_area, 1.25).unwrap();
        assert_eq!(left, Bounds { x: -1920, y: 24, width: 864, height: 1056 });
        assert_eq!(right, Bounds { x: -1056, y: 24, width: 1056, height: 1056 });
    }

    #[test]
    fn places_two_hidden_test_windows_with_native_geometry() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_OVERLAPPEDWINDOW};

        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let name: Vec<u16> = "Bento geometry test\0".encode_utf16().collect();
        let create = || unsafe {
            CreateWindowExW(
                0, class.as_ptr(), name.as_ptr(), WS_OVERLAPPEDWINDOW, 0, 0, 400, 400,
                null_mut(), null_mut(), null_mut(), std::ptr::null(),
            )
        };
        let chats = create();
        let browser = create();
        if chats.is_null() || browser.is_null() {
            unsafe { DestroyWindow(chats); DestroyWindow(browser) };
            panic!("Windows could not create hidden test windows");
        }
        let work_area = Bounds { x: 0, y: 0, width: 1280, height: 720 };
        let (left, right) = split_bounds(work_area, 1.0).unwrap();
        let placed = place(chats, left) && place(browser, right)
            && positioned_at(chats, left) && positioned_at(browser, right);
        unsafe { DestroyWindow(chats); DestroyWindow(browser) };
        assert!(placed);
    }

    #[test]
    fn honors_scaled_minimums_and_reports_an_insufficient_work_area() {
        let work_area = Bounds { x: 0, y: 0, width: 1100, height: 720 };
        let (left, right) = split_bounds(work_area, 1.25).unwrap();
        assert_eq!(left.width, 475);
        assert_eq!(right.width, 625);
        assert!(split_bounds(work_area, 1.5).is_none());
        assert!(split_bounds(Bounds { height: 550, ..work_area }, 1.25).is_none());
    }
}
