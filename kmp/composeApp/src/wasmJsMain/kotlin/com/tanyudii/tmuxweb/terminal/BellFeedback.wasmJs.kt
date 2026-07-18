@file:OptIn(ExperimentalWasmJsInterop::class)

package com.tanyudii.tmuxweb.terminal

import kotlin.js.ExperimentalWasmJsInterop

// Web bell delivery (title flash + beep + Notification, per plan §2.6) --
// see BellFeedback.kt's shared doc comment. All three are best-effort and
// independent of each other (each wrapped in its own try/catch inside the
// raw js() bodies below), so e.g. a browser that blocks Web Audio still
// gets the title flash and vice versa.
actual fun triggerBellFeedback(title: String) {
    playBellBeep()
    flashBellTitle(title)
    showBellNotification(title)
}

// A short synthesized tone via the Web Audio API -- no audio asset to ship
// or fetch. Wrapped in try/catch: some browsers require a prior user
// gesture before any AudioContext will actually produce sound, in which
// case this silently no-ops rather than throwing through Kotlin/Wasm's
// interop boundary.
private fun playBellBeep(): Unit = js(
    """{
        try {
            var AudioCtx = window.AudioContext || window.webkitAudioContext;
            var ctx = new AudioCtx();
            var oscillator = ctx.createOscillator();
            var gain = ctx.createGain();
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.15);
            oscillator.onended = function () { ctx.close(); };
        } catch (e) {}
    }""",
)

// Alternates document.title between [title] and whatever it was before,
// until the tab is both visible and focused again -- state lives on
// `window._tmuxBell` (same "stash state on a persistent JS object" pattern
// as XtermJs.kt's showCopyToast, which uses the toast DOM element itself;
// there's no equivalent element for "the whole page" here). Re-triggering
// while already flashing just updates the alert text for the next tick
// instead of restarting the interval or stacking a second one.
@Suppress("UnusedParameter")
private fun flashBellTitle(title: String): Unit = js(
    """{
        if (!window._tmuxBell) window._tmuxBell = {};
        var state = window._tmuxBell;
        state.alertTitle = title;
        if (state.intervalId) return;
        state.originalTitle = document.title;
        var showingAlert = false;
        state.intervalId = setInterval(function () {
            document.title = showingAlert ? state.originalTitle : state.alertTitle;
            showingAlert = !showingAlert;
        }, 1000);
        function stop() {
            if (!state.intervalId) return;
            clearInterval(state.intervalId);
            state.intervalId = null;
            document.title = state.originalTitle;
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        }
        function onVisible() {
            if (!document.hidden && document.hasFocus()) stop();
        }
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
    }""",
)

// Only fires when permission was already granted by an earlier explicit
// user action (the "Enable push notifications" toggle -- see
// PushNotifications.wasmJs.kt) -- deliberately never calls
// Notification.requestPermission() itself. Auto-prompting from a bell
// event (not a user gesture) would either be silently ignored by the
// browser or, worse, burn the one permission prompt a user gets before
// having to dig through browser site-settings to retry.
@Suppress("UnusedParameter")
private fun showBellNotification(title: String): Unit = js(
    """{
        try {
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            new Notification(title, { body: 'tmux-web', tag: 'tmux-web-bell' });
        } catch (e) {}
    }""",
)
