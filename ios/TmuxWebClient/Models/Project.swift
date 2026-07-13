import Foundation

/// Mirrors `Project` in ../../src/projects.ts
struct Project: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let repoPath: String
    let createdAt: String
}

struct ProjectListResponse: Codable {
    let projects: [Project]
}

struct NewProjectRequest: Codable {
    let name: String
    let repoPath: String
}
