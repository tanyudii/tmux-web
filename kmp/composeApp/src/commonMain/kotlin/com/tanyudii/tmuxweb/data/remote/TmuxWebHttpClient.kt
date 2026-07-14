package com.tanyudii.tmuxweb.data.remote

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType

/**
 * Thin REST wrapper shared by every repository — mirrors APIClient.swift's
 * `checkStatus` (see .claude/plans/rebuild-web-ios-kmp.plan.md §2.2/§7): every
 * request carries `Authorization: Bearer <token>`, and every non-2xx response
 * maps to the same [ApiError] cases the server documents (`sendMappedError`
 * in src/server.ts).
 */
class TmuxWebHttpClient(
    @PublishedApi internal val httpClient: HttpClient,
    @PublishedApi internal val baseUrl: String,
    @PublishedApi internal val token: String,
) {
    suspend inline fun <reified T> getJson(path: String, params: Map<String, String> = emptyMap()): T {
        val response = httpClient.get(baseUrl + path) {
            header("Authorization", "Bearer $token")
            params.forEach { (key, value) -> parameter(key, value) }
        }
        checkStatus(response)
        return decodeBody(response)
    }

    suspend inline fun <reified TBody, reified TResponse> postJson(path: String, body: TBody): TResponse {
        val response = httpClient.post(baseUrl + path) {
            header("Authorization", "Bearer $token")
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        checkStatus(response)
        return decodeBody(response)
    }

    suspend fun post(path: String, params: Map<String, String> = emptyMap()): HttpResponse {
        val response = httpClient.post(baseUrl + path) {
            header("Authorization", "Bearer $token")
            params.forEach { (key, value) -> parameter(key, value) }
        }
        checkStatus(response)
        return response
    }

    suspend fun delete(path: String, params: Map<String, String> = emptyMap()): HttpResponse {
        val response = httpClient.delete(baseUrl + path) {
            header("Authorization", "Bearer $token")
            params.forEach { (key, value) -> parameter(key, value) }
        }
        checkStatus(response)
        return response
    }

    // Ktor's content-negotiation plugin can throw different exception types
    // depending on engine/content-type (JsonConvertException, kotlinx's own
    // SerializationException, ...) — this call IS the boundary between
    // "external server response" and "our typed model," so converting any
    // failure here into ApiError.Decoding is the point, not over-broad catching.
    @Suppress("TooGenericExceptionCaught")
    suspend inline fun <reified T> decodeBody(response: HttpResponse): T =
        try {
            response.body()
        } catch (e: Exception) {
            throw ApiError.Decoding(e)
        }

    suspend fun checkStatus(response: HttpResponse) {
        if (response.status.value in HTTP_SUCCESS_RANGE) return
        val bodyText = response.bodyAsText()
        val errorBody = runCatching { decodeErrorBody(bodyText) }.getOrNull()
        val message = errorBody?.error ?: bodyText
        throw when (response.status) {
            HttpStatusCode.Unauthorized -> ApiError.Unauthorized
            HttpStatusCode.NotFound -> ApiError.NotFound(message)
            HttpStatusCode.BadRequest -> ApiError.BadRequest(message)
            HttpStatusCode.Conflict -> ApiError.Conflict(message, errorBody?.sessionCount)
            else -> ApiError.Server(response.status.value, message)
        }
    }

    private fun decodeErrorBody(text: String): ApiErrorBody =
        kotlinx.serialization.json.Json.decodeFromString(ApiErrorBody.serializer(), text)

    private companion object {
        val HTTP_SUCCESS_RANGE = 200..299
    }
}
