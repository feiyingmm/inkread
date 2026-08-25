use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RepoEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    /// 单文件打开创建的临时文库,不持久化
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ephemeral: bool,
}

#[derive(Default)]
pub struct AppState {
    pub repos: Mutex<Vec<RepoEntry>>,
    /// 本次进程启动时随命令行传入的 md 文件(双击/打开方式)
    pub launch_file: Mutex<Option<String>>,
}

fn config_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("无法获取应用配置目录");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn repos_file(app: &AppHandle) -> PathBuf {
    config_dir(app).join("repos.json")
}

fn tokens_file(app: &AppHandle) -> PathBuf {
    config_dir(app).join("tokens.json")
}

pub fn load_repos(app: &AppHandle) -> Vec<RepoEntry> {
    let file = repos_file(app);
    if let Ok(text) = fs::read_to_string(&file) {
        if let Ok(list) = serde_json::from_str::<Vec<RepoEntry>>(&text) {
            return list;
        }
    }
    Vec::new()
}

pub fn save_repos(app: &AppHandle, repos: &[RepoEntry]) -> Result<(), String> {
    let persistent: Vec<&RepoEntry> = repos.iter().filter(|r| !r.ephemeral).collect();
    let text = serde_json::to_string_pretty(&persistent).map_err(|e| e.to_string())?;
    fs::write(repos_file(app), text).map_err(|e| e.to_string())
}

pub fn load_tokens(app: &AppHandle) -> std::collections::HashMap<String, String> {
    let file = tokens_file(app);
    if let Ok(text) = fs::read_to_string(&file) {
        if let Ok(map) = serde_json::from_str(&text) {
            return map;
        }
    }
    Default::default()
}

pub fn save_tokens(
    app: &AppHandle,
    map: &std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let text = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(tokens_file(app), text).map_err(|e| e.to_string())
}

/// 按仓库 id 找到本地路径
pub fn repo_path(app: &AppHandle, repo_id: &str) -> Result<PathBuf, String> {
    let state = app.state::<AppState>();
    let repos = state.repos.lock().map_err(|e| e.to_string())?;
    repos
        .iter()
        .find(|r| r.id == repo_id)
        .map(|r| PathBuf::from(&r.path))
        .ok_or_else(|| format!("未知仓库: {repo_id}"))
}

/// 仓库内相对路径 → 绝对路径,并防止路径穿越
pub fn resolve_in_repo(root: &PathBuf, rel: &str) -> Result<PathBuf, String> {
    let cleaned = rel.trim_start_matches(['/', '\\']);
    let mut abs = root.clone();
    for seg in cleaned.split(['/', '\\']) {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err("路径越界".into());
        }
        abs.push(seg);
    }
    Ok(abs)
}
