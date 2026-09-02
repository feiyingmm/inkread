mod fonts;
mod fsops;
mod gitops;
mod state;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tray;

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
    /// 是不是 git 仓库。普通文件夹也能当文库(看本地小说/散落的 md),
    /// 这时同步、变更、拉取那一套全都不适用,前端据此收起相关入口。
    git: bool,
}

/// 每次列举时现探,不写进 repos.json:用户后来自己 `git init` 了也能立刻认出来,
/// 老配置文件也不用迁移。
fn is_git_repo(path: &str) -> bool {
    PathBuf::from(path).join(".git").exists()
}

#[tauri::command]
fn list_repos(state: State<'_, AppState>) -> Result<Vec<RepoMeta>, String> {
    let repos = state.repos.lock().map_err(|e| e.to_string())?;
    Ok(repos
        .iter()
        .map(|r| RepoMeta {
            id: r.id.clone(),
            name: r.name.clone(),
            git: is_git_repo(&r.path),
        })
        .collect())
}

#[tauri::command(async)]
fn add_repo_local(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<RepoMeta, String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("{}目录不存在或不可读: {path}", storage_hint()));
    }
    // 普通文件夹也收(本地小说、散落的 md);是 git 仓库就顺手校验一遍。
    //
    // 「目录列得出来」≠「读得到里面的文件」:Android 分区存储下目录一律可见、文件却读不到,
    // 不当场验一次就会得到一个「只有目录没有文件」的空壳文库(v0.3.3 的真实故障)。
    // git 库靠 Repository::open 撞这个墙,普通文件夹没有 .git 可验,只能试读一个文件。
    let git = p.join(".git").exists();
    if git {
        if let Err(e) = git2::Repository::open(&p) {
            return Err(format!("{}{}", storage_hint(), e.message()));
        }
    } else if let Err(e) = probe_readable(&p) {
        return Err(format!("{}{e}", storage_hint()));
    }
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".into());
    let mut repos = state.repos.lock().map_err(|e| e.to_string())?;
    // 同一目录已经在列表里:把那一条原样返回,让前端切过去 —— 而不是报"该仓库已添加"了事。
    // 会撞到这里的有两种来源:用户重复添加;以及此前双击 md 文件时以所在目录建过**临时**文库
    // (`open_path`,不落盘)。后者要顺手转正:用户这一刻明确说了"把这个目录当文库",
    // 若仍按临时处理,repos.json 里没它,重启后文库就没了 —— 2026-09-02 用户反馈的
    // "提示已添加却没切换、重启后再添加才成功"就是这条路。id 不变:最近阅读、滚动位置都按 id 存。
    if let Some(idx) = repos.iter().position(|r| same_dir(&r.path, &path)) {
        if repos[idx].ephemeral {
            repos[idx].ephemeral = false;
            repos[idx].name = name.clone();
            state::save_repos(&app, &repos)?;
        }
        let r = &repos[idx];
        return Ok(RepoMeta { id: r.id.clone(), name: r.name.clone(), git });
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
    // 落盘失败就把内存里那条也撤回:否则内存说"已添加"、磁盘上却没有,重启后前后矛盾
    if let Err(e) = state::save_repos(&app, &repos) {
        repos.pop();
        return Err(format!("保存文库列表失败: {e}"));
    }
    Ok(RepoMeta { id, name, git })
}

/// 两个路径指的是不是同一个目录。先试 `canonicalize`(消掉 `..`、末尾分隔符、Windows 上的
/// 大小写与盘符写法差异);任一侧解析不了(目录已不在)就退回规范化后的字符串比较。
fn same_dir(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => normalize_dir(a) == normalize_dir(b),
    }
}

fn normalize_dir(p: &str) -> String {
    let s = p.replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}

/// 试着从目录里读一个文件的头几字节,确认「真的读得到内容」而不只是列得出名字。
/// 目录里一个文件都没有(只有子目录)时视为通过 —— 空目录本身不是错误。
fn probe_readable(dir: &std::path::Path) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("无法读取目录: {e}"))?;
    for ent in entries.filter_map(|e| e.ok()) {
        if !ent.path().is_file() {
            continue;
        }
        let mut f = std::fs::File::open(ent.path()).map_err(|e| format!("目录里的文件读不出来: {e}"))?;
        let mut buf = [0u8; 1];
        return match std::io::Read::read(&mut f, &mut buf) {
            // 读到 0 字节也算通过:那是个空文件,不是权限问题
            Ok(_) => Ok(()),
            Err(e) => Err(format!("目录里的文件读不出来: {e}")),
        };
    }
    Ok(())
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
    // 克隆来的必然是 git 仓库
    Ok(RepoMeta { id, name, git: true })
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
    if let Some(existing) = repos.iter().find(|r| same_dir(&r.path, &dir_str)) {
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
///
/// 🔴 **只能在非主线程调用**。`WebviewWindowBuilder::build()` 的官方文档写着:
/// > On Windows, this function deadlocks when used in a synchronous command and event handlers
/// > (wry#583)。You should use `async` commands or separate threads.
/// 原因是新建 WebView2 需要泵消息循环,而同步命令 / 事件回调本身就跑在主线程的
/// WebView2 IPC 回调里,重入即死锁 —— v0.3.4 的真实故障:菜单点「以新窗口打开」后
/// 新窗口白屏、且整个应用一起卡死无响应。
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
    let built = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("墨阅")
        .inner_size(1280.0, 820.0)
        .min_inner_size(760.0, 500.0)
        // 与主窗口一致:Ctrl+滚轮 / Ctrl+加减 缩放页面
        .zoom_hotkeys_enabled(true)
        .center()
        .build();
    if let Err(e) = built {
        // 建窗失败就把登记的目标撤掉,免得留下永远取不走的孤儿条目
        if let Ok(mut map) = app.state::<AppState>().window_targets.lock() {
            map.remove(&label);
        }
        return Err(format!("新窗口创建失败: {e}"));
    }
    Ok(())
}

/// 从主线程(事件回调 / 同步命令)开窗的安全入口:把 build() 丢到独立线程,
/// 避开上面那条 Windows 死锁。拿不到返回值,失败只能记日志。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_window_off_main(app: &AppHandle, target: state::WindowTarget) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = spawn_window(&app, target) {
            eprintln!("[inkread] {e}");
        }
    });
}

/// 应用内「以新窗口打开」。Android 无多窗口,直接报错由前端拦住(菜单项本就不显示)。
///
/// 必须是 `(async)`:Tauri 会把它放到独立线程执行,普通同步命令跑在主线程上,
/// 在里面建窗会死锁(见 spawn_window 的注释)。
#[tauri::command(async)]
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

/// Android 分区存储下的写入被拒(EPERM/EACCES)不是"未知错误",而是缺权限。
/// 只报 `Operation not permitted (os error 1)` 用户根本不知道该干什么,这里补上出路。
fn storage_hint() -> &'static str {
    #[cfg(target_os = "android")]
    {
        "墨阅没有访问该目录的权限。请到 系统设置 → 应用 → 墨阅 → 权限,开启「所有文件访问」后重试。原因: "
    }
    #[cfg(not(target_os = "android"))]
    {
        ""
    }
}

fn fs_err(action: &str, e: std::io::Error) -> String {
    let denied = e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1);
    if denied {
        format!("{action}失败:{}{e}", storage_hint())
    } else {
        format!("{action}失败: {e}")
    }
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
        std::fs::create_dir_all(parent).map_err(|e| fs_err("创建", e))?;
    }
    std::fs::write(&abs, "").map_err(|e| fs_err("创建", e))
}

/// 新建文件夹;内置 .gitkeep 占位(空目录进不了 git,多端同步会丢)
#[tauri::command(async)]
fn create_dir(app: AppHandle, repo_id: String, path: String) -> Result<(), String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    if abs.exists() {
        return Err("同名目录已存在".into());
    }
    std::fs::create_dir_all(&abs).map_err(|e| fs_err("创建", e))?;
    std::fs::write(abs.join(".gitkeep"), "").map_err(|e| fs_err("创建", e))
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
    std::fs::rename(&src, &dst).map_err(|e| fs_err("重命名", e))
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
        std::fs::remove_dir_all(&abs).map_err(|e| fs_err("删除", e))
    } else {
        std::fs::remove_file(&abs).map_err(|e| fs_err("删除", e))
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

/// 单文件「最近提交 ↔ 工作区」两侧文本(变更面板的对比视图用;行级 diff 在前端算)
#[tauri::command(async)]
fn git_diff_source(app: AppHandle, repo_id: String, path: String) -> Result<gitops::DiffSource, String> {
    let root = state::repo_path(&app, &repo_id)?;
    state::resolve_in_repo(&root, &path)?;
    gitops::diff_source(&root, &path)
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

/// 同上,但写二进制(导出 PNG 长图用)。走 base64 是因为 IPC 只传 JSON,
/// 与 `write_binary` 同一套解码,区别只在这个可以写到仓库外。
#[tauri::command(async)]
fn export_binary(path: String, base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("图片数据解码失败: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("写入失败: {e}"))
}

/// Android:探测是否真的拿到了「所有文件访问」(MANAGE_EXTERNAL_STORAGE)。
///
/// v0.3.3 用 `read_dir("/storage/emulated/0").is_ok()` 判断,这是**假阳性**:
/// Android 11+ 任何应用都能列出共享存储的目录名,但读不到别的应用/adb 写进去的文件,
/// 也不能在 Documents/Download 这类标准集合以外写入。真机复现的连锁后果是——
/// 权限没给却照常放行 → 文件树只剩目录(文件 stat 不到被静默跳过)、
/// `.git` 读不了导致「git 状态不可用」、新建文档报 `Operation not permitted (os error 1)`。
///
/// 改为**能力探测**:在共享存储根目录写一个探针文件再删掉。写得进去 = 真有权限。
#[tauri::command(async)]
fn check_storage_access() -> bool {
    #[cfg(target_os = "android")]
    {
        let probe = std::path::Path::new("/storage/emulated/0/.inkread_permission_probe");
        match std::fs::write(probe, b"") {
            Ok(()) => {
                let _ = std::fs::remove_file(probe);
                true
            }
            Err(_) => false,
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

/// Android:返回键在「已经没有任何层可关」时把 App 收到后台。
/// 注意不是退出进程——用户按返回只是想离开,再点图标应当回到原来的阅读位置。
#[tauri::command]
fn minimize_app(_window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        _window
            .with_webview(|webview| {
                webview.jni_handle().exec(|env, activity, _webview| {
                    let _ = env.call_method(
                        activity,
                        "moveTaskToBack",
                        "(Z)Z",
                        &[jni::objects::JValue::Bool(1)],
                    );
                });
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

/// 桌面端:关闭按钮的行为。`to_tray` 为真时点 ✕ 只隐藏主窗口、进程留在系统托盘;
/// 托盘图标也只在这时才出现 —— 用户没选这个行为就不该在托盘里多一个图标。
/// 前端启动时与设置切换时各调一次。Android 没有托盘,只记个值。
#[tauri::command]
fn set_close_behavior(app: AppHandle, state: State<'_, AppState>, to_tray: bool) -> Result<(), String> {
    state
        .close_to_tray
        .store(to_tray, std::sync::atomic::Ordering::Relaxed);
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if to_tray {
            tray::ensure(&app)?;
        } else {
            tray::remove(&app);
        }
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let _ = app;
    Ok(())
}

/// 窗口事件:主窗口的关闭请求在"收进托盘"模式下改为隐藏。副窗口(以新窗口打开)照常关掉。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if window.label() != "main" {
            return;
        }
        let to_tray = window
            .app_handle()
            .state::<AppState>()
            .close_to_tray
            .load(std::sync::atomic::Ordering::Relaxed);
        if to_tray {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn handle_window_event(_window: &tauri::Window, _event: &tauri::WindowEvent) {}

/// 单个条目的信息(右键 / 长按 →「文件信息」)
#[tauri::command(async)]
fn entry_info(app: AppHandle, repo_id: String, path: String) -> Result<fsops::EntryInfo, String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    fsops::entry_info(&abs, &path)
}

/// 仓库内相对路径 → 磁盘绝对路径(「复制绝对路径」「打开所在目录」用)
#[tauri::command(async)]
fn abs_path(app: AppHandle, repo_id: String, path: String) -> Result<String, String> {
    let root = state::repo_path(&app, &repo_id)?;
    let abs = state::resolve_in_repo(&root, &path)?;
    Ok(abs.to_string_lossy().to_string())
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

// ---- 可下载字体扩展 ----

/// 远端字体清单(两源自动切换;都不通则退回上次缓存,离线也有东西可看)
#[tauri::command(async)]
fn font_manifest(app: AppHandle) -> Result<fonts::Manifest, String> {
    fonts::fetch_manifest(&app)
}

/// 本机已安装的扩展字体
#[tauri::command(async)]
fn font_installed(app: AppHandle) -> Result<Vec<fonts::InstalledFont>, String> {
    Ok(fonts::load_installed(&app))
}

/// 下载并安装一款字体。进度通过 `font-progress` 事件回传
#[tauri::command(async)]
fn font_install(app: AppHandle, meta: fonts::FontMeta) -> Result<fonts::InstalledFont, String> {
    fonts::install(&app, &meta)
}

#[tauri::command(async)]
fn font_uninstall(app: AppHandle, id: String) -> Result<(), String> {
    fonts::uninstall(&app, &id)
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

/// Android:给 libgit2/OpenSSL 装上 CA 根证书。
///
/// Android 版链接的是 **vendored OpenSSL**,编译时 `--openssldir=/usr/local/ssl` ——
/// 这个目录在 Android 上根本不存在,而系统证书在 `/system/etc/security/cacerts`
/// 且文件名用的是 OpenSSL 1.0 的旧 subject hash,OpenSSL 3 按新 hash 查找命中不了。
/// 结果是**任何 HTTPS 都报 "the SSL certificate is invalid"**,拉取/克隆/推送全废。
/// (桌面端不受影响:Windows 上 libgit2 走 WinHTTP,用系统证书库。)
///
/// v0.3.3 的做法是把 bundle 释放到应用数据目录、再用 `git2::opts::set_ssl_cert_file`
/// 指给 libgit2 —— **原理上就不可能成功**,真机 logcat 里是:
/// `failed to load certificates: error:05880020:x509 certificate routines::BIO lib`。
///
/// 原因在 `openssl-src` 的构建脚本里(lib.rs,注释原文):
/// > On Android it looks like not passing `no-stdio` may cause a build failure (#13),
/// > but most other platforms need it for things like **loading system certificates**
/// > so only disable it on Android.
///
/// 即 Android 版 vendored OpenSSL 带着 `OPENSSL_NO_STDIO` 编译,`BIO_new_file()` 不可用,
/// **任何"给一个证书文件路径"的接口在 Android 上都是死路**(桌面端不受影响)。
///
/// 所以只能走内存:把 PEM 用内存 BIO 逐张解析成 X509,经 `GIT_OPT_ADD_SSL_X509_CERT`
/// 塞进 libgit2 的信任库。git2 没包装这个选项,故直接调 libgit2-sys 的 FFI。
#[cfg(target_os = "android")]
fn install_ca_bundle(_app: &AppHandle) {
    const CA_BUNDLE: &[u8] = include_bytes!("../assets/cacert.pem");
    match load_ca_bundle_in_memory(CA_BUNDLE) {
        Ok(n) => eprintln!("[inkread] CA 根证书已内存装载 {n} 张"),
        Err(e) => eprintln!("[inkread] CA 根证书装载失败: {e} —— HTTPS git 操作会报证书无效"),
    }
}

/// 手写的 OpenSSL FFI 声明。
///
/// 这些符号已经随 vendored OpenSSL 静态链进本 so 了,链接期能解析到;
/// 之所以不直接依赖 `openssl-sys`,是因为把它提成直接依赖会改变 cargo 的构建指纹,
/// 触发整个 vendored OpenSSL 重新编译(本机跑一次十几分钟且依赖 perl/NDK 环境)。
/// 用到的都是 OpenSSL 3 的稳定公开 C API,签名不会变。
#[cfg(target_os = "android")]
mod openssl_ffi {
    use std::os::raw::{c_int, c_void};

    #[repr(C)]
    pub struct Bio {
        _private: [u8; 0],
    }
    #[repr(C)]
    pub struct X509 {
        _private: [u8; 0],
    }

    extern "C" {
        pub fn BIO_new_mem_buf(buf: *const c_void, len: c_int) -> *mut Bio;
        pub fn BIO_free_all(bio: *mut Bio);
        /// 第 3/4 参分别是密码回调与其 userdata,读公开证书用不到,一律传空
        pub fn PEM_read_bio_X509(
            bio: *mut Bio,
            out: *mut *mut X509,
            cb: *mut c_void,
            u: *mut c_void,
        ) -> *mut X509;
        pub fn X509_free(cert: *mut X509);
        pub fn ERR_clear_error();
    }
}

/// 把 PEM bundle 逐张解析并加入 libgit2 的 X509 信任库,返回成功装载的张数。
/// libgit2 的 `git_openssl__add_x509_cert` 内部走 `X509_STORE_add_cert`,会自行 up-ref,
/// 所以这里每张证书用完立刻 `X509_free`,不泄漏。
#[cfg(target_os = "android")]
fn load_ca_bundle_in_memory(pem: &[u8]) -> Result<usize, String> {
    use std::os::raw::{c_int, c_void};

    // git_libgit2_opts 要求 libgit2 已初始化;run() 里 set_verify_owner_validation 已经拉起过,
    // 这里再借一次(幂等)保证任何调用顺序下都安全。
    unsafe {
        git2::opts::set_verify_owner_validation(false).map_err(|e| e.message().to_string())?;
    }

    unsafe {
        let bio = openssl_ffi::BIO_new_mem_buf(pem.as_ptr() as *const c_void, pem.len() as c_int);
        if bio.is_null() {
            return Err("BIO_new_mem_buf 返回空".into());
        }
        let mut loaded = 0usize;
        loop {
            let cert = openssl_ffi::PEM_read_bio_X509(
                bio,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            if cert.is_null() {
                break;
            }
            let rc = libgit2_sys::git_libgit2_opts(
                libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as c_int,
                cert,
            );
            openssl_ffi::X509_free(cert);
            if rc == 0 {
                loaded += 1;
            }
        }
        openssl_ffi::BIO_free_all(bio);
        // 读到 bundle 末尾会压一条 PEM_R_NO_START_LINE 进错误队列,不清掉会污染后续报错
        openssl_ffi::ERR_clear_error();
        if loaded == 0 {
            Err("一张证书都没装上".into())
        } else {
            Ok(loaded)
        }
    }
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
                // 本回调跑在主线程,建窗必须转到独立线程(否则 Windows 上死锁)
                spawn_window_off_main(app, target);
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
        .on_window_event(handle_window_event)
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
        // 已下载的扩展字体:从应用数据目录流式返回给 WebView 的 @font-face。
        // 不走 IPC —— 10MB 字体转 base64 约 13MB 字符串,每次启动都来一遍会把启动卡死。
        .register_uri_scheme_protocol("inkfont", |ctx, request| {
            let app = ctx.app_handle();
            let id = percent_decode_str(request.uri().path().trim_start_matches('/'))
                .decode_utf8_lossy()
                .to_string();
            match fonts::read_font(app, &id) {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "public, max-age=31536000")
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
            git_diff_source,
            search_repo,
            save_token,
            list_token_hosts,
            get_token,
            font_manifest,
            font_installed,
            font_install,
            font_uninstall,
            export_file,
            export_binary,
            check_storage_access,
            request_storage_access,
            set_immersive,
            minimize_app,
            set_close_behavior,
            abs_path,
            entry_info,
            list_dirs,
            open_path,
            take_launch_file
        ])
        .setup(|app| {
            #[cfg(target_os = "android")]
            install_ca_bundle(app.handle());
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
