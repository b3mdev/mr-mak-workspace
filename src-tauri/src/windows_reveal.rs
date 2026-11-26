use std::{os::windows::ffi::OsStrExt, path::Path, ptr::{null, null_mut}};
use windows_sys::Win32::{
    System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED},
    UI::{Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName, ShellExecuteW}, WindowsAndMessaging::SW_SHOWNORMAL},
};

pub(crate) fn reveal(target: &Path) -> Result<(), String> {
    let info = target.metadata().map_err(|error| format!("The file or folder is unavailable: {error}"))?;
    let mut wide: Vec<u16> = target.as_os_str().encode_wide().collect();
    if !target.is_absolute() || wide.contains(&0) { return Err("Choose an absolute file or folder path.".into()); }
    wide.push(0);

    // Use an item ID instead of Explorer's /select command-line grammar, which
    // otherwise reparses quotes, comma separators and the path as one argument.
    unsafe {
        let com = CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32);
        if com < 0 { return Err(format!("Could not initialize File Explorer (0x{com:08x}).")); }
        let result = if info.is_dir() {
            let verb = [b'o' as u16, b'p' as u16, b'e' as u16, b'n' as u16, 0];
            let code = ShellExecuteW(null_mut(), verb.as_ptr(), wide.as_ptr(), null(), null(), SW_SHOWNORMAL) as isize;
            if code > 32 { Ok(()) } else { Err(format!("Could not open the folder in File Explorer (code {code}).")) }
        } else {
            let mut item = null_mut();
            let parsed = SHParseDisplayName(wide.as_ptr(), null_mut(), &mut item, 0, null_mut());
            let selected = if parsed >= 0 && !item.is_null() {
                SHOpenFolderAndSelectItems(item, 0, null(), 0)
            } else { parsed };
            let found = !item.is_null();
            if found { CoTaskMemFree(item.cast()); }
            if selected >= 0 && found { Ok(()) } else { Err(format!("Could not select the file in File Explorer (0x{selected:08x}).")) }
        };
        CoUninitialize();
        result
    }
}
