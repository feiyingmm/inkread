# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

墨阅(inkread):跨平台 Markdown / 电子书 / PDF 阅读应用。Tauri 2(Windows NSIS + Android APK 一套代码)· Vue 3 + TypeScript + Vite · Rust(git2 / reqwest)。项目文档统一在 `D:\Jack\claude-docs\Personal\inkread\`(全局规则:项目内不新建 docs,本文件与代码注释除外);仓库 `README.md` 是对外的功能现状。

## 常用命令

```bash
npm install          # postinstall 自动把 node_modules/vditor/dist 拷到 public/vditor(不入 git)
npm run dev          # http://localhost:5173 —— 浏览器里开发全部真实功能,本机零 Rust
npm run typecheck    # vue-tsc --noEmit(没有 lint、没有单测,这就是全部静态检查)
npm run build        # typecheck + vite build → dist/(tauri build 的 beforeBuildCommand)
```

- 开发期文库注册在 `dev-server/repos.local.json`(首次 `npm run dev` 自动生成,默认指向 `D:\Jack\claude-docs`;不入 git)
- CI(`.github/workflows/ci.yml`)只跑 `npm run build` + `cargo check`;`cargo check` 前必须 `mkdir dist`——`tauri::generate_context!` 要求 `frontendDist` 目录存在
- 发版:`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 三处版本号一致后 `git tag vX.Y.Z && git push origin main vX.Y.Z`,`release.yml` 出 Windows NSIS 与 Android arm64 APK

## 🔴 本机构建 / 真机测试铁律:先读文档,再动手

凡是 **Android 真机调试、Windows 桌面端本机构建、`cargo check/build`、`tauri dev/build`、装机 / 取证**,动手前**必须完整读取** `D:\Jack\claude-docs\Personal\inkread\产品文档\真机调试环境.md`:

- **禁止凭记忆或推断拼环境变量**——整段复制该文档 §三 的启动块(§三之一 Android / §三之二 Windows),一行都不能挑着抄;两套启动块不要在同一个 shell 里混用
- 该文档 §四 的坑全是"不照抄就必犯"型;报错再明确也不构成跳过读文档的理由(这台机器的环境是一堆刻意取舍的结果,报错往往正是取舍的预期表现——已因此返工三次)
- 不装 Visual Studio / VS Build Tools / Android Studio;Android 用 GNU 工具链 + NDK,Windows 用便携 MSVC 目录 `D:\dev\msvc` + `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc`(默认工具链是 GNU,别改);一切工具链落 D 盘纯目录,新增任何缓存 / 工具先看会不会写回 C 盘
- **不要**在仓库加 `rust-toolchain.toml`——会改 Android 的宿主工具链,触发 vendored OpenSSL 全量重编
- 新踩的坑、耗时 / 体积的新实测,当场回写该文档对应章节 + 变更记录,并刷 `INDEX.md`

## 📝 功能开发必须同步文档

每次功能开发(新增 / 改动功能、修缺陷、调整机制)收尾时,**必须**把增加的功能记录进文档,缺一项视为未交付:

1. **项目总览** `产品文档\项目总览.md`:§三 功能清单追加条目(标版本号);新机制补 §二 架构;新坑补 §五;更新头部"最后更新"与变更记录
2. **仓库 `README.md`**:「功能全景」对应小节同步一句用户视角的描述(只写现状,不写过程)
3. **设计文档**:`开发文档\YYYY-MM-DD_<功能名>\设计文档.md`(brainstorming / writing-plans 产出一律落这里);有人工配置项时同目录出 `上线配置.md`
4. **`INDEX.md`**:新增文档登记一行,更新的长期文档刷"最后更新"列
5. claude-docs 变更合并为一个 commit 推送 Gitee(见该目录 `CLAUDE.md`)

## 架构

### 前端一切数据操作只经 `Backend` 一个契约

`src/core/backend/types.ts` 的 `interface Backend` 是前端唯一数据出口(文库 / 文件树 / 读写 / git / 搜索 / 字体 / 导出 / 多窗口);`index.ts` 按运行时 `window.__TAURI_INTERNALS__` 是否存在选实现:

| 实现 | 文件 | 背后 |
|------|------|------|
| `devBackend` | `src/core/backend/dev.ts` | HTTP → Vite 插件 `inkreadDevServer`(`dev-server/middleware.ts`,`case '/tree' / '/file' / '/sync' ...`)→ Node 直接调本机 `git` 与 fs(`dev-server/git.ts` / `repos.ts`) |
| `tauriBackend` | `src/core/backend/tauri.ts` | `invoke` → `src-tauri/src/lib.rs` 的 `#[tauri::command]`,注册在 `generate_handler![...]` |

**新增一个后端能力要改 4 处**:`types.ts` 加方法 → `dev.ts` + `middleware.ts` 加路由 → `tauri.ts` + Rust 命令(实现放 `fsops.rs` / `gitops.rs` / `fonts.rs`,`lib.rs` 里 `#[tauri::command]` 包一层并加进 `generate_handler!`)。两端语义必须一致(例:git 文件树 = `ls-files --cached --others --exclude-standard`,dev 侧与 `fsops::open_repo_at` 同规则),README 承诺"浏览器即可开发全部真实功能"靠的就是这一点。

二进制资源不走 IPC:仓库内图片经自定义协议 `repo://`(`serve_repo_asset`),已下载字体经 `inkfont://`(`fonts::read_font`)—— base64 过 IPC 每次启动烧 13MB 字符串,不可行;dev 侧对应 `/raw` 路由。

### Rust 侧(`src-tauri/src`)

- `lib.rs`:全部命令、两个 URI 协议、单实例插件(桌面;双击 md 走 `pick_md_from_args` 新开窗口而非顶掉已开内容,建窗必须 `spawn_window_off_main` 否则 Windows 死锁)、`android_jni`(禁 WebView 缩放 / 沉浸模式 / 拉起「所有文件访问」授权页)、`openssl_ffi`(Android 把 CA 根证书**在内存里**灌进 libgit2——vendored OpenSSL 是 no-stdio 编译,任何"给证书文件路径"的接口都是死路;别把 `openssl-sys` 提成直接依赖,会改构建指纹整个重编)
- `state.rs`:`repos.json` 文库注册表(`ephemeral` 单文件临时文库不落盘)+ `WindowTarget`;`gitops.rs`:pull / sync / discard,**永不覆盖远程、不代做合并**,冲突只返回 `conflict` / `divergent` 让 UI 提示;`fsops.rs`:树 / 读写 / 搜索;`fonts.rs`:字体清单双源 + sha256 校验下载;`tray.rs`:桌面托盘(仅非 Android 编译)
- Android 差异一律 `#[cfg(target_os = "android")]`;Android 上关掉 git2 属主校验(`/sdcard` 文件不属于 App uid),桌面保持默认

### 前端结构

- 单路由:`src/views/WorkspaceView.vue`(~1400 行)是壳,按 `core/paths.ts::fileKind()` 把当前文件分发给 `MarkdownView` / `EbookView`(epub/mobi,`core/epub.ts` `core/mobi.ts` `core/ebook.ts` 按需解压 + 3 章滑动窗口)/ `PdfView`(`core/pdf.ts`,只渲染视口附近页)/ `EditorView`(Vditor,仅桌面 markdown)。HTML 与纯文本也走 `MarkdownView`(`core/html-doc.ts` 作用域化样式、`pipeline.ts::renderPlainText`)
- Markdown 渲染管线 `src/core/markdown/`:`pipeline.ts` markdown-it(anchor / front-matter / katex / highlight.js)出 HTML → `enhance.ts`(代码块折叠复制、长表格浮动表头、标题锚点)/ `infocard.ts`(头部 `> - **产品**:` 元信息块 → 信息卡)/ `mermaid.ts` 在 DOM 上二次处理;文内查找用 CSS Custom Highlight API(`find-in-dom.ts`),**不往正文插 `<mark>`**
- 状态:Pinia 两个 store——`stores/repo.ts`(当前文库 / 文件 / 树)与 `stores/settings.ts`(主题 / 排版旋钮 / 字体,`TYPO_DEFAULT` 等默认值**必须取现值**保证升级零位移)。主题靠 `App.vue` 把 `data-brand / data-mode / data-paper / data-android` 与 `--prose-*` / `--font-body` 写到 `<html>`,CSS 在 `src/themes/tokens.css`(变量)/ `app.css`(界面)/ `reading.css`(正文)
- 移动端三大机制(详见项目总览 §二之一):返回键层栈 `core/backstack.ts`、整屏页外壳 `MobilePage.vue`、原生内边距 → CSS 变量桥(`scripts/android-postinit.sh` 注入宿主 Activity 代码,`gen/` 不入 git 每次 init 都要重跑该脚本)。桌面端边缘悬浮侧栏在 `core/edge-peek.ts`(指针坐标 + 元素矩形判定,不是 mouseenter/leave)
- `__APP_VERSION__` 由 `vite.config.ts` 从 `package.json` 注入;`TAURI_DEV_HOST` 存在时 vite 监听 0.0.0.0、HMR 走 5174(真机热更新)

### 代码风格

注释全部中文且解释"为什么这么做 / 试过什么不行"(见 `lib.rs` `copy-vditor.mjs` 的写法),沿用这一习惯;commit message 中文,`feat: ... (vX.Y.Z)` / `fix:` 前缀。
