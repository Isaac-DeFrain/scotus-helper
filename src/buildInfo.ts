import { GITHUB_REPO_URL } from "./constants";

/**
 * Returns the git commit SHA baked into this build, or "unknown" if unset.
 *
 * Inlined into the client bundle via `next.config.ts` `env` so footer text
 * matches between SSR and hydration.
 */
export function getGitCommit(): string {
  return process.env.GIT_COMMIT ?? "unknown";
}

/**
 * Formats a plain-text response for the "which version" meta query.
 */
export function formatVersionResponse(): string {
  const commit = getGitCommit();
  const label =
    process.env.NODE_ENV === "production" ? "Production" : "Development";

  if (commit === "unknown") {
    return `${label} build commit: unknown`;
  }

  return `${label} build commit: ${commit} (${GITHUB_REPO_URL}/commit/${commit})`;
}
