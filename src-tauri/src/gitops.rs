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
        }
        Err(git2::Error::from_str("没有可用凭据,请在设置中配置访问令牌"))
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
