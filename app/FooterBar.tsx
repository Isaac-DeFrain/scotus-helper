import Image from "next/image";

import { DonateButtons } from "./DonateButtons";
import styles from "./page.module.css";
import { GITHUB_REPO_URL } from "@/src/constants";
import { getGitCommit } from "@/src/buildInfo";

const GIT_COMMIT_LENGTH = 8;

function formatCommitLabel(commit: string): string {
  if (commit === "unknown") {
    return commit;
  }

  return commit.slice(0, GIT_COMMIT_LENGTH - 1);
}

export function FooterBar() {
  const commit = getGitCommit();
  const commitLabel = formatCommitLabel(commit);
  const commitTitle = commit === "unknown" ? undefined : commit;

  return (
    <div className={styles.footerBar}>
      <div className={styles.donateBar}>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.githubLink}
          aria-label="View source on GitHub"
        >
          <Image src="/github.svg" alt="" width={20} height={20} />
        </a>
        <span className={styles.donateLabel} title={commitTitle}>
          {commitLabel}
        </span>
      </div>
      <DonateButtons />
    </div>
  );
}
