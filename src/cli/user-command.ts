import { join } from "node:path";
import { defaultConfigDir } from "../config.ts";
import { revokeAllTokensForUser } from "../auth-tokens.ts";
import { createUser, loadUsers, removeUser, UserValidationError } from "../users.ts";

function usersFilePath(configDir: string): string {
  return join(configDir, "users.json");
}

function authTokensFilePath(configDir: string): string {
  return join(configDir, "auth-tokens.json");
}

async function runAdd(args: string[], filePath: string): Promise<void> {
  const [username, password] = args;
  if (!username || !password) {
    throw new UserValidationError("Usage: tmuxweb user add <username> <password>");
  }
  const user = await createUser(filePath, username, password);
  console.log(`Created user: ${user.username}`);
}

async function runList(filePath: string): Promise<void> {
  const users = await loadUsers(filePath);
  if (users.length === 0) {
    console.log("No users. Run `tmuxweb user add <username> <password>` to create one.");
    return;
  }
  for (const user of users) {
    console.log(`${user.username}\t${user.createdAt}`);
  }
}

async function runRemove(args: string[], usersFile: string, authTokensFile: string): Promise<void> {
  const [username] = args;
  if (!username) {
    throw new UserValidationError("Usage: tmuxweb user remove <username>");
  }
  const users = await loadUsers(usersFile);
  if (!users.some((user) => user.username === username)) {
    throw new UserValidationError(`No such user: ${username}`);
  }
  await removeUser(usersFile, username);
  // Removing the account alone would leave every token they already hold
  // working (auth-tokens.ts resolves by hash, it never re-checks users.json).
  await revokeAllTokensForUser(authTokensFile, username);
  console.log(`Removed user: ${username}`);
}

export async function runUserCommand(args: string[], configDir: string = defaultConfigDir()): Promise<void> {
  const [subcommand, ...rest] = args;
  const filePath = usersFilePath(configDir);

  switch (subcommand) {
    case "add":
      return runAdd(rest, filePath);
    case "list":
      return runList(filePath);
    case "remove":
      return runRemove(rest, filePath, authTokensFilePath(configDir));
    default:
      throw new UserValidationError("Usage: tmuxweb user <add|list|remove> ...");
  }
}
