package com.tanyudii.tmuxweb.data.local

import kotlinx.browser.localStorage

actual class TokenStore actual constructor() {
    actual suspend fun saveToken(token: String) {
        localStorage.setItem(KEY, token)
    }

    actual suspend fun loadToken(): String? = localStorage.getItem(KEY)

    actual suspend fun deleteToken() {
        localStorage.removeItem(KEY)
    }

    private companion object {
        const val KEY = "tmux-web.token"
    }
}
