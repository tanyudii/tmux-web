package com.tanyudii.tmuxweb.data.local

import platform.Foundation.NSUserDefaults

/**
 * Direct port of ConnectionSettingsStore.swift's `UserDefaults` half — the
 * base URL is not a secret, unlike [TokenStore].
 */
actual class BaseUrlStore actual constructor() {
    private val defaults = NSUserDefaults.standardUserDefaults

    actual suspend fun saveBaseUrl(baseUrl: String) {
        defaults.setObject(baseUrl, forKey = KEY)
    }

    actual suspend fun loadBaseUrl(): String? = defaults.stringForKey(KEY)

    actual suspend fun deleteBaseUrl() {
        defaults.removeObjectForKey(KEY)
    }

    private companion object {
        const val KEY = "tmuxweb.baseURL"
    }
}
