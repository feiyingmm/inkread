#!/usr/bin/env bash
# `npx tauri android init` 之后运行:注入存储权限 + 应用品牌图标。
# 本地真机调试(Git Bash)与 CI(release.yml)共用,避免两处配置漂移。
set -e
cd "$(dirname "$0")/.."

M=src-tauri/gen/android/app/src/main/AndroidManifest.xml
if [ ! -f "$M" ]; then
  echo "未找到 $M —— 请先执行: npx tauri android init" >&2
  exit 1
fi

# 存储权限:「添加本地仓库」需要读写应用外目录(Android 11+ 还须用户在系统授权页开启「所有文件访问」,App 内会自动拉起)
if grep -q MANAGE_EXTERNAL_STORAGE "$M"; then
  echo "存储权限已存在,跳过注入"
else
  sed -i 's#<application#<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />\n    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />\n    <application#' "$M"
  echo "已注入存储权限,uses-permission 共 $(grep -c 'uses-permission' "$M") 条"
fi

# 品牌图标
if [ -d src-tauri/icons/android ]; then
  cp -r src-tauri/icons/android/* src-tauri/gen/android/app/src/main/res/
  echo "已应用品牌图标"
fi

# BuildTask 的 CLI runner:init 时若经 `node tauri.js` 启动会被记成 node 绝对路径,
# 导致 gradle 执行 `node tauri ...` 失败;统一改为 npx(gradle 会自动尝试 npx.cmd)
BT=$(ls src-tauri/gen/android/buildSrc/src/main/java/*/*/*/kotlin/BuildTask.kt 2>/dev/null | head -1)
if [ -n "$BT" ] && grep -q 'nodejs..node"""' "$BT"; then
  sed -i 's#val executable = """.*nodejs.node"""#val executable = """npx"""#' "$BT"
  echo "已修正 BuildTask runner 为 npx"
fi
