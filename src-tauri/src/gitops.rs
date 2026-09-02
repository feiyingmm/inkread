use git2::{
    build::CheckoutBuilder, BranchType, Cred, CredentialType, FetchOptions, IndexAddOption,
    PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusOut {
    pub branch: String,
    pub dirty_count: u32,
    pub changes: Vec<GitChange>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOpResult {
    pub ok: bool,
    pub changed: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub divergent: Option<bool>,
}

impl GitOpResult {
    fn simple(ok: bool, changed: bool, message: impl Into<String>) -> Self {
        Self { ok, changed, message: message.into(), conflict: None, divergent: None }
    }
}

fn open(path: &Path) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| format!("打开仓库失败: {}", e.message()))
}

/// 从远程地址里抽域名。用于两处:凭据匹配失败时的提示文案、保存令牌时把用户
/// 误填的完整仓库地址规范化成域名(实测用户会直接粘贴 https://gitee.com/xx/yy)。
/// 兼容 `https://user@host/path` 与 `git@host:path` 两种写法;已经是纯域名则原样返回。
pub fn host_of(url: &str) -> String {
    if let Some(rest) = url.split("://").nth(1) {
        let authority = rest.split('/').next().unwrap_or("");
        authority.rsplit('@').next().unwrap_or(authority).to_string()
    } else if let Some((_, rest)) = url.split_once('@') {
        rest.split(':').next().unwrap_or(rest).to_string()
    } else {
        url.to_string()
    }
}

fn make_callbacks(tokens: HashMap<String, String>) -> RemoteCallbacks<'static> {
    let mut cb = RemoteCallbacks::new();
    cb.credentials(move |url, username_from_url, allowed| {
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            // 1) 系统 git credential helper(桌面 Git 已配置的凭据管理器)
            if let Ok(cfg) = git2::Config::open_default() {
                if let Ok(cred) = Cred::credential_helper(&cfg, url, username_from_url) {
                    return Ok(cred);
                }
            }
            // 2) 应用内保存的 token(按 host 匹配)
            for (host, token) in tokens.iter() {
                if url.contains(host.as_str()) {
                    let user = username_from_url.unwrap_or("oauth2");
                    return Cred::userpass_plaintext(user, token);
                }
            }
            // 走到这里说明是 HTTPS 但没有可用令牌 —— 把域名和已存域名都报出来,
            // 否则用户只看到"没有可用凭据",分不清是没存、还是域名写得对不上
            let host = host_of(url);
            let saved = if tokens.is_empty() {
                "当前一个都没保存".to_string()
            } else {
                let mut ks: Vec<&str> = tokens.keys().map(|s| s.as_str()).collect();
                ks.sort_unstable();
                format!("已保存的域名: {}", ks.join(", "))
            };
            return Err(git2::Error::from_str(&format!(
                "没有匹配「{host}」的访问令牌({saved})。请在 设置 → Git 令牌 中为该域名添加令牌"
            )));
        }
        if allowed.contains(CredentialType::SSH_KEY) {
            return Err(git2::Error::from_str(
                "该文库的远程地址是 SSH(git@…),墨阅只支持 HTTPS + 访问令牌。\
                 请把远程地址改为 https:// 形式后重试",
            ));
        }
        Err(git2::Error::from_str(&format!(
            "远程要求的认证方式不受支持({allowed:?}),墨阅只支持 HTTPS + 访问令牌"
        )))
    });
    cb
}

fn current_branch(repo: &Repository) -> Result<String, String> {
    let head = repo.head().map_err(|e| e.message().to_string())?;
    Ok(head.shorthand().unwrap_or("HEAD").to_string())
}

pub fn status(path: &Path) -> Result<GitStatusOut, String> {
    let repo = open(path)?;
    let branch = current_branch(&repo)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| e.message().to_string())?;
    let mut changes: Vec<GitChange> = Vec::new();
    for entry in statuses.iter() {
        if changes.len() >= 500 {
            break;
        }
        let s = entry.status();
        let kind = if s.contains(git2::Status::WT_NEW) {
            "untracked"
        } else if s.contains(git2::Status::WT_DELETED) || s.contains(git2::Status::INDEX_DELETED) {
            "deleted"
        } else if s.contains(git2::Status::INDEX_RENAMED) || s.contains(git2::Status::WT_RENAMED) {
            "renamed"
        } else if s.contains(git2::Status::INDEX_NEW) {
            "added"
        } else {
            "modified"
        };
        if let Some(p) = entry.path() {
            changes.push(GitChange {
                path: p.to_string(),
                kind: kind.to_string(),
            });
        }
    }
    let dirty_count = statuses.len() as u32;

    let (ahead, behind) = ahead_behind(&repo, &branch).unwrap_or((0, 0));
    Ok(GitStatusOut {
        branch,
        dirty_count,
        changes,
        ahead: ahead as u32,
        behind: behind as u32,
    })
}

fn ahead_behind(repo: &Repository, branch: &str) -> Result<(usize, usize), String> {
    let local = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|e| e.message().to_string())?;
    let upstream = local.upstream().map_err(|e| e.message().to_string())?;
    let local_oid = local
        .get()
        .target()
        .ok_or_else(|| "无本地提交".to_string())?;
    let upstream_oid = upstream
        .get()
        .target()
        .ok_or_else(|| "无上游提交".to_string())?;
    repo.graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|e| e.message().to_string())
}

/// 选用远程:优先 origin,否则第一个;没有远程返回 None
fn pick_remote(repo: &Repository) -> Option<String> {
    if repo.find_remote("origin").is_ok() {
        return Some("origin".into());
    }
    let names = repo.remotes().ok()?;
    names.get(0).map(|s| s.to_string())
}

fn fetch_remote(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    tokens: HashMap<String, String>,
) -> Result<(), String> {
    let mut remote = repo
        .find_remote(remote_name)
        .map_err(|e| e.message().to_string())?;
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(make_callbacks(tokens));
    remote
        .fetch(&[branch], Some(&mut fo), None)
        .map_err(|e| format!("拉取失败: {}", e.message()))
}

pub fn pull(path: &Path, tokens: HashMap<String, String>) -> Result<GitOpResult, String> {
    let repo = open(path)?;
    let Some(remote_name) = pick_remote(&repo) else {
        return Ok(GitOpResult::simple(true, false, "该文库没有远程仓库,无需拉取"));
    };
    let branch = current_branch(&repo)?;
    if branch == "HEAD" {
        return Ok(GitOpResult::simple(true, false, "当前处于游离 HEAD 状态,无法拉取"));
    }
    fetch_remote(&repo, &remote_name, &branch, tokens)?;

    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.message().to_string())?;
    let annotated = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.message().to_string())?;
    let (analysis, _) = repo
        .merge_analysis(&[&annotated])
        .map_err(|e| e.message().to_string())?;

    if analysis.is_up_to_date() {
        return Ok(GitOpResult::simple(true, false, "已是最新"));
    }
    if analysis.is_fast_forward() {
        // 安全 checkout:本地未提交修改与更新冲突时报错,由前端引导「放弃本地并覆盖」
        let target_oid = annotated.id();
        let refname = format!("refs/heads/{branch}");
        if let Err(e) = repo.checkout_tree(
            &repo
                .find_object(target_oid, None)
                .map_err(|e| e.message().to_string())?,
            Some(CheckoutBuilder::default().safe()),
        ) {
            return Ok(GitOpResult {
                ok: false,
                changed: false,
                message: format!("本地有未同步的修改,阻碍了拉取: {}", e.message()),
                conflict: None,
                divergent: Some(true),
            });
        }
        let mut reference = repo
            .find_reference(&refname)
            .map_err(|e| e.message().to_string())?;
        reference
            .set_target(target_oid, "inkread: fast-forward")
            .map_err(|e| e.message().to_string())?;
        repo.set_head(&refname).map_err(|e| e.message().to_string())?;
        return Ok(GitOpResult::simple(true, true, "已拉取最新文档"));
    }
    Ok(GitOpResult {
        ok: false,
        changed: false,
        message: "本地与远端已分叉".into(),
        conflict: None,
        divergent: Some(true),
    })
}

/// 放弃本地一切未推送内容,强制与远端一致(fetch + reset --hard 到远端;未跟踪文件保留)
pub fn pull_force(path: &Path, tokens: HashMap<String, String>) -> Result<GitOpResult, String> {
    let repo = open(path)?;
    let Some(remote_name) = pick_remote(&repo) else {
        return Ok(GitOpResult::simple(false, false, "该文库没有远程仓库"));
    };
    let branch = current_branch(&repo)?;
    fetch_remote(&repo, &remote_name, &branch, tokens)?;
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.message().to_string())?;
    let target = fetch_head
        .peel(git2::ObjectType::Commit)
        .map_err(|e| e.message().to_string())?;
    repo.reset(&target, git2::ResetType::Hard, None)
        .map_err(|e| format!("重置失败: {}", e.message()))?;
    Ok(GitOpResult::simple(true, true, "已放弃本地修改并与远端保持一致"))
}

pub fn sync(
    path: &Path,
    message: &str,
    tokens: HashMap<String, String>,
) -> Result<GitOpResult, String> {
    let repo = open(path)?;
    let remote_name = pick_remote(&repo);
    let branch = current_branch(&repo)?;

    // 有工作区变更则全部提交
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let dirty = repo
        .statuses(Some(&mut opts))
        .map_err(|e| e.message().to_string())?
        .len()
        > 0;
    if dirty {
        let mut index = repo.index().map_err(|e| e.message().to_string())?;
        index
            .add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .map_err(|e| e.message().to_string())?;
        index.write().map_err(|e| e.message().to_string())?;
        let tree_id = index.write_tree().map_err(|e| e.message().to_string())?;
        let tree = repo.find_tree(tree_id).map_err(|e| e.message().to_string())?;
        let parent = repo
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|e| e.message().to_string())?;
        let sig = repo
            .signature()
            .or_else(|_| Signature::now("mahonggeng", "inkread@local"))
            .map_err(|e| e.message().to_string())?;
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])
            .map_err(|e| format!("提交失败: {}", e.message()))?;
    }

    // 推送;被拒则检查是否远端领先(冲突场景交由前端提示外部工具处理)
    let Some(remote_name) = remote_name else {
        return Ok(GitOpResult::simple(true, dirty, "已提交(该文库没有远程仓库,未推送)"));
    };
    let mut remote = repo
        .find_remote(&remote_name)
        .map_err(|e| e.message().to_string())?;
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    let mut po = PushOptions::new();
    po.remote_callbacks(make_callbacks(tokens.clone()));
    match remote.push(&[refspec.as_str()], Some(&mut po)) {
        Ok(()) => Ok(GitOpResult::simple(true, true, "已提交并推送")),
        Err(push_err) => {
            fetch_remote(&repo, &remote_name, &branch, tokens)?;
            let (_, behind) = ahead_behind(&repo, &branch).unwrap_or((0, 0));
            if behind > 0 {
                Ok(GitOpResult {
                    ok: false,
                    changed: false,
                    message: "本地与远端存在冲突,请选择保留方式".into(),
                    conflict: Some(true),
                    divergent: None,
                })
            } else {
                Ok(GitOpResult::simple(
                    false,
                    false,
                    format!("推送失败: {}", push_err.message()),
                ))
            }
        }
    }
}

/// 变更面板「查看改动」要对比的两侧文本
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSource {
    /// 最近提交(HEAD)里的版本;文件不在最近提交里(新增 / 未跟踪)为 None
    pub base: Option<String>,
    /// 工作区当前内容;文件已删除为 None
    pub current: Option<String>,
    /// 任一侧像二进制(前 8000 字节含 NUL,与 git 的判定一致)或超过 4MB:两侧文本都不给,只给大小
    pub binary: bool,
    pub base_size: u64,
    pub current_size: u64,
}

/// 单文件「最近提交 ↔ 工作区」两侧的文本,交给前端算行级 diff。
///
/// 两端后端(Rust / Node)只负责取文本,diff 算法只在前端写一份 —— 各算一遍迟早长出两种输出。
/// 对比基线是 HEAD 而不是暂存区:墨阅的"撤销修改"恢复的就是 HEAD 版本,两处口径一致。
pub fn diff_source(path: &Path, rel: &str) -> Result<DiffSource, String> {
    const MAX: usize = 4 * 1024 * 1024;
    let repo = open(path)?;
    let base_bytes: Option<Vec<u8>> = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok())
        .and_then(|t| t.get_path(Path::new(rel)).ok())
        .and_then(|e| e.to_object(&repo).ok())
        .and_then(|o| o.into_blob().ok())
        .map(|b| b.content().to_vec());
    let abs = path.join(rel);
    let current_bytes: Option<Vec<u8>> = if abs.is_file() {
        Some(std::fs::read(&abs).map_err(|e| format!("读取失败: {e}"))?)
    } else {
        None
    };
    let base_size = base_bytes.as_ref().map(|b| b.len()).unwrap_or(0) as u64;
    let current_size = current_bytes.as_ref().map(|b| b.len()).unwrap_or(0) as u64;
    let looks_binary = |b: &Option<Vec<u8>>| {
        b.as_ref()
            .map(|v| v.len() > MAX || v.iter().take(8000).any(|&c| c == 0))
            .unwrap_or(false)
    };
    if looks_binary(&base_bytes) || looks_binary(&current_bytes) {
        return Ok(DiffSource { base: None, current: None, binary: true, base_size, current_size });
    }
    Ok(DiffSource {
        base: base_bytes.map(|b| crate::fsops::decode_text(&b)),
        current: current_bytes.map(|b| crate::fsops::decode_text(&b)),
        binary: false,
        base_size,
        current_size,
    })
}

/// 撤销单文件的本地修改:tracked 文件恢复 HEAD 版本(含已暂存改动);未跟踪文件直接删除
pub fn discard_file(path: &Path, rel: &str) -> Result<(), String> {
    let repo = open(path)?;
    let st = repo
        .status_file(Path::new(rel))
        .map_err(|e| format!("读取文件状态失败: {}", e.message()))?;
    if st.contains(git2::Status::WT_NEW) {
        let abs = path.join(rel);
        if abs.is_dir() {
            std::fs::remove_dir_all(&abs).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&abs).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let mut cb = CheckoutBuilder::new();
    cb.path(rel).force().update_index(true);
    repo.checkout_head(Some(&mut cb))
        .map_err(|e| format!("撤销失败: {}", e.message()))
}

/// 克隆远程仓库到指定目录
pub fn clone(
    url: &str,
    dest: &Path,
    tokens: HashMap<String, String>,
) -> Result<(), String> {
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(make_callbacks(tokens));
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fo);
    builder
        .clone(url, dest)
        .map(|_| ())
        .map_err(|e| format!("克隆失败: {}", e.message()))
}

// 注:墨阅不代做合并 —— 真冲突一律提示用户用外部 git 工具处理,软件内只提供
// 「放弃本地修改与远端一致」(pull_force,覆盖的是本地而非远程)。
