package com.tanyudii.tmuxweb.domain

actual fun isPageHidden(): Boolean = js("document.hidden")

actual fun hasWindowFocus(): Boolean = js("document.hasFocus()")
