package com.tanyudii.tmuxweb.domain

/**
 * Prefills ConnectionSettingsViewModel's Server URL field from the address
 * the app was actually loaded from -- on Web this is always the right
 * default because src/main.ts serves the API and this Compose bundle from
 * the same origin (see kmp/composeApp/build.gradle.kts's wasmJs target
 * comment). Returns null on platforms with no "URL the app was accessed
 * from" concept (iOS, JVM), where the caller falls back to its prior
 * hardcoded default.
 */
expect fun defaultServerUrl(): String?
