package com.tanyudii.tmuxweb.domain

// window.location.origin is already "scheme://host[:port]" with no trailing
// slash -- exactly ServerUrl.kt's SERVER_URL_PATTERN, no reassembly needed.
actual fun defaultServerUrl(): String? = currentOrigin().ifEmpty { null }

private fun currentOrigin(): String = js("window.location.origin")
