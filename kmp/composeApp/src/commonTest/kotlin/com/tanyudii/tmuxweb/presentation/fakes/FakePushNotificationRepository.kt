package com.tanyudii.tmuxweb.presentation.fakes

import com.tanyudii.tmuxweb.domain.model.PushSubscriptionPayload
import com.tanyudii.tmuxweb.domain.repository.PushNotificationRepository

class FakePushNotificationRepository(private val publicKey: String = "vapid-public-key") :
    PushNotificationRepository {
    var getPublicKeyError: Throwable? = null
    var subscribeError: Throwable? = null
    var unsubscribeError: Throwable? = null
    var subscribeCalls = mutableListOf<PushSubscriptionPayload>()
    var unsubscribeCalls = mutableListOf<String>()

    override suspend fun getPublicKey(): String {
        getPublicKeyError?.let { throw it }
        return publicKey
    }

    override suspend fun subscribe(subscription: PushSubscriptionPayload) {
        subscribeError?.let { throw it }
        subscribeCalls.add(subscription)
    }

    override suspend fun unsubscribe(endpoint: String) {
        unsubscribeError?.let { throw it }
        unsubscribeCalls.add(endpoint)
    }
}
