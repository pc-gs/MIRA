use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    sync::Mutex,
    thread,
    time::Duration,
};

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSStatusWindowLevel, NSWindow, NSWindowSharingType};
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;

const TOOLBAR_POSITION_FILE: &str = "toolbar-position.json";
const TOOLBAR_LOGICAL_WIDTH_DEFAULT: f64 = 696.0;
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

/// Overlay labels that were hidden before zoom and must be hidden again on exit.
#[derive(Default)]
struct ZoomState {
    shown_for_zoom: Mutex<HashSet<String>>,
}

/// Presenter mode: overlays stay click-through, holding ⌥ temporarily captures the mouse
/// ("quick draw"), and optional click highlights are emitted to overlays.
struct PresenterState {
    enabled: AtomicBool,
    click_highlight: AtomicBool,
    /// Last value passed to `set_overlay_passthrough` (true = draw mode off).
    draw_passthrough: AtomicBool,
    quick_draw_active: AtomicBool,
}

impl Default for PresenterState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            click_highlight: AtomicBool::new(false),
            draw_passthrough: AtomicBool::new(true),
            quick_draw_active: AtomicBool::new(false),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
struct QuickDrawPayload {
    active: bool,
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
fn set_overlay_passthrough(
    app: AppHandle,
    presenter: tauri::State<'_, PresenterState>,
    pass_through: bool,
) -> Result<(), String> {
    presenter.draw_passthrough.store(pass_through, Ordering::SeqCst);
    // Draw mode taking over (or leaving) supersedes any ⌥ quick draw in progress
    end_quick_draw(&app, &presenter);
    for label in overlay_labels(&app) {
        if let Some(overlay) = app.get_webview_window(&label) {
            overlay
                .set_ignore_cursor_events(pass_through)
                .map_err(|e| e.to_string())?;
        }
    }
    if !pass_through {
        // Give the overlay under the cursor keyboard focus so single-key draw
        // shortcuts (colors, tools, sizes) work without clicking it first
        focus_overlay_under_cursor(&app);
    }
    Ok(())
}

fn focus_overlay_under_cursor(app: &AppHandle) {
    let Ok(cursor) = app.cursor_position() else { return };
    for label in overlay_labels(app) {
        let Some(overlay) = app.get_webview_window(&label) else { continue };
        let (Ok(pos), Ok(size)) = (overlay.outer_position(), overlay.outer_size()) else { continue };
        let inside = cursor.x >= pos.x as f64
            && cursor.y >= pos.y as f64
            && cursor.x < pos.x as f64 + size.width as f64
            && cursor.y < pos.y as f64 + size.height as f64;
        if inside {
            let _ = overlay.set_focus();
            return;
        }
    }
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

/// Capture the calling overlay's monitor and make the overlay interactive for zooming.
/// Returns `[width u32 LE][height u32 LE][RGBA pixels]`.
#[tauri::command]
async fn begin_zoom(
    window: WebviewWindow,
    state: tauri::State<'_, ZoomState>,
) -> Result<tauri::ipc::Response, String> {
    let (width, height, pixels) = capture_window_monitor(&window)?;

    if !window.is_visible().unwrap_or(true) {
        state
            .shown_for_zoom
            .lock()
            .map_err(|e| e.to_string())?
            .insert(window.label().to_string());
        window.show().map_err(|e| e.to_string())?;
    }
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    let _ = window.set_focus();

    let mut bytes = Vec::with_capacity(8 + pixels.len());
    bytes.extend_from_slice(&width.to_le_bytes());
    bytes.extend_from_slice(&height.to_le_bytes());
    bytes.extend_from_slice(&pixels);
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn end_zoom(
    window: WebviewWindow,
    state: tauri::State<'_, ZoomState>,
    pass_through: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(pass_through)
        .map_err(|e| e.to_string())?;
    let was_hidden = state
        .shown_for_zoom
        .lock()
        .map_err(|e| e.to_string())?
        .remove(window.label());
    if was_hidden {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn capture_window_monitor(window: &WebviewWindow) -> Result<(u32, u32, Vec<u8>), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no monitor for overlay")?;
    // xcap works in CoreGraphics points; Tauri reports physical pixels.
    let scale = monitor.scale_factor();
    let cx = (monitor.position().x as f64 + monitor.size().width as f64 / 2.0) / scale;
    let cy = (monitor.position().y as f64 + monitor.size().height as f64 / 2.0) / scale;
    let target = xcap::Monitor::from_point(cx as i32, cy as i32).map_err(|e| e.to_string())?;
    let image = target.capture_image().map_err(|e| {
        format!("Screen capture failed. Allow Screen Recording for Mira in System Settings. ({e})")
    })?;
    Ok((image.width(), image.height(), image.into_raw()))
}

#[cfg(not(target_os = "macos"))]
fn capture_window_monitor(_window: &WebviewWindow) -> Result<(u32, u32, Vec<u8>), String> {
    Err("Zoom is only available on macOS".to_string())
}

#[tauri::command]
fn set_presenter_mode(app: AppHandle, presenter: tauri::State<'_, PresenterState>, enabled: bool) {
    presenter.enabled.store(enabled, Ordering::SeqCst);
    if !enabled {
        end_quick_draw(&app, &presenter);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_toolbar_size(app: AppHandle, width: f64, height: Option<f64>) -> Result<(), String> {
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
    let target_h = height.unwrap_or(TOOLBAR_LOGICAL_HEIGHT);

    let toolbar_w_phys = (width * scale) as i32;
    let toolbar_h_phys = (target_h * scale) as i32;

    toolbar
        .set_size(tauri::Size::Logical(tauri::LogicalSize {
            width,
            height: target_h,
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

    if target_h <= TOOLBAR_LOGICAL_HEIGHT {
        let _ = save_toolbar_position(app, clamped.x, clamped.y);
    }
    Ok(())
}

#[tauri::command]
fn set_toolbar_width(app: AppHandle, width: f64) -> Result<(), String> {
    set_toolbar_size(app, width, None)
}

// ── Entry Point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(MacosLauncher::LaunchAgent)
                .build(),
        )
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
            set_toolbar_size,
            begin_zoom,
            end_zoom,
            set_presenter_mode,
        ])
        .manage(ZoomState::default())
        .manage(PresenterState::default())
        .setup(|app| {
            setup_windows(app)?;
            if let Err(e) = setup_tray(app) {
                eprintln!("Menu bar icon unavailable: {e}");
            }
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

    // Keep the toolbar above overlays and out of screen sharing / zoom captures
    apply_toolbar_window_style(&toolbar);

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
        Shortcut::new(ctrl_shift, Code::KeyL), // laser pointer
        Shortcut::new(ctrl_shift, Code::KeyM), // zoom
        Shortcut::new(ctrl_shift, Code::KeyH), // show/hide toolbar
        Shortcut::new(ctrl_shift, Code::KeyP), // presenter mode
        Shortcut::new(ctrl_shift, Code::KeyF), // fading ink
    ])?;
    Ok(())
}

/// macOS: status window level (above overlays) and excluded from screen capture,
/// so the audience in a screen share — and the zoom snapshot — never sees the toolbar.
fn apply_toolbar_window_style(toolbar: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(ns_window) = toolbar.ns_window() {
            let ns_window = ns_window as *mut AnyObject;
            let ns_window: Option<Retained<NSWindow>> = unsafe { Retained::retain(ns_window.cast()) };
            if let Some(ns_window) = ns_window {
                ns_window.setLevel(NSStatusWindowLevel);
                ns_window.setSharingType(NSWindowSharingType::None);
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = toolbar;
}

fn raise_toolbar(app: &AppHandle) {
    if let Some(toolbar) = app.get_webview_window("toolbar") {
        apply_toolbar_window_style(&toolbar);
        let _ = toolbar.set_always_on_top(false);
        let _ = toolbar.set_always_on_top(true);
    }
}

fn toggle_toolbar_visibility(app: &AppHandle) {
    let Some(toolbar) = app.get_webview_window("toolbar") else {
        return;
    };
    if toolbar.is_visible().unwrap_or(true) {
        let _ = toolbar.hide();
    } else {
        let _ = toolbar.show();
        raise_toolbar(app);
    }
}

fn emit_zoom_toggle(app: &AppHandle) {
    // Each overlay decides whether the cursor is on its monitor
    for label in overlay_labels(app) {
        let _ = app.emit_to(&label, "zoom-toggle", ());
    }
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);

    let toolbar_item = MenuItem::with_id(app, "toolbar", "Show/Hide Toolbar (⌃⇧H)", true, None::<&str>)?;
    let overlay_item = MenuItem::with_id(app, "overlay", "Toggle Overlay (⌃⇧X)", true, None::<&str>)?;
    let draw_item = MenuItem::with_id(app, "draw", "Draw Mode (⌃⇧D)", true, None::<&str>)?;
    let laser_item = MenuItem::with_id(app, "laser", "Laser (⌃⇧L)", true, None::<&str>)?;
    let spotlight_item = MenuItem::with_id(app, "spotlight", "Spotlight (⌃⇧S)", true, None::<&str>)?;
    let presenter_item = MenuItem::with_id(app, "presenter", "Presenter Mode (⌃⇧P)", true, None::<&str>)?;
    let click_item = CheckMenuItem::with_id(app, "clicks", "Highlight Clicks", true, false, None::<&str>)?;
    let zoom_item = MenuItem::with_id(app, "zoom", "Zoom (⌃⇧M)", true, None::<&str>)?;
    let fade_item = MenuItem::with_id(app, "fade", "Fading Ink (⌃⇧F)", true, None::<&str>)?;
    let login_item = CheckMenuItem::with_id(
        app,
        "login",
        "Open at Login",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Mira", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toolbar_item,
            &overlay_item,
            &draw_item,
            &laser_item,
            &spotlight_item,
            &presenter_item,
            &click_item,
            &zoom_item,
            &fade_item,
            &PredefinedMenuItem::separator(app)?,
            &login_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let login_item_handle = login_item.clone();
    let click_item_handle = click_item.clone();
    let mut builder = TrayIconBuilder::with_id("mira")
        .tooltip("Mira")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toolbar" => toggle_toolbar_visibility(app),
            "overlay" => {
                let _ = app.emit_to("toolbar", "shortcut-toggle", ());
            }
            "draw" => {
                let _ = app.emit_to("toolbar", "shortcut-draw-toggle", ());
            }
            "laser" => {
                let _ = app.emit_to("toolbar", "shortcut-laser", ());
            }
            "spotlight" => {
                let _ = app.emit_to("toolbar", "shortcut-spotlight", ());
            }
            "presenter" => {
                let _ = app.emit_to("toolbar", "shortcut-presenter", ());
            }
            "clicks" => {
                let presenter = app.state::<PresenterState>();
                let enabled = !presenter.click_highlight.load(Ordering::SeqCst);
                presenter.click_highlight.store(enabled, Ordering::SeqCst);
                // The menu toggles its checkmark on click; resync with the real state
                let _ = click_item_handle.set_checked(enabled);
            }
            "zoom" => emit_zoom_toggle(app),
            "fade" => {
                let _ = app.emit_to("toolbar", "shortcut-fade", ());
            }
            "login" => {
                let autolaunch = app.autolaunch();
                let currently = autolaunch.is_enabled().unwrap_or(false);
                let result = if currently {
                    autolaunch.disable()
                } else {
                    autolaunch.enable()
                };
                if let Err(e) = result {
                    eprintln!("Failed to change Open at Login: {e}");
                }
                // The menu toggles its checkmark on click; resync with the real state
                let _ = login_item_handle.set_checked(autolaunch.is_enabled().unwrap_or(currently));
            }
            "quit" => app.exit(0),
            _ => {}
        });
    // Monochrome template glyph so macOS tints it like other menu bar icons
    match tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png")) {
        Ok(icon) => builder = builder.icon(icon).icon_as_template(true),
        Err(_) => {
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
        }
    }
    builder.build(app)?;
    Ok(())
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
        Code::KeyL => {
            let _ = app.emit_to("toolbar", "shortcut-laser", ());
        }
        Code::KeyM => emit_zoom_toggle(app),
        Code::KeyH => toggle_toolbar_visibility(app),
        Code::KeyP => {
            let _ = app.emit_to("toolbar", "shortcut-presenter", ());
        }
        Code::KeyF => {
            let _ = app.emit_to("toolbar", "shortcut-fade", ());
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

/// Make overlays capture the mouse while ⌥ is held (presenter mode). Acts only on the
/// inactive→active transition.
fn begin_quick_draw(app: &AppHandle, presenter: &PresenterState) {
    if presenter
        .quick_draw_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    for label in overlay_labels(app) {
        if let Some(overlay) = app.get_webview_window(&label) {
            let _ = overlay.set_ignore_cursor_events(false);
        }
        let _ = app.emit_to(&label, "quick-draw", QuickDrawPayload { active: true });
    }
}

/// Leave quick draw: tell overlays first (so they finish the stroke), then restore the
/// click-through state that draw mode asked for. Acts only on the active→inactive transition.
fn end_quick_draw(app: &AppHandle, presenter: &PresenterState) {
    if !presenter.quick_draw_active.swap(false, Ordering::SeqCst) {
        return;
    }
    let pass_through = presenter.draw_passthrough.load(Ordering::SeqCst);
    for label in overlay_labels(app) {
        let _ = app.emit_to(&label, "quick-draw", QuickDrawPayload { active: false });
        if let Some(overlay) = app.get_webview_window(&label) {
            let _ = overlay.set_ignore_cursor_events(pass_through);
        }
    }
}

/// Global input state for presenter mode: (⌥ held without ⌘/⌃, left mouse button down).
/// `NSEvent`'s class-level `modifierFlags` / `pressedMouseButtons` report the current
/// hardware state, need no Accessibility permission, and are not main-thread-only.
#[cfg(target_os = "macos")]
fn read_presenter_input() -> (bool, bool) {
    let flags = NSEvent::modifierFlags_class();
    let option_only = flags.contains(NSEventModifierFlags::Option)
        && !flags.contains(NSEventModifierFlags::Command)
        && !flags.contains(NSEventModifierFlags::Control);
    let left_down = NSEvent::pressedMouseButtons() & 1 == 1;
    (option_only, left_down)
}

#[cfg(not(target_os = "macos"))]
fn read_presenter_input() -> (bool, bool) {
    (false, false)
}

fn start_cursor_polling(app: AppHandle, mut overlays: Vec<OverlayWindowInfo>) {
    let app_handle = app.clone();
    thread::spawn(move || {
        let mut last_monitor_check = std::time::Instant::now();
        let mut last = vec![(f64::MIN, f64::MIN); overlays.len()];
        let mut next_overlay_id = overlays.len() + 1;
        let mut left_was_down = false;

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

            // Presenter mode: ⌥ quick draw + click highlights
            let presenter = app_handle.state::<PresenterState>();
            let (option_held, left_down) = read_presenter_input();
            let presenting = presenter.enabled.load(Ordering::SeqCst);
            let want_quick_draw =
                presenting && option_held && presenter.draw_passthrough.load(Ordering::SeqCst);
            if want_quick_draw {
                begin_quick_draw(&app_handle, &presenter);
            } else {
                end_quick_draw(&app_handle, &presenter);
            }
            let clicked = left_down && !left_was_down;
            left_was_down = left_down;
            let emit_click = clicked
                && presenting
                && presenter.click_highlight.load(Ordering::SeqCst)
                && !presenter.quick_draw_active.load(Ordering::SeqCst);

            if let Ok(pos) = app_handle.cursor_position() {
                for (idx, overlay) in overlays.iter().enumerate() {
                    // Convert screen-physical coords to this overlay's logical coords.
                    let x = (pos.x - overlay.monitor_x as f64) / overlay.scale;
                    let y = (pos.y - overlay.monitor_y as f64) / overlay.scale;
                    if (x - last[idx].0).abs() > 0.25 || (y - last[idx].1).abs() > 0.25 {
                        last[idx] = (x, y);
                        let _ = app_handle.emit_to(&overlay.label, "cursor-moved", CursorMovedPayload { x, y });
                    }
                    if emit_click {
                        let _ = app_handle.emit_to(&overlay.label, "mouse-clicked", CursorMovedPayload { x, y });
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