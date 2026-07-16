package com.tanyudii.tmuxweb.domain

// No browser Clipboard API restriction on native iOS.
actual fun isSecureContext(): Boolean = true
