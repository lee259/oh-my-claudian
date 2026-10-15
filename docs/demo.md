# From scattered notes to a linked action plan

[English README](../README.md) · [简体中文快速开始](../README.zh-CN.md)

This sample uses three fictional notes and the actual plugin UI. It is suitable for a first write workflow in a test vault and for recording a short product walkthrough. Provider output and elapsed time vary.

## Prepare

1. Copy the three Markdown files in [`demo-vault`](demo-vault) into a separate test vault. Keep their filenames so their wikilinks resolve.
2. Install Oh My Claudian in that vault and configure a provider using the [quick start](../README.md#quick-start).
3. Open `Project Brief.md` next to the chat. Attach `Project Brief.md`, `Research Notes.md`, and `Daily Review.md` with `@`.
4. Use the provider's approval mode when you want to review a requested write before execution. A chat edit card is a record of a tool edit, not a universal apply button.

## Read first

Send:

> Compare the three attached notes. Propose three small next steps for Project Atlas. Link each step to the note that supports it. Do not modify files yet.

Check that the reply refers to the attached sources and proposes specific actions. Check the source notes yourself before accepting the conclusions.

## Write the plan

After reviewing the proposal, send:

> Add a "Next steps" section to Project Brief.md using the three actions we just discussed. Keep the existing content. Link each action to Research Notes.md or Daily Review.md using Obsidian wikilinks. Only change Project Brief.md.

When the provider requests approval, inspect the target path and proposed action before allowing it. If the edit card includes a supported diff, expand it. Open the resulting note to verify:

- The original brief and source links remain.
- There is one `Next steps` section with three actions.
- Each action includes a source wikilink that opens the intended note.
- `Research Notes.md` and `Daily Review.md` remain unchanged.

Provider capabilities differ. If there is no rendered diff, inspect the edited Markdown directly; do not infer the changed lines from a successful tool status.

## A 30–45 second recording

| Segment | Show | Suggested caption |
| --- | --- | --- |
| 0–8s | The brief and its two source notes, then the three attached context chips | Your notes are the starting point. |
| 8–18s | The read-only prompt and the resulting linked plan | Compare sources before changing files. |
| 18–32s | The write request, any real approval, and an expanded supported edit diff | Review the target and inspect the change. |
| 32–45s | The updated Markdown note and a source link opening | Keep the result and its evidence in your vault. |

Record a continuous interaction in the native Obsidian window in the test vault. Show the actual prompts, provider responses, and resulting file changes; do not assemble still screenshots into a simulated recording. Keep authentication, private files, and provider environment settings out of the recording. If waiting time is shortened, disclose that in the caption.

## Reset

Restore the three original files from `demo-vault` before repeating the example. Keep this reset inside the test vault.
