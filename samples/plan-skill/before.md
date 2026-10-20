---
name: plan
description: 'Third pipeline stage. Turns the approach from /shape into a plan on paper: acceptance scenarios, the functions to create with their signatures, and the flow between them. No code. Invoke with /plan [feature].'
disable-model-invocation: true
---

# Plan

Turn the approach into the contract for the code: what the acceptance scenarios say, which functions exist and how they call each other. Everything is markdown. No code, no branch.

Read `../pipeline/rules.md` first. Its artifact, gate and focus rules apply.

## Input

Read `shape.md` of the feature.

- Feature given as an argument: use that folder.
- Nothing given: list the features of the current project across all plans worktrees and ask which.
- No `shape.md`: say so and stop.

Do not reopen what the shape decides. If the shape turns out to be wrong, say so and reopen `/shape`.

## Conversation

- Read the codebase at file level: the files, functions, types and tests the shape touches. Find how the project tests (unit runner, Cucumber or both).
- When the feature needs acceptance tests, write the scenarios in Gherkin, following the `acceptance-tests` skill.
- List the functions to create or change, each with its signature and one line on what it does. Extend existing modules where the behavior belongs to them.
- Show the flow: which function calls which, from the entry point down.
- Keep the running draft in `plan.md` from the first scenario or function on. Update it when a decision changes it and commit a fixup. The reply says in one line what changed.
- When the user says the stage is done, name `/build` as the next stage.

## Draft

```markdown
# <title>

## Scenarios
<Gherkin, when the feature needs acceptance tests>

## Functions
### `<module>/<file>`
<signature>
<one line on what it does>

## Flow
<who calls whom>
```
