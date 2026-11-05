/**
 * The task IDs named by `Task:` lines in a commit message. The PR template
 * makes `Task: T0001` the first line of the description, which becomes the
 * commit body on squash merge (CONTRIBUTING.md, "Pull request titles and commit
 * messages"). `Task: none` names no task.
 */
export function parseTaskLines(message: string): string[] {
  const ids: string[] = [];
  for (const match of message.matchAll(/^Task:[ \t]*(T\d{4}[a-z]?)[ \t]*$/gm)) {
    const id = match[1];
    if (id !== undefined && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

/** The PR number at the end of a squash commit's subject, and the subject without it. */
export function splitSubject(subject: string): { subject: string; pr: number | null } {
  const match = /^(.*) \(#(\d+)\)$/.exec(subject);
  if (match?.[1] === undefined || match[2] === undefined) {
    return { subject, pr: null };
  }
  return { subject: match[1], pr: Number(match[2]) };
}
