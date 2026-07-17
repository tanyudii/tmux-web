package com.tanyudii.tmuxweb.terminal

import platform.UIKit.UINotificationFeedbackGenerator
import platform.UIKit.UINotificationFeedbackType

// Plain UIKit cinterop (platform.UIKit.*), not the SwiftTerm IoC-factory
// pattern — no Swift-side registration needed, unlike PlatformTerminalView.
// [title] is unused here: haptic feedback has no on-screen text; iOS's own
// push/local-notification delivery is a separate concern from this
// in-app-only signal.
@Suppress("UnusedParameter")
actual fun triggerBellFeedback(title: String) {
    UINotificationFeedbackGenerator().notificationOccurred(UINotificationFeedbackType.UINotificationFeedbackTypeWarning)
}
