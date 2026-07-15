package com.tanyudii.tmuxweb.navigation

import kotlinx.serialization.Serializable

/**
 * The nav graph mounted inside `MainNavHost` (see App.kt) once a connection
 * is saved. Settings itself is deliberately not part of this graph — see
 * App.kt's top-level `when` for why.
 */
sealed interface Route {
    @Serializable
    data object Projects : Route

    @Serializable
    data class Sessions(val projectId: String, val projectName: String) : Route

    @Serializable
    data class Terminal(val sessionFullName: String, val sessionName: String) : Route
}
