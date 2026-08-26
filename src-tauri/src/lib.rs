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
fn list_repos(state: State<'_, AppState>) -> Result<Vec<RepoMeta>, String> {
    let repos = state.repos.lock().map_err(|e| e.to_string())?;
    Ok(repos
        .iter()
        .map(|r| RepoMeta {
            id: r.id.clone(),
            name: r.name.clone(),
        })
        .collect())
}

#[tauri::command(async)]
fn add_repo_local(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<RepoMeta, String> {
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
        ephemeral: false,
    });
    state::save_repos(&app, &repos)?;
    Ok(RepoMeta { id, name })
}

/// 从文库列表移除一条记录。**只摘注册表,不删磁盘上的任何文件**——
/// 克隆来的仓库也一样保留在原处,用户想彻底删除请自行删目录。
#[tauri::command]
fn remove_repo(app: AppHandle, state: State<'_, AppState>, repo_id: String) -> Result<(), String> {
    let mut repos = state.repos.lock().map_err(|e| e.to_string())?;
    let before = repos.len();
    repos.retain(|r| r.id != repo_id);
    if repos.len() == before {
        return Err(format!("未知仓库: {repo_id}"));
    }
    state::save_repos(&app, &repos)
}

#[tauri::command(async)]
fn add_repo_clone(
    app: AppHandle,
    state: State<'_, AppState>,
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
        ephemeral: false,
    });
    state::save_repos(&app, &repos)?;
    Ok(RepoMeta { id, name })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedPath {
    repo_id: String,
    path: String,
}

/// 双击/「打开方式」进入的单文件:以文件所在目录建临时文库(不持久化,复用同目录条目)
#[tauri::command(async)]
fn open_path(state: State<'_, AppState>, path: String) -> Result<OpenedPath, String> {
    let abs = std::path::PathBuf::from(&path);
    if !abs.is_file() {
        return Err(format!("文件不存在: {path}"));
    }
    let dir = abs
        .parent()
        .ok_or_else(|| "无法确定文件所在目录".to_string())?
        .to_path_buf();
    let file_name = abs
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "无法解析文件名".to_string())?;
    let dir_str = dir.to_string_lossy().to_string();

    let mut repos = state.repos.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = repos.iter().find(|r| r.path == dir_str) {
        return Ok(OpenedPath {
            repo_id: existing.id.clone(),
            path: file_name,
        });
    }
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "文件夹".into());
    let mut id = format!("{name}(临时)");
    let mut n = 1;
    while repos.iter().any(|r| r.id == id) {
        n += 1;
        id = format!("{name}(临时{n})");
    }
    repos.push(RepoEntry {
        id: id.clone(),
        name: id.clone(),
        path: dir_str,
        ephemeral: true,
    });
    Ok(OpenedPath { repo_id: id, path: file_name })
}

/// 取出本次进程启动时随命令行传入的 md 文件路径(消费一次)
#[tauri::command]
fn take_launch_file(state: State<'_, AppState>) -> Option<String> {
    state.launch_file.lock().ok()?.take()
}

/// 新窗口 label 计数器。窗口全关后计数不回退,避免复用 label 撞上尚未销毁的窗口。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
static NEXT_WINDOW_SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

/// 新开一个墨阅窗口,并登记它开机要打开的目标(前端启动时用 take_window_target 取走)。
/// 多窗口共用同一进程,因此文库注册表、令牌只有一份,不存在并发写覆盖。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_window(app: &AppHandle, target: state::WindowTarget) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    let seq = NEXT_WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
    let label = format!("w{seq}");
    {
        let st = app.state::<AppState>();
        let mut map = st.window_targets.lock().map_err(|e| e.to_string())?;
        map.insert(label.clone(), target);
    }
    tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("墨阅")
        .inner_size(1280.0, 820.0)
        .min_inner_size(760.0, 500.0)
        .center()
        .build()
        .map_err(|e| format!("新窗口创建失败: {e}"))?;
    Ok(())
}

/// 应用内「以新窗口打开」。Android 无多窗口,直接报错由前端拦住(菜单项本就不显示)。
#[tauri::command]
fn open_new_window(_app: AppHandle, _target: state::WindowTarget) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        return spawn_window(&_app, _target);
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    Err("移动端不支持多窗口".into())
}

/// 取走本窗口开机要打开的目标(只能取一次)。主窗口通常没有,返回 null。
#[tauri::command]
fn take_window_target(
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<Option<state::WindowTarget>, String> {
    let mut map = state.window_targets.lock().map_err(|e| e.to_string())?;
    Ok(map.remove(window.label()))
}

fn pick_md_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|a| {
        let lower = a.to_lowercase();
        (lower.ends_with(".md") || lower.ends_with(".markdown")) && std::path::Path::new(a).is_file()
    })
}

#[tauri::command(async)]
fn list_tree(app: AppHandle, repo_id: String) -> Result<Vec<fsops::TreeNode>, String> {
    let root = state::repo_path(&app, &repo_id)?;
    fsops::build_tree(&root, "")
}

#[tauri::command(async)]
fn read_file(app: AppHandle, repo_id: String, path: String) -> Result<fsops::FileContent, String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    fsops::read_file(&abs)
}

#[tauri::command(async)]
fn write_file(app: AppHandle, repo_id: String, path: String, content: String) -> Result<(), String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    fsops::write_file(&abs, &content)
}

#[tauri::command(async)]
fn write_binary(app: AppHandle, repo_id: String, path: String, base64: String) -> Result<(), String> {
    use base64::Engine;
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("图片数据解码失败: {e}"))?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs, bytes).map_err(|e| format!("写入失败: {e}"))
}

/// 新建空文档(父目录自动创建;已存在则拒绝)
#[tauri::command(async)]
fn create_file(app: AppHandle, repo_id: String, path: String) -> Result<(), String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    if abs.exists() {
        return Err("同名文件已存在".into());
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs, "").map_err(|e| format!("创建失败: {e}"))
}

/// 新建文件夹;内置 .gitkeep 占位(空目录进不了 git,多端同步会丢)
#[tauri::command(async)]
fn create_dir(app: AppHandle, repo_id: String, path: String) -> Result<(), String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    if abs.exists() {
        return Err("同名目录已存在".into());
    }
    std::fs::create_dir_all(&abs).map_err(|e| format!("创建失败: {e}"))?;
    std::fs::write(abs.join(".gitkeep"), "").map_err(|e| e.to_string())
}

/// 重命名文件或文件夹(仓库内移动)
#[tauri::command(async)]
fn rename_entry(app: AppHandle, repo_id: String, from: String, to: String) -> Result<(), String> {
    let root = state::repo_path(&app, &repo_id)?;
    let src = state::resolve_in_repo(&root, &from)?;
    let dst = state::resolve_in_repo(&root, &to)?;
    if !src.exists() {
        return Err("源文件不存在".into());
    }
    if dst.exists() {
        return Err("目标名称已存在".into());
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("重命名失败: {e}"))
}

/// 删除文件或文件夹(文件夹递归删除);不允许删仓库根
#[tauri::command(async)]
fn delete_entry(app: AppHandle, repo_id: String, path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("不能删除仓库根目录".into());
    }
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    if !abs.exists() {
        return Err("目标不存在".into());
    }
    if abs.is_dir() {
        std::fs::remove_dir_all(&abs).map_err(|e| format!("删除失败: {e}"))
    } else {
        std::fs::remove_file(&abs).map_err(|e| format!("删除失败: {e}"))
    }
}

#[tauri::command(async)]
fn git_status(app: AppHandle, repo_id: String) -> Result<gitops::GitStatusOut, String> {
    let root = state::repo_path(&app, &repo_id)?;
    gitops::status(&root)
}

#[tauri::command(async)]
fn git_pull(app: AppHandle, repo_id: String) -> Result<gitops::GitOpResult, String> {
    let root = state::repo_path(&app, &repo_id)?;
    gitops::pull(&root, state::load_tokens(&app))
}

#[tauri::command(async)]
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

#[tauri::command(async)]
fn git_pull_force(app: AppHandle, repo_id: String) -> Result<gitops::GitOpResult, String> {
    let root = state::repo_path(&app, &repo_id)?;
    gitops::pull_force(&root, state::load_tokens(&app))
}

/// 撤销单个文件的本地修改(未跟踪文件=直接删除)
#[tauri::command(async)]
fn git_discard_file(app: AppHandle, repo_id: String, path: String) -> Result<(), String> {
    let root = state::repo_path(&app, &repo_id)?;
    // 仅作路径越界校验
    state::resolve_in_repo(&root, &path)?;
    gitops::discard_file(&root, &path)
}

#[tauri::command(async)]
fn search_repo(app: AppHandle, repo_id: String, query: String) -> Result<Vec<fsops::SearchHit>, String> {
    let root = state::repo_path(&app, &repo_id)?;
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    fsops::search(&root, query.trim())
}

/// 导出文件到用户经保存对话框选择的任意路径(仓库外)
#[tauri::command(async)]
fn export_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("写入失败: {e}"))
}

/// Android:探测是否已获得「所有文件访问」权限(可读外部存储根)
#[tauri::command]
fn check_storage_access() -> bool {
    #[cfg(target_os = "android")]
    {
        std::fs::read_dir("/storage/emulated/0").is_ok()
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

/// Android:沉浸式全屏——隐藏/恢复系统状态栏与导航栏(阅读时点正文空白切换)
#[tauri::command]
fn set_immersive(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        window
            .with_webview(move |webview| {
                webview.jni_handle().exec(move |env, activity, _webview| {
                    let _ = android_jni::set_immersive_mode(env, activity, on);
                });
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (window, on);
        Ok(())
    }
}

/// Android:拉起「所有文件访问」系统授权页(API<30 无此页时回退应用详情页)
#[tauri::command]
fn request_storage_access(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        window
            .with_webview(|webview| {
                webview.jni_handle().exec(|env, activity, _webview| {
                    let _ = android_jni::open_all_files_permission(env, activity);
                });
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = window;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirItem {
    name: String,
    has_git: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirListing {
    path: String,
    parent: Option<String>,
    dirs: Vec<DirItem>,
    is_git: bool,
}

/// 应用内目录浏览器:列出子目录(Android 没有可用的系统目录选择器)
#[tauri::command(async)]
fn list_dirs(path: String) -> Result<DirListing, String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("目录不存在或不可读: {path}"));
    }
    let mut dirs: Vec<DirItem> = std::fs::read_dir(&p)
        .map_err(|e| format!("无法读取目录: {e}"))?
        .filter_map(|ent| ent.ok())
        .filter(|ent| ent.path().is_dir())
        .filter_map(|ent| {
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let has_git = ent.path().join(".git").exists();
            Some(DirItem { name, has_git })
        })
        .collect();
    // git 仓库排前,其余按名称
    dirs.sort_by(|a, b| {
        b.has_git
            .cmp(&a.has_git)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(DirListing {
        path: p.to_string_lossy().to_string(),
        parent: p.parent().map(|x| x.to_string_lossy().to_string()).filter(|s| !s.is_empty()),
        dirs,
        is_git: p.join(".git").exists(),
    })
}

/// Android 专用 JNI 桥(经 wry 的 UI 线程执行)
#[cfg(target_os = "android")]
mod android_jni {
    use jni::objects::{JObject, JString, JValue};
    use jni::JNIEnv;

    /// 关闭 WebView 内建缩放与 overview 适配:捏合缩放会把整页缩小造成右侧留白,
    /// 字号调节由前端手势实现,页面级缩放一律禁用
    pub fn disable_webview_zoom(env: &mut JNIEnv, webview: &JObject) -> Result<(), jni::errors::Error> {
        let settings = env
            .call_method(webview, "getSettings", "()Landroid/webkit/WebSettings;", &[])?
            .l()?;
        for (name, v) in [
            ("setSupportZoom", false),
            ("setBuiltInZoomControls", false),
            ("setDisplayZoomControls", false),
            ("setLoadWithOverviewMode", false),
            // 必须保持 true:false 会让布局视口固定在初始方向宽度,横竖屏旋转后右侧留白
            ("setUseWideViewPort", true),
        ] {
            env.call_method(&settings, name, "(Z)V", &[JValue::Bool(v as u8)])?;
        }
        Ok(())
    }

    /// 沉浸式全屏:IMMERSIVE_STICKY 下用户从屏幕边缘上/下滑可短暂呼出系统栏,随后自动再隐藏。
    /// setSystemUiVisibility 虽已 deprecated,但在本项目 targetSdk(34)全版本运行时有效,单次调用最简单
    pub fn set_immersive_mode(env: &mut JNIEnv, activity: &JObject, on: bool) -> Result<(), jni::errors::Error> {
        // LAYOUT_STABLE 0x100 | LAYOUT_HIDE_NAVIGATION 0x200 | LAYOUT_FULLSCREEN 0x400
        // | HIDE_NAVIGATION 0x2 | FULLSCREEN 0x4 | IMMERSIVE_STICKY 0x1000
        let flags: i32 = if on { 0x100 | 0x200 | 0x400 | 0x2 | 0x4 | 0x1000 } else { 0 };
        let window = env
            .call_method(activity, "getWindow", "()Landroid/view/Window;", &[])?
            .l()?;
        let decor = env
            .call_method(&window, "getDecorView", "()Landroid/view/View;", &[])?
            .l()?;
        env.call_method(&decor, "setSystemUiVisibility", "(I)V", &[JValue::Int(flags)])?;
        Ok(())
    }

    /// 打开「所有文件访问」系统授权页;该 action 不存在(API<30)时回退应用详情页
    pub fn open_all_files_permission(env: &mut JNIEnv, activity: &JObject) -> Result<(), jni::errors::Error> {
        let pkg_obj = env
            .call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])?
            .l()?;
        let pkg_jstr = JString::from(pkg_obj);
        let pkg: String = env.get_string(&pkg_jstr)?.into();
        let uri_str = env.new_string(format!("package:{pkg}"))?;
        let uri_arg: &JObject = &uri_str;
        let uri = env
            .call_static_method(
                "android/net/Uri",
                "parse",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(uri_arg)],
            )?
            .l()?;
        for action in [
            "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
            "android.settings.APPLICATION_DETAILS_SETTINGS",
        ] {
            let action_str = env.new_string(action)?;
            let action_arg: &JObject = &action_str;
            let intent = env.new_object(
                "android/content/Intent",
                "(Ljava/lang/String;Landroid/net/Uri;)V",
                &[JValue::Object(action_arg), JValue::Object(&uri)],
            )?;
            let r = env.call_method(
                activity,
                "startActivity",
                "(Landroid/content/Intent;)V",
                &[JValue::Object(&intent)],
            );
            if env.exception_check()? {
                env.exception_clear()?;
                continue;
            }
            if r.is_ok() {
                return Ok(());
            }
        }
        Ok(())
    }
}

/// 保存/删除某域名的令牌。
/// host 会先规范化:用户常直接粘贴完整仓库地址(如 https://gitee.com/user/repo),
/// 若原样当 key 存下,后续换个写法(带 .git、带尾斜杠、大小写不同)就匹配不上了。
#[tauri::command]
fn save_token(app: AppHandle, host: String, token: String) -> Result<(), String> {
    let host = gitops::host_of(host.trim()).to_lowercase();
    if host.is_empty() {
        return Err("域名不能为空".into());
    }
    let mut map = state::load_tokens(&app);
    if token.is_empty() {
        map.remove(&host);
    } else {
        map.insert(host, token);
    }
    state::save_tokens(&app, &map)
}

/// 已保存令牌的域名列表(只回域名,不回令牌值)。
/// 令牌框出于安全不回填,若再不给个"存了哪些域名"的反馈,用户无从判断是否保存成功。
#[tauri::command]
fn list_token_hosts(app: AppHandle) -> Result<Vec<String>, String> {
    let mut hosts: Vec<String> = state::load_tokens(&app).into_keys().collect();
    hosts.sort();
    Ok(hosts)
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
    // Android 上「添加本地 git 仓库」指向 /sdcard,那里的文件不属于 App 的 uid,
    // libgit2 的属主校验(等价 git 的 safe.directory 保护)会直接拒绝打开仓库,
    // 导致状态条/拉取/提交/变更面板全部不可用。文库目录是用户在应用内亲手选的,
    // 不存在"误入他人仓库"的风险,故在 Android 关掉该校验。
    // 桌面端仓库属主正常,保持默认校验不动。
    #[cfg(target_os = "android")]
    unsafe {
        let _ = git2::opts::set_verify_owner_validation(false);
    }

    let builder = tauri::Builder::default();

    // 单实例:**进程**只有一个(注册表 repos.json 只能有一个写者,多进程会互相覆盖),
    // 但双击 md 文件不再顶掉已开窗口的内容,而是新开一个窗口装它。
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        match pick_md_from_args(argv) {
            Some(p) => {
                let target = state::WindowTarget { file: Some(p), ..Default::default() };
                if let Err(e) = spawn_window(app, target) {
                    eprintln!("新窗口创建失败: {e}");
                }
            }
            // 没带文件的重复启动(点图标):聚焦已有窗口,不再开新的
            None => {
                if let Some(w) = app.webview_windows().values().next() {
                    let _ = w.set_focus();
                }
            }
        }
    }));

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .register_uri_scheme_protocol("repo", |ctx, request| {
            let app = ctx.app_handle();
            match serve_repo_asset(app, request.uri().path()) {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "public, max-age=3600")
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
            remove_repo,
            open_new_window,
            take_window_target,
            list_tree,
            read_file,
            write_file,
            write_binary,
            create_file,
            create_dir,
            rename_entry,
            delete_entry,
            git_status,
            git_pull,
            git_pull_force,
            git_discard_file,
            git_sync,
            search_repo,
            save_token,
            list_token_hosts,
            get_token,
            export_file,
            check_storage_access,
            request_storage_access,
            set_immersive,
            list_dirs,
            open_path,
            take_launch_file
        ])
        .setup(|app| {
            let loaded = state::load_repos(app.handle());
            let state = app.state::<AppState>();
            *state.repos.lock().unwrap() = loaded;
            *state.launch_file.lock().unwrap() = pick_md_from_args(std::env::args());
            // Android:WebView 默认允许捏合缩放整页(与前端字号手势冲突,还会造成页面缩小右侧留白)
            #[cfg(target_os = "android")]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.with_webview(|webview| {
                    webview.jni_handle().exec(|env, _activity, webview| {
                        let _ = android_jni::disable_webview_zoom(env, webview);
                    });
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("墨阅启动失败");
}
