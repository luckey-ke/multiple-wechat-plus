use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime};

use tauri::Manager;

// ========== 数据结构 ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandleInfo {
    installed: bool,
    date: Option<String>,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigStatus {
    handle: HandleInfo,
    wechat_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountInfo {
    id: String,
    logo: String,
    name: String,
    path: String,
    #[serde(rename = "isLogin")]
    is_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreData {
    #[serde(flatten)]
    data: std::collections::HashMap<String, serde_json::Value>,
}

// ========== 全局状态 ==========

struct AppState {
    store: Mutex<StoreData>,
    base_path: PathBuf,
    data_dir: PathBuf,
    store_path: PathBuf,
}

impl AppState {
    fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let base_path = home.join("multiple_wechat");
        let data_dir = base_path.join("data");
        let store_path = data_dir.join("store.json");

        fs::create_dir_all(&base_path).ok();
        fs::create_dir_all(&data_dir).ok();

        let store = if store_path.exists() {
            serde_json::from_str(&fs::read_to_string(&store_path).unwrap_or_default())
                .unwrap_or(StoreData { data: Default::default() })
        } else {
            StoreData { data: Default::default() }
        };

        AppState {
            store: Mutex::new(store),
            base_path,
            data_dir,
            store_path,
        }
    }

    fn store_get(&self, key: &str) -> Option<serde_json::Value> {
        let store = self.store.lock().unwrap();
        store.data.get(key).cloned()
    }

    fn store_set(&self, key: &str, value: serde_json::Value) {
        let mut store = self.store.lock().unwrap();
        store.data.insert(key.to_string(), value);
        let json = serde_json::to_string_pretty(&*store).unwrap_or_default();
        fs::write(&self.store_path, json).ok();
    }

    fn handle_exe_path(&self) -> PathBuf {
        self.base_path.join("handle.exe")
    }

    fn log(&self, level: &str, msg: &str) {
        let log_path = self.data_dir.join("app.log");
        let line = format!("{} [{}] {}\n", level, chrono_now(), msg);
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(line.as_bytes())
            })
            .ok();
    }
}

fn chrono_now() -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

// ========== 工具函数 ==========

fn get_wechat_file_path(state: &AppState) -> Option<String> {
    let stored = state.store_get("wechatFilePath").and_then(|v| v.as_str().map(String::from));
    let default_path = dirs::document_dir()
        .map(|d| d.join("xwechat_files").to_string_lossy().to_string())
        .unwrap_or_default();

    if let Some(ref p) = stored {
        if Path::new(p).exists() {
            return Some(p.clone());
        }
    }

    if Path::new(&default_path).exists() {
        Some(default_path)
    } else {
        None
    }
}

fn find_dir_name(base: &Path, name: &str) -> Option<PathBuf> {
    fs::read_dir(base).ok()?.filter_map(|e| e.ok()).find_map(|e| {
        let path = e.path();
        if path.is_dir() && path.to_string_lossy().contains(name) {
            Some(path)
        } else {
            None
        }
    })
}

fn is_account_logged_in(account_path: &Path) -> bool {
    let msg_folder = account_path.join("db_storage").join("message");
    if !msg_folder.exists() {
        return false;
    }
    let (mut shm_count, mut wal_count) = (0u32, 0u32);
    if let Ok(entries) = fs::read_dir(&msg_folder) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".db-shm") {
                shm_count += 1;
            } else if name.ends_with(".db-wal") {
                wal_count += 1;
            }
            if shm_count >= 4 && wal_count >= 4 {
                return true;
            }
        }
    }
    false
}

fn safe_unlink(path: &Path) -> bool {
    for i in 0..2u32 {
        if path.exists() {
            match fs::remove_file(path) {
                Ok(_) => return true,
                Err(_) if i == 0 => {
                    thread::sleep(Duration::from_millis(200));
                }
                Err(_) => return false,
            }
        } else {
            return true;
        }
    }
    true
}

// ========== handle.exe 操作 ==========

fn release_file_lock(handle_exe: &Path, file_path: &str) {
    if !handle_exe.exists() {
        return;
    }
    let output = StdCommand::new(handle_exe)
        .args(["-accepteula", "-p", "weixin", file_path])
        .output();
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return,
    };

    // 解析 handle 输出：pid: 1234 type: File 7AB: path
    let re_pattern = r"pid: (\d+)\s+type:.*?\s+([a-zA-Z0-9]+):";
    // 简单解析，不用 regex crate
    for line in stdout.lines() {
        if let Some((pid, handle_id)) = parse_handle_line(line) {
            let _ = StdCommand::new(handle_exe)
                .args(["-c", &handle_id, "-p", &pid, "-y"])
                .output();
        }
    }
}

fn parse_handle_line(line: &str) -> Option<(String, String)> {
    // 格式: pid: 1234 type: File 7AB: C:\path\to\file
    let pid_start = line.find("pid: ")? + 5;
    let pid_end = line[pid_start..].find(|c: char| !c.is_ascii_digit())? + pid_start;
    let pid = &line[pid_start..pid_end];

    // 找 handle id — 在 "type: xxx " 之后，":" 之前
    let type_pos = line.find("type: ")?;
    let after_type = &line[type_pos + 6..];
    let space_pos = after_type.find(' ')?;
    let after_space = &after_type[space_pos + 1..];
    let colon_pos = after_space.find(':')?;
    let handle_id = &after_space[..colon_pos];

    Some((pid.to_string(), handle_id.to_string()))
}

fn release_mutex(handle_exe: &Path) {
    if !handle_exe.exists() {
        return;
    }
    let mutex_name = "XWeChat_App_Instance_Identity_Mutex_Name";
    let output = StdCommand::new(handle_exe)
        .args(["-accepteula", "-p", "weixin", "-a", mutex_name])
        .output();
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return,
    };
    for line in stdout.lines() {
        if let Some((pid, handle_id)) = parse_handle_line(line) {
            // 用 PowerShell 提权关闭 handle
            let ps_cmd = format!(
                "Start-Process \"{}\" -ArgumentList @('-c','{}','-p','{}','-y') -Verb RunAs -Wait",
                handle_exe.display(),
                handle_id,
                pid
            );
            let _ = StdCommand::new("powershell")
                .args(["-Command", &ps_cmd])
                .output();
        }
    }
}

// ========== 注册表查询 ==========

fn query_wechat_install_path() -> Result<String, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey("Software\\Tencent\\Weixin")
        .map_err(|e| format!("注册表打开失败: {}", e))?;
    let install_path: String = key
        .get_value("InstallPath")
        .map_err(|e| format!("读取 InstallPath 失败: {}", e))?;
    Ok(install_path)
}

// ========== Tauri 命令 ==========

#[tauri::command]
fn get_config_status(state: tauri::State<AppState>) -> Result<ConfigStatus, String> {
    let handle_path = state.handle_exe_path();
    let handle_exists = handle_path.exists();
    let handle_date = if handle_exists {
        fs::metadata(&handle_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| format!("{}", d.as_secs()))
    } else {
        None
    };

    Ok(ConfigStatus {
        handle: HandleInfo {
            installed: handle_exists,
            date: handle_date,
            path: handle_path.to_string_lossy().to_string(),
        },
        wechat_path: get_wechat_file_path(&state),
    })
}

#[tauri::command]
fn get_wechat_list(state: tauri::State<AppState>) -> Result<Vec<AccountInfo>, String> {
    let wechat_file_path =
        get_wechat_file_path(&state).ok_or("请先设置微信文档路径")?;

    let config_dir = Path::new(&wechat_file_path)
        .join("all_users")
        .join("plugin_save_config");
    if !config_dir.exists() {
        return Ok(vec![]);
    }

    let order: Vec<String> = state
        .store_get("accountOrder")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let mut wx_map = std::collections::HashMap::new();

    if let Ok(entries) = fs::read_dir(&config_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let wxid = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let account_path = find_dir_name(Path::new(&wechat_file_path), &wxid);
            let is_login = account_path
                .as_ref()
                .map(|p| is_account_logged_in(p))
                .unwrap_or(false);

            wx_map.insert(
                wxid.clone(),
                AccountInfo {
                    id: wxid.clone(),
                    logo: path.join("logo.png").to_string_lossy().to_string(),
                    name: wxid,
                    path: path.to_string_lossy().to_string(),
                    is_login,
                },
            );
        }
    }

    let mut sorted = Vec::new();
    for id in &order {
        if let Some(acc) = wx_map.remove(id) {
            sorted.push(acc);
        }
    }
    for acc in wx_map.into_values() {
        sorted.push(acc);
    }

    Ok(sorted)
}

#[tauri::command]
fn set_wechat_file_path(state: tauri::State<AppState>, dir_path: String) -> Result<serde_json::Value, String> {
    let p = Path::new(&dir_path);
    if !p.exists() {
        return Ok(serde_json::json!({ "success": false, "message": "目录不存在" }));
    }

    let global_config = p.join("all_users").join("config").join("global_config");
    let plugin_config = p.join("all_users").join("plugin_save_config");
    if !global_config.exists() && !plugin_config.exists() {
        return Ok(serde_json::json!({ "success": false, "message": "该目录不是有效的微信文档目录" }));
    }

    state.store_set("wechatFilePath", serde_json::json!(dir_path));
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
async fn download_handle(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let handle_path = state.handle_exe_path();
    if handle_path.exists() {
        return Ok("已存在".to_string());
    }

    state.log("INFO", "开始下载 handle.exe...");
    let zip_path = state.base_path.join("Handle.zip");
    let url = "https://download.sysinternals.com/files/Handle.zip";

    let bytes = reqwest::blocking::get(url)
        .map_err(|e| format!("下载失败: {}", e))?
        .bytes()
        .map_err(|e| format!("读取失败: {}", e))?;

    fs::write(&zip_path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;

    // 解压
    let zip_file =
        fs::File::open(&zip_path).map_err(|e| format!("打开 ZIP 失败: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|e| format!("解析 ZIP 失败: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目失败: {}", e))?;
        let out_path = state.base_path.join(file.name());
        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).ok();
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("创建文件失败: {}", e))?;
            std::io::copy(&mut file, &mut out_file)
                .map_err(|e| format!("解压失败: {}", e))?;
        }
    }

    let _ = fs::remove_file(&zip_path);
    state.log("INFO", "handle.exe 下载解压成功");
    Ok("下载成功".to_string())
}

#[tauri::command]
async fn select_directory() -> Result<Option<String>, String> {
    // 通过前端 JS dialog API 处理，Rust 端作为 fallback
    Ok(None)
}

#[tauri::command]
async fn start_wechat(
    state: tauri::State<'_, AppState>,
    item_data: Option<AccountInfo>,
) -> Result<(), String> {
    let handle_exe = state.handle_exe_path();
    if !handle_exe.exists() {
        return Err("handle.exe 不存在，请先下载".to_string());
    }

    let wechat_file_path =
        get_wechat_file_path(&state).ok_or("请先设置微信文档路径")?;

    let config_dir = Path::new(&wechat_file_path)
        .join("all_users")
        .join("config");
    let config_path = config_dir.join("global_config");
    let crc_path = config_dir.join("global_config.crc");

    if let Some(ref item) = item_data {
        let item_path = Path::new(&item.path);
        if !item_path.exists() {
            return Err("微信账号信息不存在".to_string());
        }

        release_file_lock(&handle_exe, &config_path.to_string_lossy());
        release_file_lock(&handle_exe, &crc_path.to_string_lossy());

        let src_config = item_path.join("global_config");
        let src_crc = item_path.join("global_config.crc");

        // 尝试删除后复制
        let copied = safe_unlink(&config_path) && {
            safe_unlink(&crc_path);
            fs::copy(&src_config, &config_path).is_ok() && fs::copy(&src_crc, &crc_path).is_ok()
        };

        if !copied {
            // 兜底：rename 后复制
            if config_path.exists() {
                fs::rename(&config_path, config_path.with_extension("bak")).ok();
            }
            if crc_path.exists() {
                fs::rename(&crc_path, crc_path.with_extension("bak")).ok();
            }
            fs::copy(&src_config, &config_path)
                .map_err(|e| format!("无法替换配置文件: {}", e))?;
            fs::copy(&src_crc, &crc_path)
                .map_err(|e| format!("无法替换配置文件: {}", e))?;
        }
    } else {
        release_file_lock(&handle_exe, &config_path.to_string_lossy());
        release_file_lock(&handle_exe, &crc_path.to_string_lossy());
        safe_unlink(&config_path);
        safe_unlink(&crc_path);
    }

    release_mutex(&handle_exe);

    // 查询微信安装路径
    let install_path = query_wechat_install_path()
        .map_err(|e| format!("获取微信EXE路径失败: {}", e))?;
    let wechat_exe = Path::new(&install_path).join("Weixin.exe");
    if !wechat_exe.exists() {
        return Err(format!("微信EXE不存在: {}", wechat_exe.display()));
    }

    // 启动微信
    let _ = StdCommand::new(&wechat_exe).spawn();

    Ok(())
}

#[tauri::command]
fn save_wechat(state: tauri::State<AppState>) -> Result<AccountInfo, String> {
    let wechat_file_path =
        get_wechat_file_path(&state).ok_or("请先设置微信文档路径")?;

    let login_path = Path::new(&wechat_file_path)
        .join("all_users")
        .join("login");
    if !login_path.exists() {
        return Err("微信登录目录不存在".to_string());
    }

    // 找最新的登录目录
    let mut latest_time = 0u64;
    let mut latest_path: Option<PathBuf> = None;

    if let Ok(entries) = fs::read_dir(&login_path) {
        for entry in entries.flatten() {
            let dir_path = entry.path();
            if !dir_path.is_dir() {
                continue;
            }
            let shm = dir_path.join("key_info.db-shm");
            if shm.exists() {
                if let Ok(meta) = fs::metadata(&shm) {
                    if let Ok(modified) = meta.modified() {
                        let ts = modified
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                        if ts > latest_time {
                            latest_time = ts;
                            latest_path = Some(dir_path);
                        }
                    }
                }
            }
        }
    }

    let latest = latest_path.ok_or("未找到 key_info.db")?;
    let wxid = latest
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let wxid_path = Path::new(&wechat_file_path)
        .join("all_users")
        .join("plugin_save_config")
        .join(&wxid);
    fs::create_dir_all(&wxid_path).ok();

    let config_src = Path::new(&wechat_file_path)
        .join("all_users")
        .join("config")
        .join("global_config");
    let crc_src = config_src.with_extension("crc");

    if !config_src.exists() {
        return Err("global_config 不存在".to_string());
    }

    fs::copy(&config_src, wxid_path.join("global_config"))
        .map_err(|e| format!("复制 global_config 失败: {}", e))?;
    fs::copy(&crc_src, wxid_path.join("global_config.crc"))
        .map_err(|e| format!("复制 global_config.crc 失败: {}", e))?;

    // 复制头像
    let head_img_dir = Path::new(&wechat_file_path)
        .join("all_users")
        .join("head_imgs")
        .join("0");
    if head_img_dir.exists() {
        if let Some(img_path) = find_latest_image(&head_img_dir) {
            fs::copy(&img_path, wxid_path.join("logo.png")).ok();
        }
    }

    let account_path = find_dir_name(Path::new(&wechat_file_path), &wxid);
    let is_login = account_path
        .as_ref()
        .map(|p| is_account_logged_in(p))
        .unwrap_or(false);

    let wx_data = AccountInfo {
        id: wxid.clone(),
        logo: wxid_path.join("logo.png").to_string_lossy().to_string(),
        name: wxid,
        path: wxid_path.to_string_lossy().to_string(),
        is_login,
    };

    state.store_set(
        &format!("wx_{}", wx_data.id),
        serde_json::to_value(&wx_data).unwrap_or_default(),
    );

    Ok(wx_data)
}

fn find_latest_image(dir: &Path) -> Option<PathBuf> {
    let mut latest_time = 0u64;
    let mut latest_path = None;
    find_latest_image_recursive(dir, &mut latest_time, &mut latest_path);
    latest_path
}

fn find_latest_image_recursive(dir: &Path, best_time: &mut u64, best_path: &mut Option<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                find_latest_image_recursive(&path, best_time, best_path);
            } else if let Ok(meta) = fs::metadata(&path) {
                if let Ok(modified) = meta.modified() {
                    let ts = modified
                        .duration_since(SystemTime::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    if ts > *best_time {
                        *best_time = ts;
                        *best_path = Some(path);
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn delete_wechat(state: tauri::State<AppState>, item_data: AccountInfo) -> Result<(), String> {
    let path = Path::new(&item_data.path);
    if !path.exists() {
        return Err("微信账号信息不存在".to_string());
    }
    fs::remove_dir_all(path).map_err(|e| format!("删除失败: {}", e))?;
    // 清理 store
    let key = format!("wx_{}", item_data.id);
    let mut store = state.store.lock().unwrap();
    store.data.remove(&key);
    let json = serde_json::to_string_pretty(&*store).unwrap_or_default();
    fs::write(&state.store_path, json).ok();
    Ok(())
}

#[tauri::command]
fn get_account_order(state: tauri::State<AppState>) -> Vec<String> {
    state
        .store_get("accountOrder")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_account_order(state: tauri::State<AppState>, order: Vec<String>) {
    state.store_set("accountOrder", serde_json::json!(order));
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = StdCommand::new("explorer").arg(&path).spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = StdCommand::new("xdg-open").arg(&path).spawn();
    }
    Ok(())
}

// ========== 入口 ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            get_config_status,
            get_wechat_list,
            set_wechat_file_path,
            download_handle,
            select_directory,
            start_wechat,
            save_wechat,
            delete_wechat,
            get_account_order,
            save_account_order,
            open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
