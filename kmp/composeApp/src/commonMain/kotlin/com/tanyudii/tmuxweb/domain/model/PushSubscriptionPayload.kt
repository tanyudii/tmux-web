package com.tanyudii.tmuxweb.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class PushSubscriptionKeys(val p256dh: String, val auth: String)

/** Mirrors src/push-notifications.ts's PushSubscriptionRecord exactly. */
@Serializable
data class PushSubscriptionPayload(val endpoint: String, val keys: PushSubscriptionKeys)

@Serializable
data class PushPublicKeyResponse(val publicKey: String)
