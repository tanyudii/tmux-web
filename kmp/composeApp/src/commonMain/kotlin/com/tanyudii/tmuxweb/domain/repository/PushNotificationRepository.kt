package com.tanyudii.tmuxweb.domain.repository

import com.tanyudii.tmuxweb.data.remote.TmuxWebHttpClient
import com.tanyudii.tmuxweb.domain.model.PushPublicKeyResponse
import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload
import kotlinx.serialization.Serializable

/** Mirrors the `/api/push/...` endpoints -- see src/push-notifications.ts + src/server.ts. */
interface PushNotificationRepository {
    suspend fun getPublicKey(): String
    suspend fun subscribe(subscription: PushSubscriptionPayload)
    suspend fun unsubscribe(endpoint: String)
}

@Serializable
private data class UnsubscribeRequest(val endpoint: String)

class KtorPushNotificationRepository(private val client: TmuxWebHttpClient) : PushNotificationRepository {
    override suspend fun getPublicKey(): String =
        client.getJson<PushPublicKeyResponse>("/api/push/public-key").publicKey

    override suspend fun subscribe(subscription: PushSubscriptionPayload) {
        client.postJson<PushSubscriptionPayload, Unit>("/api/push/subscribe", subscription)
    }

    override suspend fun unsubscribe(endpoint: String) {
        client.postJson<UnsubscribeRequest, Unit>("/api/push/unsubscribe", UnsubscribeRequest(endpoint))
    }
}
