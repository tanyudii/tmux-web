import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { slugifyBranchName } from "./slug.ts";

export interface Project {
  id: string;
  userId: string;
  name: string;
  repoPath: string;
  createdAt: string;
}

export class ProjectValidationError extends Error {}

export type RandomSuffixFn = () => string;

function defaultRandomSuffix(): string {
  return randomBytes(3).toString("hex");
}

export function generateProjectId(name: string, randomSuffix: RandomSuffixFn = defaultRandomSuffix): string {
  const base = slugifyBranchName(name, 20) || "project";
  return `${base}-${randomSuffix()}`;
}

export async function loadProjects(filePath: string): Promise<Project[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

export async function saveProjects(filePath: string, projects: Project[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // Write-then-rename keeps concurrent readers from ever seeing a
  // half-written file.
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, JSON.stringify(projects, null, 2));
  await rename(tempPath, filePath);
}

export interface RegisterProjectDeps {
  isGitRepo: (repoPath: string) => Promise<boolean>;
  randomSuffix?: RandomSuffixFn;
}

export async function listProjects(filePath: string, userId: string): Promise<Project[]> {
  const projects = await loadProjects(filePath);
  return projects.filter((project) => project.userId === userId);
}

export async function registerProject(
  filePath: string,
  userId: string,
  name: string,
  repoPath: string,
  deps: RegisterProjectDeps,
): Promise<Project> {
  if (!name.trim()) {
    throw new ProjectValidationError("Project name must not be empty");
  }
  if (!isAbsolute(repoPath)) {
    throw new ProjectValidationError(`repoPath must be an absolute path: ${repoPath}`);
  }
  if (!(await deps.isGitRepo(repoPath))) {
    throw new ProjectValidationError(`Not a git repository: ${repoPath}`);
  }

  const projects = await loadProjects(filePath);
  // Exact-path match only (symlinked or differently-spelled paths to the
  // same repo are NOT caught) -- the goal is preventing accidental double
  // registration, not fencing mutually distrusting users off one repo.
  if (projects.some((project) => project.repoPath === repoPath)) {
    throw new ProjectValidationError(`repoPath is already registered: ${repoPath}`);
  }
  const project: Project = {
    id: generateProjectId(name, deps.randomSuffix),
    userId,
    name,
    repoPath,
    createdAt: new Date().toISOString(),
  };
  await saveProjects(filePath, [...projects, project]);
  return project;
}

export async function removeProject(filePath: string, userId: string, id: string): Promise<void> {
  const projects = await loadProjects(filePath);
  await saveProjects(
    filePath,
    projects.filter((project) => !(project.id === id && project.userId === userId)),
  );
}

export async function getProject(filePath: string, userId: string, id: string): Promise<Project | undefined> {
  const projects = await loadProjects(filePath);
  return projects.find((project) => project.id === id && project.userId === userId);
}
