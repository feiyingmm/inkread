use git2::{
    build::CheckoutBuilder, BranchType, Cred, CredentialType, FetchOptions, IndexAddOption,
    PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusOut {
    pub branch: String,
    pub dirty_count: u32,
    pub dirty_files: Vec<String>,
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
    let mut dirty_files: Vec<String> = Vec::new();
    for entry in statuses.iter() {
        if dirty_files.len() >= 8 {
            break;
        }
        if let Some(p) = entry.path() {
            let name = p.rsplit('/').next().unwrap_or(p);
            dirty_files.push(name.to_string());
        }
    }
    let dirty_count = statuses.len() as u32;

    let (ahead, behind) = ahead_behind(&repo, &branch).unwrap_or((0, 0));
    Ok(GitStatusOut {
        branch,
        dirty_count,
        dirty_files,
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

fn fetch_origin(
    repo: &Repository,
    branch: &str,
    tokens: HashMap<String, String>,
) -> Result<(), String> {
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| e.message().to_string())?;
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(make_callbacks(tokens));
    remote
        .fetch(&[branch], Some(&mut fo), None)
        .map_err(|e| format!("拉取失败: {}", e.message()))
}

pub fn pull(path: &Path, tokens: HashMap<String, String>) -> Result<GitOpResult, String> {
    let repo = open(path)?;
    let branch = current_branch(&repo)?;
    fetch_origin(&repo, &branch, tokens)?;

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
        return Ok(GitOpResult {
            ok: true,
            changed: false,
            message: "已是最新".into(),
            conflict: None,
        });
    }
    if analysis.is_fast_forward() {
        let refname = format!("refs/heads/{branch}");
        let mut reference = repo
            .find_reference(&refname)
            .map_err(|e| e.message().to_string())?;
        reference
            .set_target(annotated.id(), "inkread: fast-forward")
            .map_err(|e| e.message().to_string())?;
        repo.set_head(&refname).map_err(|e| e.message().to_string())?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .map_err(|e| e.message().to_string())?;
        return Ok(GitOpResult {
            ok: true,
            changed: true,
            message: "已拉取最新文档".into(),
            conflict: None,
        });
    }
    Ok(GitOpResult {
        ok: false,
        changed: false,
        message: "本地与远端已分叉,请先提交并推送本地变更".into(),
        conflict: None,
    })
}

pub fn sync(
    path: &Path,
    message: &str,
    tokens: HashMap<String, String>,
) -> Result<GitOpResult, String> {
    let repo = open(path)?;
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

    // 推送;被拒则检查是否远端领先(冲突场景交由前端二选一)
    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| e.message().to_string())?;
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    let mut po = PushOptions::new();
    po.remote_callbacks(make_callbacks(tokens.clone()));
    match remote.push(&[refspec.as_str()], Some(&mut po)) {
        Ok(()) => Ok(GitOpResult {
            ok: true,
            changed: true,
            message: "已提交并推送".into(),
            conflict: None,
        }),
        Err(push_err) => {
            fetch_origin(&repo, &branch, tokens)?;
            let (_, behind) = ahead_behind(&repo, &branch).unwrap_or((0, 0));
            if behind > 0 {
                Ok(GitOpResult {
                    ok: false,
                    changed: false,
                    message: "本地与远端存在冲突,请选择保留方式".into(),
                    conflict: Some(true),
                })
            } else {
                Ok(GitOpResult {
                    ok: false,
                    changed: false,
                    message: format!("推送失败: {}", push_err.message()),
                    conflict: None,
                })
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

/// 冲突解决:调系统 git 做 rebase(桌面独有;Android 纯阅读场景不会产生本地提交)
pub fn resolve(path: &Path, strategy: &str) -> Result<GitOpResult, String> {
    #[cfg(target_os = "android")]
    {
        let _ = (path, strategy);
        Err("请在桌面端处理冲突".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        // rebase 语义:被重放的本地提交是 theirs —— 保留本地 = theirs,保留远端 = ours
        let opt = if strategy == "local" { "theirs" } else { "ours" };
        let rebase = std::process::Command::new("git")
            .args(["pull", "--rebase", "-X", opt])
            .current_dir(path)
            .output()
            .map_err(|e| format!("无法执行 git: {e}"))?;
        if !rebase.status.success() {
            let _ = std::process::Command::new("git")
                .args(["rebase", "--abort"])
                .current_dir(path)
                .output();
            return Ok(GitOpResult {
                ok: false,
                changed: false,
                message: format!(
                    "自动解决失败: {}",
                    String::from_utf8_lossy(&rebase.stderr).chars().take(300).collect::<String>()
                ),
                conflict: None,
            });
        }
        let push = std::process::Command::new("git")
            .args(["push"])
            .current_dir(path)
            .output()
            .map_err(|e| format!("无法执行 git: {e}"))?;
        if !push.status.success() {
            return Ok(GitOpResult {
                ok: false,
                changed: false,
                message: format!(
                    "推送失败: {}",
                    String::from_utf8_lossy(&push.stderr).chars().take(300).collect::<String>()
                ),
                conflict: None,
            });
        }
        Ok(GitOpResult {
            ok: true,
            changed: true,
            message: if strategy == "local" {
                "已按本地版本推送".into()
            } else {
                "已按远端版本合并推送".into()
            },
            conflict: None,
        })
    }
}
