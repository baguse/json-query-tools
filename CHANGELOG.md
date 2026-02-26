# Changelog
## [v.0.1.0] - 26 Feb 2026

### Added

- **Templates** – Use template variables in expressions (`{{variableName}}`). Built-ins: `{{workspaceFolder}}`. Configurable via `jsonQueryTools.templateVariables`.
- **Ctrl+D** – Duplicate selection / add next occurrence (CodeMirror).
- **Parentheses** – Improved bracket/parenthesis handling in the editor.
- **Auto complete** (ALPHA) – Simple autocomplete in the script editor.
- **Syntax validation** – Acorn-based JavaScript syntax validation.
- **Toggle comment** – Toggle line/block comments in the script editor.
- **JS Beautify** – Format/beautify JavaScript in the script editor.
- **Result views** – Show result as **JSON**, **Raw**, or **Table**.
- **Chart result** – Visualize result data as charts.
- **Save as JSON or CSV** – Export result to JSON or CSV file.
- **Export and Import JS Script** – Export result to JSON or CSV file.

- **Load external library** – Load external JS libraries in the code context.
- **History favorites** – Mark history items as favorite and copy to clipboard.
- **History search & naming** – Search history and name snippets.
- **Sorting for favorites** – Sort the favorite list.
- **AI query generator** (BETA) – Generate expressions via **Ollama** (local) or **Gemini** (cloud). Config: `jsonQueryTools.ollamaEndpoint`, `jsonQueryTools.aiProvider`, `jsonQueryTools.aiApiKey`.
- **Toast for undefined result** – Notify when the result is `undefined`.
- **Freely add JS expression** – Run arbitrary JavaScript expressions on `data`. You can also add unlimited files and create an alias for it

### Changed

- **Editor** – Switched to CodeMirror for the script editor and the JSON result.
- **Redesign** – UI/UX redesign of the query panel.
- **Result section** – Result area is now a read-only CodeMirror view with **foldable** (collapsible) nodes.
- **Streaming** – Result rendering uses chunk streaming for better performance with large outputs.
- **History order** – Non-favorited history items are shown in reverse (newest first) order.
- **Visuals** – General UI polish (“make it look nicer”).

### Fixed

- **Delete dialog** – Corrected delete confirmation behavior.
- **Alerts** – Replaced `alert()` with in-editor/toast feedback.

---
