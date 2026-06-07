---
name: english-ui-text
description: All user-facing text in the app must be written in English. Use when adding or editing any UI copy — labels, buttons, titles, descriptions, captions, placeholders, tooltips, aria-labels, metadata, toast messages, or any string rendered to the user in this repository.
---

# English UI Text

## Rule

Every user-facing string in the application is written in **English**, regardless
of the language the user writes prompts in.

This covers all text rendered to the user:

- Button, label, menu, and tab text
- Page titles and `Metadata` (`title`, `description`)
- Helper text, captions, status copy, headings
- Placeholders, tooltips, `aria-label`, alt text
- Toast / `sonner` messages and error strings
- Any literal string passed to a React component as visible content

## Scope

- Applies only to **user-facing** text. Code identifiers, comments, commit
  messages, and chat replies are not covered by this rule.
- When a prompt is in another language (e.g. French), still write the UI text in
  English; reply to the user in their language if appropriate, but the app stays
  English.

## Checklist before finishing a UI change

- [ ] No non-English words in any rendered string or `Metadata`.
- [ ] Keep copy minimal (see the `no-superfluous-text` skill).
