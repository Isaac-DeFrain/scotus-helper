import { GITHUB_REPO_URL } from "../constants";
import { formatVersionResponse, getGitCommit } from "./buildInfo";

function restoreEnvVars(vars: Record<string, string | undefined>) {
  for (const key in vars) {
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
}

describe("getGitCommit", () => {
  const gitCommitEnv = process.env.GIT_COMMIT;

  afterEach(() => {
    restoreEnvVars({ GIT_COMMIT: gitCommitEnv });
  });

  it("returns the GIT_COMMIT env var when set", () => {
    process.env.GIT_COMMIT = "abc123def456";
    expect(getGitCommit()).toBe("abc123def456");
  });

  it('returns "unknown" when GIT_COMMIT is unset', () => {
    delete process.env.GIT_COMMIT;
    expect(getGitCommit()).toBe("unknown");
  });
});

describe("formatVersionResponse", () => {
  const env = process.env as Record<string, string | undefined>;
  const gitCommitEnv = env.GIT_COMMIT;
  const nodeEnvEnv = env.NODE_ENV;

  afterEach(() => {
    restoreEnvVars({
      GIT_COMMIT: gitCommitEnv,
      NODE_ENV: nodeEnvEnv,
    });
  });

  it("includes the commit SHA and GitHub link", () => {
    env.GIT_COMMIT = "abc123def456";
    env.NODE_ENV = "production";

    expect(formatVersionResponse()).toBe(
      `Production build commit: ${env.GIT_COMMIT} (${GITHUB_REPO_URL}/commit/${env.GIT_COMMIT})`,
    );
  });

  it('reports "unknown" when GIT_COMMIT is unset', () => {
    delete env.GIT_COMMIT;
    env.NODE_ENV = "development";

    expect(formatVersionResponse()).toBe("Development build commit: unknown");
  });
});
