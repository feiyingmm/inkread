package com.inkread.app

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.roundToInt

/**
 * 墨阅的 Android 宿主 Activity。
 *
 * 本文件是**真身**,由 `scripts/android-postinit.sh` 在 `tauri android init` 之后
 * 覆盖到 `src-tauri/gen/android/.../MainActivity.kt`。gen 目录在 .gitignore 里,
 * 直接改生成物会在下次 init(以及每一次 CI 构建)时被模板覆盖掉。
 *
 * 这里只做一件 Tauri 不管、但移动端必须做的事:**把系统窗口内边距喂给 WebView 的 CSS**。
 *
 * 起因:targetSdk 35+ 起 Android 强制边到边(模板里的 `enableEdgeToEdge()`),
 * 于是 `windowSoftInputMode=adjustResize` 失效 —— 软键盘弹出时窗口不再缩小,
 * WebView 一无所知,弹层输入框被键盘整个盖住(0.3.3 实测)。
 * 另一头,WebView 里的 `env(safe-area-inset-*)` 在 Android 上恒为 0,
 * 顶部让位只能写死 30px 猜,底部手势条则会压住状态条文字。
 *
 * 由原生把真实数值写成 CSS 变量(--safe-top / --safe-bottom / --kb),两个问题一起解决;
 * 前端只用变量,不必关心平台差异。
 */
class MainActivity : TauriActivity() {
  private var webview: WebView? = null

  /** 最近一次算好的注入脚本。WebView 未就绪、或页面刚加载完把 style 冲掉时都靠它补发 */
  private var lastJs: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // 返回 insets 原样,让子 View 仍能收到(我们只是旁听,不消费)
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { _, insets ->
      publishInsets(insets)
      insets
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    webview = webView
    // WebView 是在 onCreate 之后才建的,主动再要一次内边距
    ViewCompat.requestApplyInsets(findViewById(android.R.id.content))
    // 冷启动时 WebView 还在加载,首次注入的 inline style 会随导航一起丢掉
    // (软键盘那次注入发生在加载之后,所以不受影响 —— 只有首帧的安全区需要补发)。
    // 没有可靠的"SPA 就绪"回调,按几个递增的时间点重发,幂等、代价可忽略。
    for (delay in longArrayOf(150, 600, 1500, 3000)) {
      webView.postDelayed({ lastJs?.let { webView.evaluateJavascript(it, null) } }, delay)
    }
  }

  override fun onResume() {
    super.onResume()
    // 从系统授权页/分屏切回来时窗口内边距可能变了,顺手重发一次
    webview?.let { view -> view.post { lastJs?.let { view.evaluateJavascript(it, null) } } }
  }

  private fun publishInsets(insets: WindowInsetsCompat) {
    val density = resources.displayMetrics.density
    val bars = insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
    val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    // ime inset 从屏幕底边算起,含被键盘盖住的那条导航栏;CSS 侧要的是"键盘净高"
    val keyboard = if (imeBottom > 0) (imeBottom - bars.bottom).coerceAtLeast(0) else 0

    val js = StringBuilder()
      .append("(function(){var s=document.documentElement.style;")
      .append("s.setProperty('--safe-top','").append(toCssPx(bars.top, density)).append("px');")
      .append("s.setProperty('--safe-bottom','").append(toCssPx(bars.bottom, density)).append("px');")
      .append("s.setProperty('--kb','").append(toCssPx(keyboard, density)).append("px');")
      .append(
        if (keyboard > 0) "document.documentElement.dataset.kb='1';"
        else "delete document.documentElement.dataset.kb;"
      )
      .append("window.dispatchEvent(new Event('inkread-insets'));})()")
      .toString()

    lastJs = js
    webview?.let { view -> view.post { view.evaluateJavascript(js, null) } }
  }

  private fun toCssPx(value: Int, density: Float): Int =
    if (density > 0f) (value / density).roundToInt() else value
}
