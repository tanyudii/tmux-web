package com.tanyudii.tmuxweb

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeViewport
import com.tanyudii.tmuxweb.di.initKoin
import kotlinx.browser.document

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    initKoin()
    // Mounts into the dedicated #composeApp div (index.html), not
    // document.body directly -- see index.html's <style> comment for why
    // mounting straight to body creates a circular canvas/body sizing
    // loop that produces unwanted browser scrollbars.
    ComposeViewport(document.getElementById("composeApp")!!) {
        App()
    }
}
