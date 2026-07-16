package com.tanyudii.tmuxweb.domain

actual fun isSecureContext(): Boolean = js("window.isSecureContext")
