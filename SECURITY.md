# Security

## Reporting a vulnerability

Please report security issues **privately** through GitHub's "Report a vulnerability" (private security advisory) on the project repository, rather than in a public issue.

<!-- TODO: add the repository URL and a contact address once the repository is public. -->

Include what you found, how to reproduce it, and its impact. We aim to acknowledge reports within a week.

## Especially relevant to bismillah

Because bismillah promises local-only, private writing, we treat these as security issues:

- any way the app makes a network request, or loads remote content
- reading or writing files outside the library the user chose (path traversal, symlink escape)
- script execution from document content (e.g. through live preview or Copy as rich text)
- document contents appearing in logs
- data loss or silent modification of saved text.
