use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub mtime: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub preview: String,
    pub name_match: bool,
}

const TEXT_EXTS: &[&str] = &[
    "md", "markdown", "txt", "sql", "html", "htm", "json", "yml", "yaml", "xml", "csv", "js",
    "ts", "css", "sh", "py", "java", "properties", "conf", "ini", "log",
];

fn skip_entry(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

/// 尊重 .gitignore:目录/文件被忽略则不进树、不进搜索(与文档库语义一致)
fn is_ignored(repo: Option<&git2::Repository>, rel_path: &str) -> bool {
    match repo {
        Some(r) => r.is_path_ignored(rel_path).unwrap_or(false),
        None => false,
    }
}

pub fn build_tree(root: &Path, rel: &str) -> Result<Vec<TreeNode>, String> {
    let repo = git2::Repository::open(root).ok();
    build_tree_inner(root, rel, repo.as_ref())
}

fn build_tree_inner(
    root: &Path,
    rel: &str,
    repo: Option<&git2::Repository>,
) -> Result<Vec<TreeNode>, String> {
    let abs = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };
    let mut nodes: Vec<TreeNode> = Vec::new();
    let entries = fs::read_dir(&abs).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if skip_entry(&name) {
            continue;
        }
        let rel_path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if is_ignored(repo, &rel_path) {
            continue;
        }
        if ft.is_dir() {
            let children = build_tree_inner(root, &rel_path, repo)?;
            nodes.push(TreeNode {
                name,
                path: rel_path,
                node_type: "dir".into(),
                ext: None,
                children: Some(children),
            });
        } else if ft.is_file() {
            let ext = Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase());
            nodes.push(TreeNode {
                name,
                path: rel_path,
                node_type: "file".into(),
                ext,
                children: None,
            });
        }
    }
    nodes.sort_by(|a, b| {
        if a.node_type != b.node_type {
            return if a.node_type == "dir" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(nodes)
}

pub fn read_file(abs: &PathBuf) -> Result<FileContent, String> {
    let content = fs::read_to_string(abs).map_err(|e| format!("读取失败: {e}"))?;
    let mtime = fs::metadata(abs)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Ok(FileContent { content, mtime })
}

pub fn write_file(abs: &PathBuf, content: &str) -> Result<(), String> {
    fs::write(abs, content).map_err(|e| format!("写入失败: {e}"))
}

pub fn search(root: &Path, query: &str) -> Result<Vec<SearchHit>, String> {
    let q = query.to_lowercase();
    let mut hits: Vec<SearchHit> = Vec::new();
    let repo = git2::Repository::open(root).ok();
    walk_search(root, "", &q, query.chars().count(), &mut hits, repo.as_ref())?;
    Ok(hits)
}

fn walk_search(
    root: &Path,
    rel: &str,
    q: &str,
    q_chars: usize,
    hits: &mut Vec<SearchHit>,
    repo: Option<&git2::Repository>,
) -> Result<(), String> {
    const MAX: usize = 200;
    if hits.len() >= MAX {
        return Ok(());
    }
    let abs = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };
    let entries = match fs::read_dir(&abs) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        if hits.len() >= MAX {
            return Ok(());
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if skip_entry(&name) {
            continue;
        }
        let rel_path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if is_ignored(repo, &rel_path) {
            continue;
        }
        if ft.is_dir() {
            walk_search(root, &rel_path, q, q_chars, hits, repo)?;
        } else if ft.is_file() {
            if name.to_lowercase().contains(q) {
                hits.push(SearchHit {
                    path: rel_path.clone(),
                    line: 0,
                    preview: name.clone(),
                    name_match: true,
                });
            }
            let ext = Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !TEXT_EXTS.contains(&ext.as_str()) {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 4 * 1024 * 1024 {
                    continue;
                }
            }
            let Ok(content) = fs::read_to_string(entry.path()) else {
                continue;
            };
            if !content.to_lowercase().contains(q) {
                continue;
            }
            for (i, line) in content.lines().enumerate() {
                if hits.len() >= MAX {
                    break;
                }
                let lower = line.to_lowercase();
                let Some(byte_idx) = lower.find(q) else {
                    continue;
                };
                let char_idx = lower[..byte_idx].chars().count();
                let chars: Vec<char> = line.chars().collect();
                let start = char_idx.saturating_sub(40);
                let end = (char_idx + q_chars + 60).min(chars.len());
                let preview: String = chars[start..end].iter().collect();
                hits.push(SearchHit {
                    path: rel_path.clone(),
                    line: (i + 1) as u32,
                    preview: preview.trim().to_string(),
                    name_match: false,
                });
            }
        }
    }
    Ok(())
}
