package org.bismillah.reader

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The page stops at the system bars, so text never scrolls under them. The bars keep
    // showing the window's background, the page's own colour.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(Bars(), "bismillahBars")
  }

  /** The page says which theme it's in, since the app's setting can differ from the system's. */
  private inner class Bars {
    @JavascriptInterface
    fun set(dark: Boolean) {
      runOnUiThread {
        // The page's surface-editor (src/styles/tokens.css), as in res/values*/themes.xml.
        val colour = Color.parseColor(if (dark) "#151515" else "#f7f6f2")
        window.setBackgroundDrawable(ColorDrawable(colour))
        WindowCompat.getInsetsController(window, window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }
  }
}
