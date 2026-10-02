# Changelog

## [v0.2.0](https://github.com/baguse/json-query-tools/compare/v0.1.0...v0.2.0) - 2 Oct 2026

### Added

- **AI** – Add llama.cpp/OpenAI-compatible provider and customizable timeout ([f858a9a](https://github.com/baguse/json-query-tools/commit/f858a9a653f0268e1ade971840397e0d2ae6439e)).
- **Privacy** – Add offline PII anonymizer and data sanitizer engine ([c64f4b9](https://github.com/baguse/json-query-tools/commit/c64f4b9a2578e6acd991945259f2fd310faf0e07)).
- **UI** – Add dual-pane split layout toggle and collapsible AI assistant drawer ([18d0bf2](https://github.com/baguse/json-query-tools/commit/18d0bf2352a60a5dbc4f65d82907592eb5d2a247)).
- Bind HTTP request and response objects with autocomplete hints ([416a87d](https://github.com/baguse/json-query-tools/commit/416a87d712eeee0a20d5c9ec7d8b254abcf48bde)).
- Support custom HTTP request methods in mock server and URL modal ([9dabcaf](https://github.com/baguse/json-query-tools/commit/9dabcaf284b2c35fa01043bc94f070f741356926)).
- **Mock Server** – Add instant local mock REST API server with live request feed ([1c3b5fe](https://github.com/baguse/json-query-tools/commit/1c3b5fe13bfa736f148ef22368ffb2a362012d29)).
- **Pipeline** – Add interactive multi-step data pipeline and autocomplete support ([97e50eb](https://github.com/baguse/json-query-tools/commit/97e50eb9501d8af3d0e4dded3f0dc2474b7c1aa3)).
- **Stream** – Add live polling auto-refresh and native SSE/WebSocket stream mode ([9b40b47](https://github.com/baguse/json-query-tools/commit/9b40b47a9b5567909fadca00ed3f2f0c68f07b42)).
- Add independent test suite mode and combined multi-source assertions ([e532f30](https://github.com/baguse/json-query-tools/commit/e532f30b84d1cefc4b5de008f41ddff77e26fcd3)).
- **TypeGen** – Add multi-target type generator with structural deduplication ([61d1279](https://github.com/baguse/json-query-tools/commit/61d1279bc58fd763b4e2c6192950101fa834886d)).
- **Webview** – Add click-to-query visual lens for json paths and queries ([6de1f25](https://github.com/baguse/json-query-tools/commit/6de1f2565714ca34f43317d44b4e477de8e0373a)).
- **Autocomplete** – Add console.debug and standard console methods to hints ([0cf9e05](https://github.com/baguse/json-query-tools/commit/0cf9e05423b7613575abc7b12666bbacd9321dd1)).
- Add real-time stdout console streaming and execution drawer ([eddb15f](https://github.com/baguse/json-query-tools/commit/eddb15f75bb727ddd18f5aadaa2c0da9b9505f70)).
- Support environments configuration and {{env.baseURL}} in request fetcher and query editor ([9577990](https://github.com/baguse/json-query-tools/commit/9577990a4a80f44784470945a4b6225f940aed07)).
- Add query execution benchmark meter to result header and status bar ([b8d9070](https://github.com/baguse/json-query-tools/commit/b8d9070709693daec2cfcfba47972638ddc8b11a)).
- Introduce JSON export and import for query history and favorites ([18c8879](https://github.com/baguse/json-query-tools/commit/18c8879a706669fe628e8c68be83b3fa7eb7a8cd)).
- Introduce side-by-side diff view with original JSON ([99a4b7c](https://github.com/baguse/json-query-tools/commit/99a4b7cc7888f8b408c7ed82e1ad0dbc4cc17677)).
- Add query snippet library dropdown and interactive cheatsheet modal ([9f0b611](https://github.com/baguse/json-query-tools/commit/9f0b611db256f7d28d94843856d9f10d81cfbcbe)).
- Add response headers inspector to URL preview modal ([58cd224](https://github.com/baguse/json-query-tools/commit/58cd224700f0b23633eafb7c8deffcdea79dff67)).
- Add YAML, NDJSON, and XML export formats and format switching ([f49ae92](https://github.com/baguse/json-query-tools/commit/f49ae9204e67ce3a01070e60adf4ad319afb395d)).
- Support environment and workspace template variables in URLs ([aee29a9](https://github.com/baguse/json-query-tools/commit/aee29a9adb4676ac42fdbaa9837f676bd771d26b)).
- **cURL** – Add cURL command import and export for URL sources ([48a35f0](https://github.com/baguse/json-query-tools/commit/48a35f01f15d8141be85257576d749e8c755a1f6)).
- **Scratchpad** – Add dedicated standalone JS scratchpad mode ([f0f1b64](https://github.com/baguse/json-query-tools/commit/f0f1b64452a02324928d2b4baa639655758d8e9f)).
- **Commands** – Reuse existing query editor webview panel on subsequent opens ([c2cd19a](https://github.com/baguse/json-query-tools/commit/c2cd19ae743936088b1c6c02c1a02820f0a77880)).
- **Evaluator** – Support async queries, await expressions, and promises ([a7a0dd8](https://github.com/baguse/json-query-tools/commit/a7a0dd8cb6e4e878bec25ef121d17253012a78ef)).
- **Fetcher** – Support JSONC comments and trailing commas in URL responses ([c3f6d8e](https://github.com/baguse/json-query-tools/commit/c3f6d8ed4858e8612c753dbf2d64f5a2228c7ea5)).
- **Webview** – Add table view pagination and virtualization for large datasets ([a3d840f](https://github.com/baguse/json-query-tools/commit/a3d840f03b8d135eb81df8ee3a5c6b2f6b4d42dc)).
- **Tests** – Introduce dynamic test runner with suite filtering and simplify package.json ([d9d9707](https://github.com/baguse/json-query-tools/commit/d9d97072e24db0dcc677698432b81af246d45a91)).
- Add HTTP fetcher as a data source ([0cd08e6](https://github.com/baguse/json-query-tools/commit/0cd08e6a1dbd1042a43fdada57f170bcb74080af)).
- Allow for jsonc format ([701fc83](https://github.com/baguse/json-query-tools/commit/701fc831ec104bb0a20f1607d288302f9db92dbe)).
- Add warning when the user run malicious script ([0e63198](https://github.com/baguse/json-query-tools/commit/0e63198d7d84cdaf78c8ab9f9529867041cc5ee0)).

### Security

- **AI** – Store AI credentials in VS Code SecretStorage instead of localStorage ([5dc5269](https://github.com/baguse/json-query-tools/commit/5dc5269d939e0da21fdd5066f5f6fad05e20f186)).
- **Webview** – Use cryptographically secure random bytes for CSP nonce ([210de32](https://github.com/baguse/json-query-tools/commit/210de320b9165b5848b4e37461cd029bd3bd0e06)).
- **Evaluator** – Guard against node: prefixes, dynamic imports, and process operations ([be9d834](https://github.com/baguse/json-query-tools/commit/be9d834732dc8d0449a53eb08fbfe88ec38f39cc)).
- **AI** – Pass Gemini API key via x-goog-api-key header ([28b7fcd](https://github.com/baguse/json-query-tools/commit/28b7fcd12041aa511b09a1f95c3a311e9a75dcf0)).

### Performance

- **Webview** – Debounce query parameters synchronization ([511a987](https://github.com/baguse/json-query-tools/commit/511a987325fd6fd0d0a8ad2c0a53a4b271064bc8)).
- **Cache** – Implement bounded LRU cache with TTL for URL data sources ([e02cf7b](https://github.com/baguse/json-query-tools/commit/e02cf7b3ebda6fbf5ffa737fea6d0952eca89d7d)).
- **Streaming** – Omit redundant full data payload on resultComplete ([90917f7](https://github.com/baguse/json-query-tools/commit/90917f7f0579c7b423a8d4152c0f656cb5f8d9f6)).
- **Streaming** – Remove artificial sleep and batch webview updates with requestAnimationFrame ([74572be](https://github.com/baguse/json-query-tools/commit/74572be29108653d5087a6410f8258c0019e76e6)).

### Fixed

- **Autocomplete** – Support optional chaining, fix schema unwrapping, and suppress hints in strings ([b4d5118](https://github.com/baguse/json-query-tools/commit/b4d5118c3ebc782db5dcafa09eb032554342b5d1)).
- **Webview** – Enable symmetric source deletion across file and URL sources ([c1c173b](https://github.com/baguse/json-query-tools/commit/c1c173b0400a22521aed2c1c522a15ba92e79c06)).
- **Webview** – Ensure CodeMirror folding editor displays on format switch to JSON ([53061cc](https://github.com/baguse/json-query-tools/commit/53061ccfb7c83b58bc8778d5f7ee62b671037687)).
- Hide action buttons on chart result when the result is not an array ([cca73bc](https://github.com/baguse/json-query-tools/commit/cca73bca7489253a1932ea962d6be1f1b9441b91)).
- Remove raw result format and display warning for non-array table results ([b53e5fc](https://github.com/baguse/json-query-tools/commit/b53e5fced0a4767eb1a5616acf7a104cf9c39338)).
- Top level await ([7094a67](https://github.com/baguse/json-query-tools/commit/7094a67a483e69cd9a96ce2df392e504f4f32920)).
- **Schema** – Guard schema inference against circular references and deep recursion ([285066b](https://github.com/baguse/json-query-tools/commit/285066bf51376ab77d44ede30e7106f350a5df3d)).
- **History** – Serialize concurrent pushHistory calls via promise queue ([27cfbe1](https://github.com/baguse/json-query-tools/commit/27cfbe15e3f7f2e18fdbc68420330a4fa3548a3f)).
- **Evaluator** – Handle undefined, BigInt, and non-serializable edge cases in stringify ([b785fe7](https://github.com/baguse/json-query-tools/commit/b785fe74b4f74f4aee684dbe902d828658e4694b)).
- **Webview** – Make simpleBeautify string-literal and comment aware ([82a6d18](https://github.com/baguse/json-query-tools/commit/82a6d185ed990fbb61596566135d9f6891ed50b2)).
- **AI** – Add 30s timeout and abort controller to AI generation calls ([4b02b57](https://github.com/baguse/json-query-tools/commit/4b02b57e83c1bc438030600644c28461da4d7a32)).
- **AI** – Robustly strip markdown fences and conversational preambles from AI outputs ([bbba8db](https://github.com/baguse/json-query-tools/commit/bbba8db114fac9603ebf998d2bff383cc775741a)).
- **Commands** – Prevent cleared workspace URL sources from restoring global sources ([61a1d1a](https://github.com/baguse/json-query-tools/commit/61a1d1a589546a524d13adc50d3d3fddd1215395)).
- **Commands** – Add error handling and security verification to commandTransformWithExpression ([be847dd](https://github.com/baguse/json-query-tools/commit/be847dd6b10b34b0a98f0d17e499d1e4dc8ade79)).
- **Evaluator** – Pass all bound data sources to query functions and support implicit return ([550a10f](https://github.com/baguse/json-query-tools/commit/550a10f50626c08024e1cf81555f2d870d1d61a9)).
- **Config** – Normalize Windows path backslashes to forward slashes in template variables ([9b2db64](https://github.com/baguse/json-query-tools/commit/9b2db64d3b9da1eecb6a62964d148d364b70ca0a)).
- **Webview** – Replace corrupted Unicode search icon character with HTML entity ([0e7be45](https://github.com/baguse/json-query-tools/commit/0e7be458db04fa268a6f044121c31dab0038ee23)).
- **Webview** – Replace unhandled throw in updateModels with visible AI error banner ([2b61233](https://github.com/baguse/json-query-tools/commit/2b61233a5e479d59acc06c5230c47189d94982fc)).
- **Webview** – Copy and export formatted text from CodeMirror in JSON mode ([5bb41d3](https://github.com/baguse/json-query-tools/commit/5bb41d37138d85d485a109af7b3cc628d141448f)).
- Unescaped CSV generation in table copy and open in editor ([2c5a611](https://github.com/baguse/json-query-tools/commit/2c5a6119d2a14f8bc2fff34dc92d59c5098b839f)).
- Preserve custom history item name and favorite on re-run ([c5edd41](https://github.com/baguse/json-query-tools/commit/c5edd410174939f71ae5f4d30cd43d1bb57abdf8)).
- Standalone mode w/o any sources ([bbc18cf](https://github.com/baguse/json-query-tools/commit/bbc18cf0af000d531468126f595c1768c884720d)).
- Built in template variable for fileName, filePath and fileDir ([d4e975a](https://github.com/baguse/json-query-tools/commit/d4e975a941c92a061ba48a02fd8580937ac6ddda)).
- Switch moduleResolution from node to bundler to silence deprecation ([3c43a3a](https://github.com/baguse/json-query-tools/commit/3c43a3a4babb95cda582aa9c9ae1e5b9c922427c)).

### Changed

- Extract shared utility functions into centralized helpers module ([622db60](https://github.com/baguse/json-query-tools/commit/622db606b45238af6832039cc16544e010e04a27)).
- Remove dead geminiApiKey fallback in favor of aiApiKey configuration ([3407f41](https://github.com/baguse/json-query-tools/commit/3407f415e7cbe3e1ba9e2fc3044eb5b55459653e)).
- Standardize copyToClipboard casing and add backwards compatibility alias ([c78e23d](https://github.com/baguse/json-query-tools/commit/c78e23d0d12d9cacdf8f7a79003b2deb95093b57)).
- Split monolithic extension.ts into modules; remove unused esbuild.js ([ad8059e](https://github.com/baguse/json-query-tools/commit/ad8059ef5e16ec193adb0530b0988b2854076cda)).

### Documentation

- Correct history ordering comment to reflect reverse chronological display ([d48cd56](https://github.com/baguse/json-query-tools/commit/d48cd563d3e66434fc7aee869e64d812d53b130c)).

---

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
