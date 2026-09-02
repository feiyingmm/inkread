//! 桌面端系统托盘。
//!
//! 只在用户把「关闭按钮」设成"收进托盘"时才创建图标 —— 没选这个行为,托盘里就不该多一个图标。
//! 因此这里的两个入口都是幂等的:`ensure` 已有则不重建,`remove` 没有也不报错。
//! 本模块只在非 Android / iOS 下编译(lib.rs 的 `mod tray` 带 cfg),Android 没有托盘。

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ID: &str = "inkread-tray";

/// 把主窗口拉回前台:隐藏的显示出来、最小化的还原、并抢焦点
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 建托盘图标(已有则不动):左键单击 → 打开主窗口;右键菜单 → 打开 / 退出
pub fn ensure(app: &AppHandle) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let show = MenuItem::with_id(app, "show", "打开墨阅", true, None::<&str>).map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(app, &[&show, &sep, &quit]).map_err(|e| e.to_string())?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("墨阅")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    // 图标复用窗口图标(打包时由 tauri-build 从 icons/ 编进二进制),不必再带一份资源
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .build(app)
        .map_err(|e| format!("创建托盘图标失败: {e}"))?;
    Ok(())
}

/// 摘掉托盘图标(没有也没关系)
pub fn remove(app: &AppHandle) {
    let _ = app.remove_tray_by_id(TRAY_ID);
}
