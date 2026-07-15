import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.targets.js.webpack.KotlinWebpackConfig

plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.composeMultiplatform)
    alias(libs.plugins.composeCompiler)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.kover)
    alias(libs.plugins.detekt)
}

kotlin {
    // expect/actual classes (PlatformTerminalHandle) are Beta as of Kotlin 2.3.20 —
    // acceptable for a small/medium app per the plan; revisit if/when stabilized.
    targets.configureEach {
        compilations.configureEach {
            compileTaskProvider.configure {
                compilerOptions {
                    freeCompilerArgs.add("-Xexpect-actual-classes")
                }
            }
        }
    }

    listOf(
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach { iosTarget ->
        iosTarget.binaries.framework {
            baseName = "ComposeApp"
            isStatic = true
        }
    }

    // Coverage-only target: Kover has no Kotlin/Native or Kotlin/Wasm support
    // (confirmed against Kover's own docs), so without a JVM target the
    // `koverVerify` 80% gate below has nothing to instrument and passes
    // trivially on 0-missed/0-covered — not a real signal. commonTest runs
    // here too, giving Kover real JVM bytecode for commonMain to measure.
    // Not a real product target: no desktop UI entry point is wired up.
    jvm {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    @OptIn(ExperimentalWasmDsl::class)
    wasmJs {
        browser {
            // `wasmJsBrowserDevelopmentRun` proxies /api and /ws* to a locally
            // running `npm run dev` backend (default port from src/config.ts's
            // DEFAULT_PORT) so local iteration never needs backend-side CORS —
            // same-origin from the browser's point of view. Override the
            // target with -PbackendUrl=http://host:port for a non-default
            // local backend. Production serves this build same-origin
            // directly from the backend (see src/main.ts's publicDir wiring),
            // where this proxy plays no role at all.
            val backendUrl = (project.findProperty("backendUrl") as String?) ?: "http://127.0.0.1:5309"
            commonWebpackConfig {
                devServer = (devServer ?: KotlinWebpackConfig.DevServer()).copy(
                    proxy = mutableListOf(
                        KotlinWebpackConfig.DevServer.Proxy(
                            context = mutableListOf("/api", "/ws"),
                            target = backendUrl,
                        ),
                    ),
                )
            }
        }
        binaries.executable()
    }

    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.components.resources)
            implementation(compose.ui)

            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)

            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.websockets)
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.serialization.kotlinx.json)

            implementation(libs.koin.core)
            implementation(libs.koin.compose)
            implementation(libs.navigation.compose)
        }

        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.kotest.assertions.core)
            implementation(libs.turbine)
            implementation(libs.ktor.client.mock)
            implementation(libs.koin.test)
        }

        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
        }

        getByName("wasmJsMain") {
            dependencies {
                implementation(libs.ktor.client.js)
                implementation(libs.kotlinx.browser)
            }
        }

        jvmMain.dependencies {
            implementation(libs.ktor.client.cio)
        }
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom("$rootDir/config/detekt/detekt.yml")
    // The detekt Gradle plugin only auto-discovers JVM-style main/test source
    // sets; KMP's per-target source sets need pointing at explicitly.
    source.setFrom(
        "src/commonMain/kotlin",
        "src/commonTest/kotlin",
        "src/iosMain/kotlin",
        "src/wasmJsMain/kotlin",
    )
}

kover {
    reports {
        filters {
            excludes {
                // Compose UI screens and navigation wiring: per plan §3.7,
                // automated UI-tree tests have limited value on these
                // targets, so the primary automated layer is ViewModel/
                // state-logic tests (already covered below) and each screen
                // gets a manual QA pass instead — a deliberate scope call,
                // not a gap.
                packages("com.tanyudii.tmuxweb.ui")
                // Platform entry points (App.kt, MainViewController.kt,
                // main.kt) and generated Compose resource accessors — pure
                // wiring/codegen, nothing to unit-test.
                classes("com.tanyudii.tmuxweb.AppKt", "com.tanyudii.tmuxweb.MainViewControllerKt", "com.tanyudii.tmuxweb.MainKt")
                packages("tmux_web_kmp.composeapp.generated.resources")
                // Platform expect/actual glue verified by manual on-device
                // QA, not unit tests (Keychain/localStorage/SwiftTerm/
                // xterm.js interop) — same reasoning as the UI layer above.
                // The jvmMain actuals exist purely so Kover has JVM bytecode
                // to instrument at all (see the jvm() target comment); they
                // have no real behavior of their own to verify.
                packages("com.tanyudii.tmuxweb.terminal")
                classes(
                    "com.tanyudii.tmuxweb.data.local.TokenStore",
                    "com.tanyudii.tmuxweb.data.local.BaseUrlStore",
                )
                // KtorTerminalSocket: Ktor's MockEngine has no WebSocket
                // support on the client side (ktorio/ktor#1413, open since
                // 2020) — a real, external tooling gap, not an oversight.
                // Testing it properly needs an embedded test server, out of
                // scope for this pass; ClientMessage.kt's pure wire-format
                // logic in the same package is still fully tested.
                classes("com.tanyudii.tmuxweb.data.remote.terminal.KtorTerminalSocket")
            }
        }
        verify {
            rule {
                minBound(80)
            }
        }
    }
}
