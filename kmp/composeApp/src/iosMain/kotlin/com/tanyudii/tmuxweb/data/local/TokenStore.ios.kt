package com.tanyudii.tmuxweb.data.local

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.CFTypeRefVar
import platform.Foundation.NSData
import platform.Foundation.NSMutableDictionary
import platform.Foundation.NSString
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.setValue
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
 * iCloud Keychain sync). UNVERIFIED at runtime (no iOS simulator in this dev
 * environment); Kotlin/Native's cinterop against `Security.framework`
 * compiles here (`compileKotlinIosSimulatorArm64`), which catches signature
 * mismatches, but not runtime Keychain behavior — that's a CI/real-device
 * check, same caveat as ADR 0001's SwiftTerm bridge.
 */
@OptIn(ExperimentalForeignApi::class)
actual class TokenStore actual constructor() {
    actual suspend fun saveToken(token: String) {
        deleteToken()
        val query = baseQuery()
        val tokenData = NSString.create(string = token).dataUsingEncoding(NSUTF8StringEncoding)
        query.setValue(tokenData, forKey = kSecValueDataKey)
        query.setValue(kSecAttrAccessibleWhenUnlockedThisDeviceOnly, forKey = kSecAttrAccessibleKey)
        SecItemAdd(query.asCfDictionary(), null)
    }

    actual suspend fun loadToken(): String? = memScoped {
        val query = baseQuery()
        query.setValue(true, forKey = kSecReturnDataKey)
        query.setValue(kSecMatchLimitOne, forKey = kSecMatchLimitKey)

        val resultVar = alloc<CFTypeRefVar>()
        val status = SecItemCopyMatching(query.asCfDictionary(), resultVar.ptr)
        if (status != errSecSuccess) return@memScoped null
        val data = resultVar.value as? NSData ?: return@memScoped null
        NSString.create(data = data, encoding = NSUTF8StringEncoding) as String?
    }

    actual suspend fun deleteToken() {
        SecItemDelete(baseQuery().asCfDictionary())
    }

    private fun baseQuery(): NSMutableDictionary {
        val dict = NSMutableDictionary()
        dict.setValue(kSecClassGenericPassword, forKey = kSecClassKey)
        dict.setValue(SERVICE, forKey = kSecAttrServiceKey)
        dict.setValue(ACCOUNT, forKey = kSecAttrAccountKey)
        return dict
    }

    private companion object {
        const val SERVICE = "com.tanyudii.tmuxweb.token"
        const val ACCOUNT = "com.tanyudii.tmuxweb.token.account"

        // NSDictionary keys must be Kotlin String, not the raw CFStringRef
        // constants Security.framework exposes — bridging cast, same pattern
        // used by the multiplatform-settings library's KeychainSettings.
        val kSecClassKey = kSecClass.toKotlinStringKey()
        val kSecAttrServiceKey = kSecAttrService.toKotlinStringKey()
        val kSecAttrAccountKey = kSecAttrAccount.toKotlinStringKey()
        val kSecValueDataKey = kSecValueData.toKotlinStringKey()
        val kSecAttrAccessibleKey = kSecAttrAccessible.toKotlinStringKey()
        val kSecReturnDataKey = kSecReturnData.toKotlinStringKey()
        val kSecMatchLimitKey = kSecMatchLimit.toKotlinStringKey()
    }
}

@OptIn(ExperimentalForeignApi::class)
private fun CFTypeRef?.toKotlinStringKey(): String = this as String

@OptIn(ExperimentalForeignApi::class)
private fun NSMutableDictionary.asCfDictionary(): CFDictionaryRef = this as CFDictionaryRef
