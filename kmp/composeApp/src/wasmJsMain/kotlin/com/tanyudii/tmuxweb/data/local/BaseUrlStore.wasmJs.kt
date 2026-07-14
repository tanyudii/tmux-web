package com.tanyudii.tmuxweb.data.local

import kotlinx.browser.localStorage

actual class BaseUrlStore actual constructor() {
    actual suspend fun saveBaseUrl(baseUrl: String) {
        localStorage.setItem(KEY, baseUrl)
    }

    actual suspend fun loadBaseUrl(): String? = localStorage.getItem(KEY)

    actual suspend fun deleteBaseUrl() {
        localStorage.removeItem(KEY)
    }

    private companion object {
        const val KEY = "tmux-web.baseUrl"
    }
}
