@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import kotlin.js.ExperimentalWasmJsInterop

// document.visibilityState (not just `document.hidden`) lets onVisible ignore
// the "prerender"/other non-visible states some browsers report; pageshow
// covers the bfcache-restore case, which does not always also fire
// visibilitychange. Returned as an external JsAny object (same idiom as
// XtermJs.kt's ResizeObserver) so `dispose` can be called back from Kotlin
// without needing to keep a raw JS function reference around ourselves.
external interface ForegroundObserverHandle : JsAny {
    fun dispose()
}

@Suppress("UnusedParameter")
private fun registerForegroundListeners(callback: () -> Unit): ForegroundObserverHandle = js(
    """{
        function onVisible() {
            if (document.visibilityState === 'visible') callback();
        }
        function onPageShow() { callback(); }
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', onPageShow);
        return {
            dispose: function () {
                document.removeEventListener('visibilitychange', onVisible);
                window.removeEventListener('pageshow', onPageShow);
            }
        };
    }""",
)

actual fun observeAppForeground(onForeground: () -> Unit): () -> Unit {
    val handle = registerForegroundListeners(onForeground)
    return { handle.dispose() }
}
