use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, thread, time::Duration};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSWindow, NSStatusWindowLevel};
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;

const TOOLBAR_POSITION_FILE: &str = "toolbar-position.json";
const TOOLBAR_LOGICAL_WIDTH_DEFAULT: f64 = 540.0;
const TOOLBAR_LOGICAL_HEIGHT: f64 = 60.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct ToolbarPosition {
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Copy, Serialize)]
struct CursorMovedPayload {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone)]
struct OverlayWindowInfo {
    label: String,
    monitor_x: i32,
    monitor_y: i32,
    scale: f64,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Toggle pass-through on the overlay window.
#[tauri::command]
fn set_overlay_passthrough(app: AppHandle, pass_through: bool) -> Result<(), String> {
    for label in overlay_labels(&app) {
        if let Some(overlay) = app.get_webview_window(&label) {
            overlay
                .set_ignore_cursor_events(pass_through)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Show or hide the overlay window.
#[tauri::command]
fn set_overlay_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    for label in overlay_labels(&app) {
        if let Some(overlay) = app.get_webview_window(&label) {
            if visible {
                overlay.show().map_err(|e| e.to_string())?;
            } else {
                overlay.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Bridge: toolbar frontend calls this to push events to the overlay window.
#[tauri::command]
fn emit_to_overlay(app: AppHandle, event: String, payload: serde_json::Value) -> Result<(), String> {
    for label in overlay_labels(&app) {
        app.emit_to(&label, &event, payload.clone())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_toolbar_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let pos = ToolbarPosition { x, y };
    let path = toolbar_position_path(&app).map_err(|e| e.to_string())?;
    let data = serde_json::to_vec(&pos).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_toolbar_position(app: AppHandle) -> Result<(), String> {
    let toolbar: WebviewWindow = app
        .get_webview_window("toolbar")
        .ok_or("toolbar window not found")?;
    let monitor = toolbar
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(toolbar.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("no monitor available")?;

    let scale = monitor.scale_factor();
    let work_area = monitor.work_area();
    let (x, y) = default_toolbar_position(work_area, scale);
    toolbar
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;

    if let Ok(path) = toolbar_position_path(&app) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_toolbar_width(app: AppHandle, width: f64) -> Result<(), String> {
    let toolbar: WebviewWindow = app
        .get_webview_window("toolbar")
        .ok_or("toolbar window not found")?;
    let monitor = toolbar
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(toolbar.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("no monitor available")?;
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let clamped_width = width.clamp(360.0, 900.0);
    let toolbar_w_phys = (clamped_width * scale) as i32;
    let toolbar_h_phys = (TOOLBAR_LOGICAL_HEIGHT * scale) as i32;

    toolbar
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: clamped_width,
            height: TOOLBAR_LOGICAL_HEIGHT,
        }))
        .map_err(|e| e.to_string())?;

    let pos = toolbar.outer_position().map_err(|e| e.to_string())?;
    let clamped = clamp_toolbar_position(
        ToolbarPosition { x: pos.x, y: pos.y },
        work_area,
        toolbar_w_phys,
        toolbar_h_phys,
    );
    toolbar
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: clamped.x,
            y: clamped.y,
        }))
        .map_err(|e| e.to_string())?;

    save_toolbar_position(app, clamped.x, clamped.y)
}


// ── Entry Point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    handle_shortcut(app, shortcut);
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_overlay_passthrough,
            set_overlay_visible,
            emit_to_overlay,
            save_toolbar_position,
            reset_toolbar_position,
            quit_app,
            set_toolbar_width,
        ])
        .setup(|app| {
            setup_windows(app)?;
            if let Err(e) = register_shortcuts(app) {
                eprintln!("Global shortcuts unavailable (grant Accessibility permission): {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Setup ─────────────────────────────────────────────────────────────────────

fn setup_windows(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let toolbar: WebviewWindow = app
        .get_webview_window("toolbar")
        .ok_or("toolbar window missing")?;
    let primary_overlay: WebviewWindow = app
        .get_webview_window("overlay")
        .ok_or("overlay window missing")?;

    let primary_monitor = primary_overlay.primary_monitor()?.ok_or("no primary monitor")?;
    let primary_key = monitor_key(&primary_monitor);
    let work_area = primary_monitor.work_area();
    let scale = primary_monitor.scale_factor();

    let mut overlays = vec![OverlayWindowInfo {
        label: "overlay".to_string(),
        monitor_x: primary_monitor.position().x,
        monitor_y: primary_monitor.position().y,
        scale,
    }];

    configure_overlay_for_monitor(&primary_overlay, &primary_monitor)?;

    let mut overlay_index = 1usize;
    for monitor in app.available_monitors()? {
        if monitor_key(&monitor) == primary_key {
            continue;
        }

        let label = format!("overlay-{overlay_index}");
        overlay_index += 1;
        let overlay = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
            .title("Mira Overlay")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .accept_first_mouse(true)
            .resizable(false)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()?;
        configure_overlay_for_monitor(&overlay, &monitor)?;
        overlays.push(OverlayWindowInfo {
            label,
            monitor_x: monitor.position().x,
            monitor_y: monitor.position().y,
            scale: monitor.scale_factor(),
        });
    }

    start_cursor_polling(app.handle().clone(), overlays);

    // Set toolbar to a higher window level on macOS to stay above overlays
    #[cfg(target_os = "macos")]
    {
        let ns_window = toolbar.ns_window()? as *mut AnyObject;
        let ns_window: Option<Retained<NSWindow>> = unsafe { Retained::retain(ns_window.cast()) };
        if let Some(ns_window) = ns_window {
            ns_window.setLevel(NSStatusWindowLevel);
        }
    }

    // Position toolbar top-center inside monitor work area by default.
    let toolbar_phys_w = (TOOLBAR_LOGICAL_WIDTH_DEFAULT * scale) as i32;
    let toolbar_phys_h = (TOOLBAR_LOGICAL_HEIGHT * scale) as i32;
    let (default_toolbar_x, default_toolbar_y) = default_toolbar_position(work_area, scale);

    let saved = load_toolbar_position(&app.handle())
        .map(|pos| clamp_toolbar_position(pos, work_area, toolbar_phys_w, toolbar_phys_h));
    let (toolbar_x, toolbar_y) = saved
        .map(|pos| (pos.x, pos.y))
        .unwrap_or((default_toolbar_x, default_toolbar_y));

    toolbar.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: toolbar_x,
        y: toolbar_y,
    }))?;

    Ok(())
}

fn register_shortcuts(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let ctrl_shift = Some(Modifiers::CONTROL | Modifiers::SHIFT);
    app.global_shortcut().register_multiple([
        Shortcut::new(ctrl_shift, Code::KeyX), // toggle overlay
        Shortcut::new(ctrl_shift, Code::KeyC), // clear
        Shortcut::new(ctrl_shift, Code::KeyZ), // undo
        Shortcut::new(ctrl_shift, Code::KeyY), // redo
        Shortcut::new(ctrl_shift, Code::KeyS), // spotlight
        Shortcut::new(ctrl_shift, Code::KeyD), // toggle draw mode
    ])?;
    Ok(())
}

fn raise_toolbar(app: &AppHandle) {
    if let Some(toolbar) = app.get_webview_window("toolbar") {
        #[cfg(target_os = "macos")]
        {
            if let Ok(ns_window) = toolbar.ns_window() {
                let ns_window = ns_window as *mut AnyObject;
                let ns_window: Option<Retained<NSWindow>> = unsafe { Retained::retain(ns_window.cast()) };
                if let Some(ns_window) = ns_window {
                    ns_window.setLevel(NSStatusWindowLevel);
                }
            }
        }
        let _ = toolbar.set_always_on_top(false);
        let _ = toolbar.set_always_on_top(true);
    }
}

fn handle_shortcut(app: &AppHandle, shortcut: &Shortcut) {
    match shortcut.key {
        Code::KeyX => {
            let _ = app.emit_to("toolbar", "shortcut-toggle", ());
        }
        Code::KeyC => {
            for label in overlay_labels(app) {
                let _ = app.emit_to(&label, "shortcut-clear", ());
            }
        }
        Code::KeyZ => {
            for label in overlay_labels(app) {
                let _ = app.emit_to(&label, "shortcut-undo", ());
            }
        }
        Code::KeyY => {
            for label in overlay_labels(app) {
                let _ = app.emit_to(&label, "shortcut-redo", ());
            }
        }
        Code::KeyS => {
            let _ = app.emit_to("toolbar", "shortcut-spotlight", ());
        }
        Code::KeyD => {
            let _ = app.emit_to("toolbar", "shortcut-draw-toggle", ());
        }
        _ => {}
    }
}

fn toolbar_position_path(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut dir = app.path().app_data_dir()?;
    fs::create_dir_all(&dir)?;
    dir.push(TOOLBAR_POSITION_FILE);
    Ok(dir)
}

fn load_toolbar_position(app: &AppHandle) -> Option<ToolbarPosition> {
    let path = toolbar_position_path(app).ok()?;
    let data = fs::read(path).ok()?;
    serde_json::from_slice::<ToolbarPosition>(&data).ok()
}

fn clamp_toolbar_position(
    pos: ToolbarPosition,
    work_area: &tauri::PhysicalRect<i32, u32>,
    toolbar_w: i32,
    toolbar_h: i32,
) -> ToolbarPosition {
    let min_x = work_area.position.x;
    let max_x = work_area.position.x + work_area.size.width as i32 - toolbar_w;
    let min_y = work_area.position.y;
    let max_y = work_area.position.y + work_area.size.height as i32 - toolbar_h;

    ToolbarPosition {
        x: pos.x.clamp(min_x, max_x),
        y: pos.y.clamp(min_y, max_y),
    }
}

fn default_toolbar_position(work_area: &tauri::PhysicalRect<i32, u32>, scale: f64) -> (i32, i32) {
    let toolbar_phys_w = (TOOLBAR_LOGICAL_WIDTH_DEFAULT * scale) as i32;
    let margin_phys = (24.0 * scale) as i32;
    let x = work_area.position.x + (work_area.size.width as i32 - toolbar_phys_w) / 2;
    let y = work_area.position.y + margin_phys;
    (x, y)
}

fn start_cursor_polling(app: AppHandle, mut overlays: Vec<OverlayWindowInfo>) {
    let app_handle = app.clone();
    thread::spawn(move || {
        let mut last_monitor_check = std::time::Instant::now();
        let mut last = vec![(f64::MIN, f64::MIN); overlays.len()];
        let mut next_overlay_id = overlays.len() + 1;

        loop {
            // Dynamically check for new monitors every 2 seconds
            if last_monitor_check.elapsed() > Duration::from_secs(2) {
                last_monitor_check = std::time::Instant::now();
                if let Ok(monitors) = app_handle.available_monitors() {
                    let current_keys: std::collections::HashSet<_> = overlays.iter()
                        .map(|o| (o.monitor_x, o.monitor_y))
                        .collect();
                    
                    let mut created_any = false;
                    for monitor in monitors {
                        let key = (monitor.position().x, monitor.position().y);
                        if !current_keys.contains(&key) {
                            let label = format!("overlay-dyn-{}", next_overlay_id);
                            next_overlay_id += 1;
                            
                            if let Ok(overlay) = WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App("index.html".into()))
                                .title("Mira Overlay")
                                .decorations(false)
                                .transparent(true)
                                .always_on_top(true)
                                .accept_first_mouse(true)
                                .resizable(false)
                                .skip_taskbar(true)
                                .shadow(false)
                                .visible(false)
                                .build() 
                            {
                                let _ = configure_overlay_for_monitor(&overlay, &monitor);
                                overlays.push(OverlayWindowInfo {
                                    label,
                                    monitor_x: monitor.position().x,
                                    monitor_y: monitor.position().y,
                                    scale: monitor.scale_factor(),
                                });
                                last.push((f64::MIN, f64::MIN));
                                created_any = true;
                            }
                        }
                    }
                    if created_any {
                        raise_toolbar(&app_handle);
                    }
                }
            }

            if let Ok(pos) = app_handle.cursor_position() {
                for (idx, overlay) in overlays.iter().enumerate() {
                    // Convert screen-physical coords to this overlay's logical coords.
                    let x = (pos.x - overlay.monitor_x as f64) / overlay.scale;
                    let y = (pos.y - overlay.monitor_y as f64) / overlay.scale;
                    if (x - last[idx].0).abs() > 0.25 || (y - last[idx].1).abs() > 0.25 {
                        last[idx] = (x, y);
                        let _ = app_handle.emit_to(&overlay.label, "cursor-moved", CursorMovedPayload { x, y });
                    }
                }
            }
            thread::sleep(Duration::from_millis(16));
        }
    });
}

fn configure_overlay_for_monitor(
    overlay: &WebviewWindow,
    monitor: &tauri::Monitor,
) -> Result<(), Box<dyn std::error::Error>> {
    let mon_size = monitor.size();
    let mon_pos = monitor.position();
    overlay.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: mon_size.width,
        height: mon_size.height,
    }))?;
    overlay.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: mon_pos.x,
        y: mon_pos.y,
    }))?;
    overlay.set_ignore_cursor_events(true)?; // start in pass-through
    overlay.show()?;
    Ok(())
}

fn overlay_labels(app: &AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter(|label| label.starts_with("overlay"))
        .cloned()
        .collect()
}

fn monitor_key(m: &tauri::Monitor) -> (i32, i32, u32, u32) {
    (m.position().x, m.position().y, m.size().width, m.size().height)
}