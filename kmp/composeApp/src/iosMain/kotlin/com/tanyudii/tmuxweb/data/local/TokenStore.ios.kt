package com.tanyudii.tmuxweb.data.local

import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFMutableDictionaryRef
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleWhenUnlockedThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

/**
 * Direct port of KeychainStore.swift — same service/account identifiers,
 * same `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (device-only, no
 * iCloud Keychain sync). Builds the query as a pure CFDictionary (CFStringRef
 * keys added via CFDictionaryAddValue) rather than routing through
 * NSMutableDictionary + a CFStringRef->Kotlin String cast — that cast is not
 * a real bridging operation in Kotlin/Native (kSecClass et al. are opaque
 * CFStringRef pointers, not NSString-backed objects) and crashes at runtime
 * with a ClassCastException, which is what the first real-device run of this
 * file caught.
 */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
actual class TokenStore actual constructor() {
    actual suspend fun saveToken(token: String) {
        deleteToken()
        val dict = baseQuery()
        val tokenData = CFBridgingRetain(NSString.create(string = token).dataUsingEncoding(NSUTF8StringEncoding))
        CFDictionaryAddValue(dict, kSecValueData, tokenData)
        CFDictionaryAddValue(dict, kSecAttrAccessible, kSecAttrAccessibleWhenUnlockedThisDeviceOnly)
        SecItemAdd(dict, null)
        tokenData?.let { CFBridgingRelease(it) }
        CFRelease(dict)
    }

    actual suspend fun loadToken(): String? = memScoped {
        val dict = baseQuery()
        CFDictionaryAddValue(dict, kSecReturnData, kCFBooleanTrue)
        CFDictionaryAddValue(dict, kSecMatchLimit, kSecMatchLimitOne)

        val resultVar = alloc<CFTypeRefVar>()
        val status = SecItemCopyMatching(dict, resultVar.ptr)
        CFRelease(dict)
        if (status != errSecSuccess) return@memScoped null
        val data = CFBridgingRelease(resultVar.value) as? NSData ?: return@memScoped null
        @Suppress("USELESS_CAST") // NSString -> String is a real toll-free-bridging cast here, not a no-op
        NSString.create(data = data, encoding = NSUTF8StringEncoding) as String?
    }

    actual suspend fun deleteToken() {
        val dict = baseQuery()
        SecItemDelete(dict)
        CFRelease(dict)
    }

    private fun baseQuery(): CFMutableDictionaryRef {
        val dict = requireNotNull(CFDictionaryCreateMutable(null, 0, null, null))
        CFDictionaryAddValue(dict, kSecClass, kSecClassGenericPassword)
        CFDictionaryAddValue(dict, kSecAttrService, CFBridgingRetain(SERVICE))
        CFDictionaryAddValue(dict, kSecAttrAccount, CFBridgingRetain(ACCOUNT))
        return dict
    }

    private companion object {
        const val SERVICE = "com.tanyudii.tmuxweb.token"
        const val ACCOUNT = "com.tanyudii.tmuxweb.token.account"
    }
}
