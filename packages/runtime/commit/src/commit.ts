import { execFileSync } from "node:child_process";

import { duskError, err, ok, type CommitTrailers, type RuntimeResult } from "@dusk/core-schema";

import { renderCommitMessage } from "./render.js";

/**
 * Step-7 atomic commit (RFC §6.7). Stages the worktree and produces exactly ONE
 * Conventional-Commits commit on the bead's branch carrying the rendered trailer
 * set. The commit message is piped via stdin (`git commit -F -`) so multi-line
 * trailers survive verbatim.
 */

export type GitRunner = (cwd: string, args: string[], stdin?: string) => string;

const defaultGit: GitRunner = (cwd, args, stdin) =>
  execFileSync("git", args, { cwd, encoding: "utf8", ...(stdin !== undefined ? { input: stdin } : {}) }).trim();

export type CommitBeadInput = {
  worktreePath: string;
  subject: string;
  body?: string;
  trailers: CommitTrailers;
  gitRunner?: GitRunner;
};

export type CommitResult = { commit_sha: string; branch: string; message: string };

/** Stage + commit the worktree; returns the new commit SHA. */
export function commitBead(input: CommitBeadInput): RuntimeResult<CommitResult> {
  const git = input.gitRunner ?? defaultGit;
  const message = renderCommitMessage({ subject: input.subject, body: input.body, trailers: input.trailers });
  try {
    git(input.worktreePath, ["add", "-A"]);
    git(input.worktreePath, ["commit", "-q", "-F", "-"], message);
    const commit_sha = git(input.worktreePath, ["rev-parse", "HEAD"]);
    const branch = git(input.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return ok({ commit_sha, branch, message });
  } catch (error) {
    return err(
      duskError("internal_error", error instanceof Error ? error.message : "git commit failed", {
        recoverable: false,
        bead_id: input.trailers.bead_id,
        step: 7,
      }),
    );
  }
}
