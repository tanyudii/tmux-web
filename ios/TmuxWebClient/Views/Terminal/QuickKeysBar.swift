import SwiftUI

/// tmux-specific quick keys, shown docked above the terminal.
///
/// SwiftTerm's `TerminalView` already ships its own keyboard accessory
/// (`TerminalAccessory`, installed automatically by `TerminalView.init(frame:)`
/// -- see `override init` in TerminalSocket.swift) with Ctrl/Esc/Tab/arrow
/// keys, so this bar does not duplicate those. It only adds the one thing a
/// generic terminal keyboard can't know about: the tmux prefix chord
/// (`Ctrl+B` by default) and the interrupt/escape keys reached for most
/// often when driving tmux from a soft keyboard with no physical Ctrl key.
struct QuickKey: Identifiable {
    let id = UUID()
    let label: String
    /// Raw bytes to inject, as if typed -- sent via
    /// `TmuxTerminalView.insertText(_:)` (see TerminalScreen.swift).
    let sequence: String
}

enum QuickKeys {
    static let escape = QuickKey(label: "Esc", sequence: "\u{1b}")
    static let tab = QuickKey(label: "Tab", sequence: "\t")
    static let ctrlC = QuickKey(label: "^C", sequence: "\u{03}")
    static let ctrlB = QuickKey(label: "^B", sequence: "\u{02}")
    static let ctrlD = QuickKey(label: "^D", sequence: "\u{04}")

    static let all = [escape, tab, ctrlC, ctrlB, ctrlD]
}

struct QuickKeysBar: View {
    let onTap: (QuickKey) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(QuickKeys.all) { key in
                    Button(key.label) { onTap(key) }
                        .font(.system(.body, design: .monospaced))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .background(.bar)
    }
}
