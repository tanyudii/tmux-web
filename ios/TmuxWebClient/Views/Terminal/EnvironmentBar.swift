import SwiftUI
import UIKit

/// Per-session "Setup Environment" bar -- one-click docker-compose
/// environments scoped to a single session (see ../../../README.md's
/// "Per-session environments" section). Mirrors ../../../public/app.js's
/// env bar: hidden entirely when the project hasn't opted in
/// (`.unavailable`), otherwise a status badge plus Setup/Stop/Open/Logs
/// actions, polled every 3s while visible (`envPollTimer` there, a
/// self-cancelling `.task` loop here).
struct EnvironmentBar: View {
    let client: APIClient
    let projectId: String
    let sessionName: String

    @State private var status: EnvStatus?
    @State private var pollFailureCount = 0
    @State private var isBusy = false
    @State private var errorMessage: String?
    @State private var isShowingStopConfirm = false
    @State private var isShowingLogs = false

    var body: some View {
        Group {
            if let status, status.phase != .unavailable {
                content(for: status)
            }
        }
        .task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(3))
            }
        }
        .alert("Failed", isPresented: .constant(errorMessage != nil), presenting: errorMessage) { _ in
            Button("OK") { errorMessage = nil }
        } message: { message in
            Text(message)
        }
        .alert("Stop this session's environment?", isPresented: $isShowingStopConfirm) {
            Button("Stop (discard volumes)", role: .destructive) {
                Task { await stop() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This runs `docker compose down -v` -- the containers and volumes for this session's environment will be removed.")
        }
        .sheet(isPresented: $isShowingLogs) {
            if let services = status?.services, !services.isEmpty {
                LogsSheet(client: client, projectId: projectId, sessionName: sessionName, services: services)
            }
        }
    }

    @ViewBuilder
    private func content(for status: EnvStatus) -> some View {
        HStack(spacing: 8) {
            Text(phaseLabel(status.phase))
                .font(.caption.bold())
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(phaseColor(status.phase).opacity(0.2))
                .foregroundStyle(phaseColor(status.phase))
                .clipShape(Capsule())

            if let message = status.message, !message.isEmpty {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            if status.phase == .idle {
                Button("Setup") { Task { await setup() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(isBusy)
            }

            if status.phase == .running || status.phase == .error {
                Button("Stop") { isShowingStopConfirm = true }
                    .buttonStyle(.bordered)
                    .disabled(isBusy)
            }

            if let services = status.services, !services.isEmpty {
                Button("Logs") { isShowingLogs = true }
                    .buttonStyle(.bordered)
            }

            if let openUrl = status.openUrl, let url = URL(string: openUrl) {
                Button("Open") { UIApplication.shared.open(url) }
                    .buttonStyle(.bordered)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(.thinMaterial)
    }

    // A single failed poll is usually just a transient hiccup (e.g. the
    // server restarting after a deploy) -- only stop trusting the
    // last-rendered status after several consecutive failures, so the bar
    // doesn't flicker on every blip but also doesn't freeze on stale data
    // forever if the server stays unreachable.
    private static let pollFailureThreshold = 3

    private func refresh() async {
        do {
            status = try await client.envStatus(projectId: projectId, sessionName: sessionName)
            pollFailureCount = 0
        } catch {
            pollFailureCount += 1
            if pollFailureCount >= Self.pollFailureThreshold {
                status = nil
            }
        }
    }

    private func setup() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await client.startEnv(projectId: projectId, sessionName: sessionName)
            await refresh()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func stop() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await client.stopEnv(projectId: projectId, sessionName: sessionName)
            await refresh()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func phaseLabel(_ phase: EnvPhase) -> String {
        switch phase {
        case .unavailable: return ""
        case .idle: return "Idle"
        case .starting: return "Starting…"
        case .running: return "Running"
        case .error: return "Error"
        case .stopping: return "Stopping…"
        }
    }

    private func phaseColor(_ phase: EnvPhase) -> Color {
        switch phase {
        case .unavailable, .idle: return .secondary
        case .starting, .stopping: return .orange
        case .running: return .green
        case .error: return .red
        }
    }
}
