package com.tanyudii.tmuxweb.domain

// No "URL the app was accessed from" concept on native iOS.
actual fun defaultServerUrl(): String? = null
