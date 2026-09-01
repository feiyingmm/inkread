//! 可下载字体扩展:清单拉取、双源下载、sha256 校验、安装/卸载。
//!
//! 中文字体动辄 10MB 上下,全塞进安装包不现实,所以只内置霞鹜文楷保底,
//! 其余按需下载到应用数据目录,由 lib.rs 注册的 `inkfont` 协议直接从磁盘流式返回给 WebView
//! —— 不走 IPC:10MB 字体转 base64 约 13MB 字符串,每次启动都来一遍会把启动卡死。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 字体托管在独立仓库 `feiyingmm/inkread-fonts`(不污染主仓库的 clone 体积)。
///
/// 主源用 jsDelivr:它服务的是 git 仓库内的文件,**不代理 GitHub Release 附件** ——
/// 所以字体必须是提交进仓库并打了 tag 的文件,不能挂成 release 附件。
/// 备源直接回 GitHub raw。jsDelivr 单文件上限 20MB,上架前需确认字体不超。
const SOURCES: [&str; 2] = [
    "https://cdn.jsdelivr.net/gh/feiyingmm/inkread-fonts@v1/",
    "https://raw.githubusercontent.com/feiyingmm/inkread-fonts/v1/",
];

const MANIFEST_FILE: &str = "fonts.json";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FontMeta {
    pub id: String,
    /// 展示名,如「思源宋体」
    pub name: String,
    /// CSS font-family 名,如 `Noto Serif SC`
    pub family: String,
    /// 仓库内的文件名
    pub file: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub desc: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Manifest {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub fonts: Vec<FontMeta>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledFont {
    pub id: String,
    pub name: String,
    pub family: String,
    /// 落盘文件名(带扩展名,决定 @font-face 的 MIME)
    pub file: String,
    pub size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    received: u64,
    total: u64,
}

fn fonts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("取应用数据目录失败: {e}"))?
        .join("fonts");
    fs::create_dir_all(&dir).map_err(|e| format!("建字体目录失败: {e}"))?;
    Ok(dir)
}

fn installed_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(fonts_dir(app)?.join("installed.json"))
}

fn manifest_cache(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(fonts_dir(app)?.join("manifest.json"))
}

pub fn load_installed(app: &AppHandle) -> Vec<InstalledFont> {
    let Ok(path) = installed_file(app) else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_installed(app: &AppHandle, list: &[InstalledFont]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(installed_file(app)?, text).map_err(|e| format!("写字体登记表失败: {e}"))
}

fn client(total: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(total))
        .user_agent("inkread")
        .build()
        .map_err(|e| format!("初始化下载器失败: {e}"))
}

/// 拉字体清单。主源超时/失败自动切备源;两源都不通就退回上次缓存的清单 ——
/// 墨阅首先是离线阅读器,离线时字体页要能照常显示"已下载"和上次看到的可下载列表。
pub fn fetch_manifest(app: &AppHandle) -> Result<Manifest, String> {
    let c = client(15)?;
    let mut last = String::new();
    for base in SOURCES {
        match c.get(format!("{base}{MANIFEST_FILE}")).send() {
            Ok(r) if r.status().is_success() => match r.text() {
                Ok(text) => match serde_json::from_str::<Manifest>(&text) {
                    Ok(m) => {
                        if let Ok(p) = manifest_cache(app) {
                            let _ = fs::write(p, &text);
                        }
                        return Ok(m);
                    }
                    Err(e) => last = format!("清单格式不对: {e}"),
                },
                Err(e) => last = e.to_string(),
            },
            Ok(r) => last = format!("HTTP {}", r.status()),
            Err(e) => last = e.to_string(),
        }
    }
    if let Ok(cached) = fs::read_to_string(manifest_cache(app)?) {
        if let Ok(m) = serde_json::from_str::<Manifest>(&cached) {
            return Ok(m);
        }
    }
    Err(format!("获取字体清单失败({last})"))
}

/// 下载并安装一款字体。边下边 `emit` 进度;下完校验 sha256,不符直接删文件报错 ——
/// 半截字体装上去正文会变成一片豆腐块,比下载失败难查得多。
pub fn install(app: &AppHandle, meta: &FontMeta) -> Result<InstalledFont, String> {
    let dir = fonts_dir(app)?;
    let dest = dir.join(&meta.file);
    let tmp = dir.join(format!("{}.part", meta.id));

    let c = client(600)?;
    let mut last = String::new();
    let mut ok = false;
    for base in SOURCES {
        match c.get(format!("{base}{}", meta.file)).send() {
            Ok(mut r) if r.status().is_success() => {
                let total = r.content_length().unwrap_or(meta.size);
                let mut out = fs::File::create(&tmp).map_err(|e| format!("建临时文件失败: {e}"))?;
                let mut buf = vec![0u8; 64 * 1024];
                let mut got: u64 = 0;
                let mut last_emit = 0u64;
                let mut broke = false;
                loop {
                    let n = match r.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(e) => {
                            last = e.to_string();
                            broke = true;
                            break;
                        }
                    };
                    if std::io::Write::write_all(&mut out, &buf[..n]).is_err() {
                        return Err("写入字体文件失败(磁盘空间不足?)".into());
                    }
                    got += n as u64;
                    // 每 256KB 报一次进度,别把 IPC 刷爆
                    if got - last_emit >= 256 * 1024 {
                        last_emit = got;
                        let _ = app.emit("font-progress", Progress { id: meta.id.clone(), received: got, total });
                    }
                }
                drop(out);
                if !broke {
                    let _ = app.emit("font-progress", Progress { id: meta.id.clone(), received: got, total });
                    ok = true;
                    break;
                }
                let _ = fs::remove_file(&tmp);
            }
            Ok(r) => last = format!("HTTP {}", r.status()),
            Err(e) => last = e.to_string(),
        }
    }
    if !ok {
        return Err(format!("下载失败({last})"));
    }

    let bytes = fs::read(&tmp).map_err(|e| format!("回读字体文件失败: {e}"))?;
    if !meta.sha256.is_empty() {
        let got = hex(&Sha256::digest(&bytes));
        if !got.eq_ignore_ascii_case(&meta.sha256) {
            let _ = fs::remove_file(&tmp);
            return Err("字体文件校验不通过,已删除。请重试或换个网络".into());
        }
    }
    fs::rename(&tmp, &dest).map_err(|e| format!("安装字体失败: {e}"))?;

    let rec = InstalledFont {
        id: meta.id.clone(),
        name: meta.name.clone(),
        family: meta.family.clone(),
        file: meta.file.clone(),
        size: bytes.len() as u64,
    };
    let mut list = load_installed(app);
    list.retain(|f| f.id != rec.id);
    list.push(rec.clone());
    save_installed(app, &list)?;
    Ok(rec)
}

pub fn uninstall(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut list = load_installed(app);
    if let Some(f) = list.iter().find(|f| f.id == id) {
        let _ = fs::remove_file(fonts_dir(app)?.join(&f.file));
    }
    list.retain(|f| f.id != id);
    save_installed(app, &list)
}

/// 给 inkfont 协议用:按 id 取字体字节 + MIME
pub fn read_font(app: &AppHandle, id: &str) -> Result<(Vec<u8>, &'static str), String> {
    let f = load_installed(app)
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("未安装的字体: {id}"))?;
    let bytes = fs::read(fonts_dir(app)?.join(&f.file)).map_err(|e| format!("读字体失败: {e}"))?;
    let mime = match f.file.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "otf" => "font/otf",
        _ => "font/ttf",
    };
    Ok((bytes, mime))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
