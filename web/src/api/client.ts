// REST client for tmux-web's backend (src/server.ts) -- ports
// TmuxWebHttpClient.kt + the Ktor*Repository classes into one flat object of
// typed methods. Every request carries `Authorization: Bearer <token>`
// (checkAuthorized in server.ts); every non-2xx response is mapped to an
// ApiError subclass via mapErrorResponse (errors.ts).
import type { ZodType } from "zod";
import { mapErrorResponse, TransportError, DecodingError } from "./errors";
import {
  accessLogResponseSchema,
  branchMergedResponseSchema,
  directoryListingSchema,
  envFileContentResponseSchema,
  envFileListResponseSchema,
  envStatusSchema,
  fileDiffSchema,
  groupedChangesSchema,
  pasteBufferResponseSchema,
  pendingSessionCreationSchema,
  projectListResponseSchema,
  projectSchema,
  pushPublicKeyResponseSchema,
  sessionCreationStatusSchema,
  sessionListResponseSchema,
  sessionMetaSchema,
  sessionResourceUsageSchema,
  sessionTemplateListResponseSchema,
  sessionTemplateSchema,
  type AccessLogEntry,
  type DiffMode,
  type DirectoryListing,
  type EnvFileEntry,
  type EnvStatus,
  type FileDiff,
  type GroupedChanges,
  type NewProjectRequest,
  type NewSessionRequest,
  type NewSessionTemplateRequest,
  type PendingSessionCreation,
  type Project,
  type ProjectSession,
  type PushSubscriptionPayload,
  type SessionCreationStatus,
  type SessionMeta,
  type SessionResourceUsage,
  type SessionTemplate,
  type UpdateSessionTemplateRequest,
} from "./types";

export interface ApiClientConfig {
  baseUrl: string;
  token: string;
  // Injectable for tests, mirroring the SpawnPtyFn/ScrollPaneFn pattern in
  // src/pty-bridge.ts -- defaults to the real global fetch.
  fetchImpl?: typeof fetch;
}

type QueryParams = Record<string, string | boolean | undefined>;

function buildUrl(baseUrl: string, path: string, params?: QueryParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === false) continue;
    query.set(key, value === true ? "true" : value);
  }
  const queryString = query.toString();
  return queryString ? `${baseUrl}${path}?${queryString}` : `${baseUrl}${path}`;
}

async function parseJson<T>(response: Response, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throw new DecodingError(error);
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new DecodingError(result.error);
  return result.data;
}

export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, token } = config;
  const fetchImpl = config.fetchImpl ?? fetch;

  async function request(
    method: string,
    path: string,
    options: { params?: QueryParams; body?: unknown } = {},
  ): Promise<Response> {
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(buildUrl(baseUrl, path, options.params), { method, headers, body });
    } catch (error) {
      throw new TransportError(error);
    }

    if (!response.ok) throw await mapErrorResponse(response);
    return response;
  }

  async function requestJson<T>(
    method: string,
    path: string,
    schema: ZodType<T>,
    options: { params?: QueryParams; body?: unknown } = {},
  ): Promise<T> {
    return parseJson(await request(method, path, options), schema);
  }

  return {
    // -- Projects --------------------------------------------------------
    async listProjects(): Promise<Project[]> {
      return (await requestJson("GET", "/api/projects", projectListResponseSchema)).projects;
    },

    async createProject(body: NewProjectRequest): Promise<Project> {
      return requestJson("POST", "/api/projects", projectSchema, { body });
    },

    async deleteProject(id: string, options: { force?: boolean } = {}): Promise<void> {
      await request("DELETE", `/api/projects/${encodeURIComponent(id)}`, { params: options });
    },

    async browseDirectory(path?: string): Promise<DirectoryListing> {
      return requestJson("GET", "/api/browse", directoryListingSchema, { params: { path } });
    },

    // -- Sessions ----------------------------------------------------------
    async listSessions(projectId: string): Promise<ProjectSession[]> {
      return (await requestJson("GET", `/api/projects/${encodeURIComponent(projectId)}/sessions`, sessionListResponseSchema))
        .sessions;
    },

    async createSession(projectId: string, body: NewSessionRequest): Promise<PendingSessionCreation> {
      return requestJson(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions`,
        pendingSessionCreationSchema,
        { body },
      );
    },

    async getSessionCreationStatus(projectId: string, sessionSlug: string): Promise<SessionCreationStatus> {
      return requestJson(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/creation`,
        sessionCreationStatusSchema,
      );
    },

    async deleteSession(
      projectId: string,
      sessionSlug: string,
      options: { force?: boolean; deleteBranch?: boolean } = {},
    ): Promise<void> {
      await request(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}`,
        { params: options },
      );
    },

    async isBranchMerged(projectId: string, sessionSlug: string): Promise<boolean> {
      return (
        await requestJson(
          "GET",
          `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/branch-merged`,
          branchMergedResponseSchema,
        )
      ).merged;
    },

    async getPasteBuffer(projectId: string, sessionSlug: string): Promise<string> {
      return (
        await requestJson(
          "GET",
          `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/paste-buffer`,
          pasteBufferResponseSchema,
        )
      ).text;
    },

    async getSessionResourceUsage(projectId: string, sessionSlug: string): Promise<SessionResourceUsage> {
      return requestJson(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/resource-usage`,
        sessionResourceUsageSchema,
      );
    },

    async setSessionMeta(
      projectId: string,
      sessionSlug: string,
      label: string | undefined,
      favorite: boolean,
    ): Promise<SessionMeta> {
      return requestJson(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/meta`,
        sessionMetaSchema,
        { body: { label, favorite } },
      );
    },

    // -- Session templates (EMB-220) ---------------------------------------
    async listTemplates(projectId: string): Promise<SessionTemplate[]> {
      return (
        await requestJson(
          "GET",
          `/api/projects/${encodeURIComponent(projectId)}/templates`,
          sessionTemplateListResponseSchema,
        )
      ).templates;
    },

    async createTemplate(projectId: string, body: NewSessionTemplateRequest): Promise<SessionTemplate> {
      return requestJson("POST", `/api/projects/${encodeURIComponent(projectId)}/templates`, sessionTemplateSchema, {
        body,
      });
    },

    async updateTemplate(
      projectId: string,
      templateId: string,
      body: UpdateSessionTemplateRequest,
    ): Promise<SessionTemplate> {
      return requestJson(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/templates/${encodeURIComponent(templateId)}`,
        sessionTemplateSchema,
        { body },
      );
    },

    async deleteTemplate(projectId: string, templateId: string): Promise<void> {
      await request(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/templates/${encodeURIComponent(templateId)}`,
      );
    },

    // -- Git status / changes ----------------------------------------------
    async getChanges(projectId: string, sessionSlug: string): Promise<GroupedChanges> {
      return requestJson(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/changes`,
        groupedChangesSchema,
      );
    },

    async getDiff(projectId: string, sessionSlug: string, path: string, mode: DiffMode): Promise<FileDiff> {
      return requestJson(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/diff`,
        fileDiffSchema,
        { params: { path, mode } },
      );
    },

    async stageFile(projectId: string, sessionSlug: string, path: string): Promise<void> {
      await request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/stage`,
        { body: { path } },
      );
    },

    async unstageFile(projectId: string, sessionSlug: string, path: string): Promise<void> {
      await request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/unstage`,
        { body: { path } },
      );
    },

    async discardFile(projectId: string, sessionSlug: string, path: string, mode: DiffMode): Promise<void> {
      await request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/discard`,
        { body: { path, mode } },
      );
    },

    async commitChanges(projectId: string, sessionSlug: string, message: string): Promise<void> {
      await request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/commit`,
        { body: { message } },
      );
    },

    // -- Env files (EMB-210) ------------------------------------------------
    async listEnvFiles(projectId: string, sessionSlug: string): Promise<EnvFileEntry[]> {
      return (
        await requestJson(
          "GET",
          `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env-files`,
          envFileListResponseSchema,
        )
      ).files;
    },

    async readEnvFile(projectId: string, sessionSlug: string, filename: string): Promise<string> {
      return (
        await requestJson(
          "GET",
          `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env-files/${encodeURIComponent(filename)}`,
          envFileContentResponseSchema,
        )
      ).content;
    },

    async writeEnvFile(projectId: string, sessionSlug: string, filename: string, content: string): Promise<void> {
      await request(
        "PUT",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env-files/${encodeURIComponent(filename)}`,
        { body: { content } },
      );
    },

    // -- Docker-compose dev environments ------------------------------------
    async getEnvStatus(projectId: string, sessionSlug: string): Promise<EnvStatus> {
      return requestJson(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env`,
        envStatusSchema,
      );
    },

    async startEnv(projectId: string, sessionSlug: string): Promise<void> {
      await request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env`,
      );
    },

    async stopEnv(projectId: string, sessionSlug: string): Promise<void> {
      await request(
        "DELETE",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env`,
      );
    },

    async cancelEnv(projectId: string, sessionSlug: string): Promise<void> {
      await request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env/cancel`,
      );
    },

    async reloadEnv(projectId: string, sessionSlug: string, rebuild: boolean, service?: string): Promise<void> {
      await request(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionSlug)}/env/reload`,
        { body: service === undefined ? { rebuild } : { rebuild, service } },
      );
    },

    // -- Web Push (EMB-212) --------------------------------------------------
    async getPushPublicKey(): Promise<string> {
      return (await requestJson("GET", "/api/push/public-key", pushPublicKeyResponseSchema)).publicKey;
    },

    async subscribePush(payload: PushSubscriptionPayload): Promise<void> {
      await request("POST", "/api/push/subscribe", { body: payload });
    },

    async unsubscribePush(endpoint: string): Promise<void> {
      await request("POST", "/api/push/unsubscribe", { body: { endpoint } });
    },

    // -- Access log (EMB-223) ------------------------------------------------
    async getAccessLog(): Promise<AccessLogEntry[]> {
      return (await requestJson("GET", "/api/access-log", accessLogResponseSchema)).entries;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
