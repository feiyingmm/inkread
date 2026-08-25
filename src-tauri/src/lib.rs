mod fsops;
mod gitops;
mod state;

use percent_encoding::percent_decode_str;
use serde::Serialize;
use state::{AppState, RepoEntry};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoMeta {
    id: String,
    name: String,
}

#[tauri::command]
fn list_repos(state: State<AppState>) -> Result<Vec<RepoMeta>, String> {
    let repos = state.repos.lock().map_err(|e| e.to_string())?;
    Ok(repos
        .iter()
        .map(|r| RepoMeta {
            id: r.id.clone(),
            name: r.name.clone(),
        })
        .collect())
}

#[tauri::command]
fn add_repo_local(app: AppHandle, state: State<AppState>, path: String) -> Result<RepoMeta, String> {
    let p = PathBuf::from(&path);
    if !p.join(".git").exists() {
        return Err("所选目录不是 git 仓库(缺少 .git)".into());
    }
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".into());
    let mut repos = state.repos.lock().map_err(|e| e.to_string())?;
    if repos.iter().any(|r| r.path == path) {
        return Err("该仓库已添加".into());
    }
    let mut id = name.clone();
    let mut n = 1;
    while repos.iter().any(|r| r.id == id) {
        n += 1;
        id = format!("{name}-{n}");
    }
    repos.push(RepoEntry {
        id: id.clone(),
        name: name.clone(),
        path,
    });
    state::save_repos(&app, &repos)?;
    Ok(RepoMeta { id, name })
}

#[tauri::command]
fn add_repo_clone(
    app: AppHandle,
    state: State<AppState>,
    url: String,
    token: Option<String>,
) -> Result<RepoMeta, String> {
    let trimmed = url.trim().trim_end_matches('/');
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
        return Err("仅支持 HTTPS 仓库地址".into());
    }
    let name = trimmed
        .trim_end_matches(".git")
        .rsplit('/')
        .next()
        .unwrap_or("repo")
        .to_string();
    // 私有仓库 token 先按 host 保存,克隆与后续 pull 共用
    if let Some(t) = token.as_deref() {
        if !t.is_empty() {
            if let Some(host) = trimmed.split("://").nth(1).and_then(|s| s.split('/').next()) {
                let mut map = state::load_tokens(&app);
                map.insert(host.to_string(), t.to_string());
                state::save_tokens(&app, &map)?;
            }
        }
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("repos");
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let dest = base.join(&name);
    if dest.exists() {
        return Err(format!("目录已存在: {}", dest.display()));
    }
    gitops::clone(trimmed, &dest, state::load_tokens(&app))?;

    let mut repos = state.repos.lock().map_err(|e| e.to_string())?;
    let mut id = name.clone();
    let mut n = 1;
    while repos.iter().any(|r| r.id == id) {
        n += 1;
        id = format!("{name}-{n}");
    }
    repos.push(RepoEntry {
        id: id.clone(),
        name: name.clone(),
        path: dest.to_string_lossy().to_string(),
    });
    state::save_repos(&app, &repos)?;
    Ok(RepoMeta { id, name })
}

#[tauri::command]
fn list_tree(app: AppHandle, repo_id: String) -> Result<Vec<fsops::TreeNode>, String> {
    let root = state::repo_path(&app, &repo_id)?;
    fsops::build_tree(&root, "")
}

#[tauri::command]
fn read_file(app: AppHandle, repo_id: String, path: String) -> Result<fsops::FileContent, String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    fsops::read_file(&abs)
}

#[tauri::command]
fn write_file(app: AppHandle, repo_id: String, path: String, content: String) -> Result<(), String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    fsops::write_file(&abs, &content)
}

#[tauri::command]
fn git_status(app: AppHandle, repo_id: String) -> Result<gitops::GitStatusOut, String> {
    let root = state::repo_path(&app, &repo_id)?;
    gitops::status(&root)
}

#[tauri::command]
fn git_pull(app: AppHandle, repo_id: String) -> Result<gitops::GitOpResult, String> {
    let root = state::repo_path(&app, &repo_id)?;
    gitops::pull(&root, state::load_tokens(&app))
}

#[tauri::command]
fn git_sync(
    app: AppHandle,
    repo_id: String,
    message: Option<String>,
) -> Result<gitops::GitOpResult, String> {
    let root = state::repo_path(&app, &repo_id)?;
    gitops::sync(
        &root,
        message.as_deref().unwrap_or("docs: 更新文档"),
        state::load_tokens(&app),
    )
}

#[tauri::command]
fn git_pull_force(app: AppHandle, repo_id: String) -> Result<gitops::GitOpResult, String> {
    let root = state::repo_path(&app, &repo_id)?;
    gitops::pull_force(&root, state::load_tokens(&app))
}

#[tauri::command]
fn search_repo(app: AppHandle, repo_id: String, query: String) -> Result<Vec<fsops::SearchHit>, String> {
    let root = state::repo_path(&app, &repo_id)?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    fsops::search(&root, query.trim())
}

#[tauri::command]
fn save_token(app: AppHandle, host: String, token: String) -> Result<(), String> {
    let mut map = state::load_tokens(&app);
    if token.is_empty() {
        map.remove(&host);
    } else {
        map.insert(host, token);
    }
    state::save_tokens(&app, &map)
}

#[tauri::command]
fn get_token(app: AppHandle, host: String) -> Result<Option<String>, String> {
    Ok(state::load_tokens(&app).get(&host).cloned())
}

fn guess_mime(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// repo://<repoId>/<相对路径> → 仓库内文件字节(图片等资源渲染)
fn serve_repo_asset(app: &AppHandle, uri_path: &str) -> Result<(Vec<u8>, &'static str), String> {
    let decoded = percent_decode_str(uri_path).decode_utf8_lossy().to_string();
    let trimmed = decoded.trim_start_matches('/');
    let (repo_id, rel) = trimmed
        .split_once('/')
        .ok_or_else(|| "路径格式错误".to_string())?;
    let root = state::repo_path(app, repo_id)?;
    let abs = state::resolve_in_repo(&root, rel)?;
    let bytes = std::fs::read(&abs).map_err(|e| e.to_string())?;
    Ok((bytes, guess_mime(rel)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .register_uri_scheme_protocol("repo", |ctx, request| {
            let app = ctx.app_handle();
            match serve_repo_asset(app, request.uri().path()) {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(bytes)
                    .unwrap(),
                Err(e) => tauri::http::Response::builder()
                    .status(404)
                    .body(e.into_bytes())
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_repos,
            add_repo_local,
            add_repo_clone,
            list_tree,
            read_file,
            write_file,
            git_status,
            git_pull,
            git_pull_force,
            git_sync,
            search_repo,
            save_token,
            get_token
        ])
        .setup(|app| {
            let loaded = state::load_repos(app.handle());
            let state = app.state::<AppState>();
            *state.repos.lock().unwrap() = loaded;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("墨阅启动失败");
}
