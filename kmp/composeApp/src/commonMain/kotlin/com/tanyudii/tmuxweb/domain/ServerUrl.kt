package com.tanyudii.tmuxweb.domain

/**
 * Ports ConnectionSettingsView.swift's `URL(string:) ... scheme != nil && host != nil`
 * check. Kotlin common has no `java.net.URL`, and Ktor's `Url` parser is more
 * permissive than this screen wants (it accepts scheme-less/host-less
 * strings by falling back to defaults) — this pure function stays a direct,
 * testable port of the exact validation the sheet performs, normalized down
 * to `scheme://host[:port]` (any path suffix is dropped; every endpoint is
 * built by appending a path to this base, see TmuxWebHttpClient).
 */
private val SERVER_URL_PATTERN = Regex("^(https?)://([^/\\s]+)(/.*)?$")

fun parseServerUrl(text: String): String? {
    val match = SERVER_URL_PATTERN.matchEntire(text.trim()) ?: return null
    val scheme = match.groupValues[1]
    val hostAndPort = match.groupValues[2]
    if (hostAndPort.isEmpty()) return null
    return "$scheme://$hostAndPort"
}
