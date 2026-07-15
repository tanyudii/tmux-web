package com.tanyudii.tmuxweb.terminal

import platform.UIKit.UINotificationFeedbackGenerator
import platform.UIKit.UINotificationFeedbackType

// Plain UIKit cinterop (platform.UIKit.*), not the SwiftTerm IoC-factory
// pattern — no Swift-side registration needed, unlike PlatformTerminalView.
actual fun triggerBellFeedback() {
    UINotificationFeedbackGenerator().notificationOccurred(UINotificationFeedbackType.UINotificationFeedbackTypeWarning)
}
