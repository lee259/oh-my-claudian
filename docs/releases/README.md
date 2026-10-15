# Release highlights

Add a Markdown file named after the exact release tag, for example `2.5.15.md`, before publishing that tag. The release workflow prepends its content to the generated commit list when the file exists. Releases without a matching file retain the generated change list.

Lead with two or three user-visible outcomes: what someone can now do, what friction was removed, or what a fix changes for an affected provider. Name provider limits and material migration steps. Keep refactoring details in the generated list unless they change user behavior.

Use `## Highlights` for the heading. Do not repeat the generated `## What's Changed` or full changelog link. Preparing this file does not edit an existing GitHub Release; that requires a separate reviewed update.
