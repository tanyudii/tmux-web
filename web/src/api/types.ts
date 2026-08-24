// Domain types for the tmux-web REST API, ported from the Kotlin data
// classes under kmp/composeApp/src/commonMain/kotlin/com/tanyudii/tmuxweb/domain/model/*.kt.
// Each type is backed by a Zod schema so a response is validated at the
// trust boundary (see client.ts's `parseJson`) instead of being cast
// straight from `unknown` -- an untrusted server response never reaches
// application code unchecked.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Projects -- mirrors src/projects.ts (backend contract, frozen).
// ---------------------------------------------------------------------------

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  repoPath: z.string(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListResponseSchema = z.object({ projects: z.array(projectSchema) });

export const loginResponseSchema = z.object({ token: z.string() });

export interface NewProjectRequest {
  name: string;
  repoPath: string;
}

// ---------------------------------------------------------------------------
// Sessions -- mirrors src/project-sessions.ts.
// ---------------------------------------------------------------------------

export const projectSessionSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  windows: z.number(),
  windowNames: z.array(z.string()).default([]),
  attached: z.boolean(),
  label: z.string().nullable().default(null),
  favorite: z.boolean().default(false),
});
export type ProjectSession = z.infer<typeof projectSessionSchema>;

export const sessionListResponseSchema = z.object({ sessions: z.array(projectSessionSchema) });

export interface NewSessionRequest {
  name: string;
  startupCommand?: string;
}

export const branchMergedResponseSchema = z.object({ merged: z.boolean() });

export const pasteBufferResponseSchema = z.object({ text: z.string() });

export const sessionMetaSchema = z.object({
  projectId: z.string(),
  sessionSlug: z.string(),
  label: z.string().optional(),
  favorite: z.boolean(),
});
export type SessionMeta = z.infer<typeof sessionMetaSchema>;

export const sessionCreationPhaseSchema = z.enum(["creating", "ready", "error"]);
export type SessionCreationPhase = z.infer<typeof sessionCreationPhaseSchema>;

export const sessionCreationStatusSchema = z.object({
  phase: sessionCreationPhaseSchema,
  message: z.string().optional(),
  session: projectSessionSchema.optional(),
});
export type SessionCreationStatus = z.infer<typeof sessionCreationStatusSchema>;

export const pendingSessionCreationSchema = z.object({ name: z.string(), fullName: z.string() });
export type PendingSessionCreation = z.infer<typeof pendingSessionCreationSchema>;

export const composeResourceUsageSchema = z.object({
  service: z.string(),
  cpuPercent: z.number(),
  memUsageBytes: z.number(),
  memLimitBytes: z.number(),
});

export const sessionResourceUsageSchema = z.object({
  available: z.boolean(),
  services: z.array(composeResourceUsageSchema).default([]),
});
export type SessionResourceUsage = z.infer<typeof sessionResourceUsageSchema>;

// ---------------------------------------------------------------------------
// Session templates -- mirrors src/session-templates.ts (EMB-220).
// ---------------------------------------------------------------------------

export const sessionTemplateSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  startupCommand: z.string().optional(),
  createdAt: z.string(),
});
export type SessionTemplate = z.infer<typeof sessionTemplateSchema>;

export const sessionTemplateListResponseSchema = z.object({ templates: z.array(sessionTemplateSchema) });

export interface NewSessionTemplateRequest {
  name: string;
  startupCommand?: string;
}

export interface UpdateSessionTemplateRequest {
  name: string;
  startupCommand?: string;
}

// ---------------------------------------------------------------------------
// Git status / changes -- mirrors src/git-status.ts.
// ---------------------------------------------------------------------------

export const fileStatusSchema = z.enum(["modified", "added", "deleted", "renamed", "untracked"]);
export type FileStatus = z.infer<typeof fileStatusSchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().optional(),
  status: fileStatusSchema,
  staged: z.boolean(),
  conflicted: z.boolean().default(false),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const repoStateSchema = z.enum(["clean", "merging", "rebasing"]);
export type RepoState = z.infer<typeof repoStateSchema>;

export const groupedChangesSchema = z.object({
  staged: z.array(changedFileSchema),
  unstaged: z.array(changedFileSchema),
  untracked: z.array(changedFileSchema),
  conflicted: z.array(changedFileSchema).default([]),
  repoState: repoStateSchema.default("clean"),
});
export type GroupedChanges = z.infer<typeof groupedChangesSchema>;

export const diffModeSchema = z.enum(["staged", "unstaged", "untracked"]);
export type DiffMode = z.infer<typeof diffModeSchema>;

export const fileDiffSchema = z.object({
  diff: z.string(),
  isUntracked: z.boolean(),
  isBinary: z.boolean(),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

// ---------------------------------------------------------------------------
// Docker-compose dev environments -- mirrors src/session-env.ts.
// ---------------------------------------------------------------------------

export const envPhaseSchema = z.enum(["unavailable", "idle", "starting", "running", "error", "stopping"]);
export type EnvPhase = z.infer<typeof envPhaseSchema>;

export const composeServiceStatusSchema = z.object({
  service: z.string(),
  state: z.string(),
  health: z.string().optional(),
});

export const envOpenLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
  service: z.string(),
});

export const envStatusSchema = z.object({
  phase: envPhaseSchema,
  openLinks: z.array(envOpenLinkSchema).optional(),
  message: z.string().optional(),
  services: z.array(composeServiceStatusSchema).optional(),
});
export type EnvStatus = z.infer<typeof envStatusSchema>;

// ---------------------------------------------------------------------------
// Env files -- mirrors src/env-editor.ts (EMB-210).
// ---------------------------------------------------------------------------

export const envFileEntrySchema = z.object({ filename: z.string() });
export type EnvFileEntry = z.infer<typeof envFileEntrySchema>;

export const envFileListResponseSchema = z.object({ files: z.array(envFileEntrySchema) });

export const envFileContentResponseSchema = z.object({ filename: z.string(), content: z.string() });

// ---------------------------------------------------------------------------
// Directory browser -- mirrors src/directory-browser.ts (backend contract).
// ---------------------------------------------------------------------------

export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isGitRepo: z.boolean(),
});

export const directoryListingSchema = z.object({
  path: z.string(),
  parentPath: z.string().nullable().optional(),
  isGitRepo: z.boolean(),
  entries: z.array(directoryEntrySchema),
  truncated: z.boolean(),
});
export type DirectoryListing = z.infer<typeof directoryListingSchema>;

// ---------------------------------------------------------------------------
// Access log -- mirrors src/access-log.ts (EMB-223).
// ---------------------------------------------------------------------------

export const accessLogEntrySchema = z.object({
  timestamp: z.string(),
  ip: z.string(),
  method: z.string(),
  path: z.string(),
  outcome: z.string(),
});
export type AccessLogEntry = z.infer<typeof accessLogEntrySchema>;

export const accessLogResponseSchema = z.object({ entries: z.array(accessLogEntrySchema) });

// ---------------------------------------------------------------------------
// Web Push -- mirrors src/push-notifications.ts (EMB-212).
// ---------------------------------------------------------------------------

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export const pushPublicKeyResponseSchema = z.object({ publicKey: z.string() });
