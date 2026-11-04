<!--
Title: Conventional Commits, e.g. "feat(core): add lexer". It becomes the commit subject on main.
This description becomes the commit body when the PR is squash-merged: replace TXXXX with the task ID (or "none"), keep the text accurate, and delete these comments.
See CONTRIBUTING.md.
-->

Task: TXXXX

## Summary

<!-- What changes and why, in a few sentences. -->

## Spec references

<!-- Spec sections this PR implements or interprets, with links. Write "None" if not relevant. -->

## Testing

<!-- What you added and ran. If evaluation behaviour changed: passing conformance tests per phase before → after (`pnpm conformance`). -->

## Follow-ups

<!-- Follow-up issues you opened for findings outside this task, for example "#12: toString drops trailing zeros". Write "None" if there are none. See CONTRIBUTING.md#findings-during-a-task. -->

## Checklist

- [ ] The acceptance criteria in the task file are met
- [ ] Tests cite the spec sections they cover
- [ ] Changeset added, or not needed (no user-visible change to a published package)
- [ ] Task file, `docs/spec-notes.md` or ADRs updated where the change affects them
- [ ] Findings outside this task have follow-up issues, listed above
