# JSON Tools: JavaScript Methods

Run JavaScript directly on JSON files in VS Code. Transform data with expressions, run multi-stage data pipelines, execute unit tests, stream real-time feeds (SSE & WebSockets), manage multi-environment configs, generate type definitions, mock REST APIs, anonymize sensitive data, and use local or cloud AI to craft queries with zero external runtime dependencies.

[![Demo](https://raw.githubusercontent.com/baguse/json-query-tools/67d4633787056e31674636c4700a9524a53e315f/screenshots/678900b83706d55d.gif)](https://raw.githubusercontent.com/baguse/json-query-tools/67d4633787056e31674636c4700a9524a53e315f/screenshots/678900b83706d55d.gif)

---

## Table of Contents

- [Key Highlights](#key-highlights)
- [Features](#features)
  - [1. Interactive JavaScript Query Editor](#1-interactive-javascript-query-editor)
  - [2. SQL-Like JSON Query Engine](#2-sql-like-json-query-engine)
  - [3. Multi-Source Context & HTTP Client](#3-multi-source-context--http-client)
  - [4. Real-Time Streaming & Live Polling](#4-real-time-streaming--live-polling)
  - [5. Environment Manager & .env Support](#5-environment-manager--env-support)
  - [6. Local & Cloud AI Query Assistant](#6-local--cloud-ai-query-assistant)
  - [7. Privacy & Compliance: PII Anonymizer & Sanitizer](#7-privacy--compliance-pii-anonymizer--sanitizer)
  - [8. Multi-Stage Data Pipeline (ETL)](#8-multi-stage-data-pipeline-etl)
  - [9. Interactive Test Suite & Assertion Runner](#9-interactive-test-suite--assertion-runner)
  - [10. Type & Contract Generator](#10-type--contract-generator)
  - [11. Instant Local Mock REST API Server](#11-instant-local-mock-rest-api-server)
  - [12. Data Views, Visualizations & Visual Lens](#12-data-views-visualizations--visual-lens)
  - [13. JSONC (JSON with Comments) Support](#13-jsonc-json-with-comments-support)
- [Quick Start](#quick-start)
- [Configuration Settings](#configuration-settings)
- [Extension Commands](#extension-commands)
- [Contributing](#contributing)

---

## Key Highlights

- **Dual Query Engines (JavaScript & SQL)**: Seamlessly switch between native JavaScript expressions (`filter`, `map`, `reduce`, `find`, `flatMap`, `async`/`await`) and declarative SQL-like queries (`SELECT`, `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, `JOIN`).
- **Zero External Runtime Dependencies**: Built with lean, native Node.js APIs and VS Code primitives for instantaneous startup and minimal footprint.
- **Privacy-First AI & Local Inference**: Works offline with local `llama.cpp` (`llama-server`) and `Ollama`, or connects to cloud `Gemini` with secure OS keychain credential storage.
- **Full Developer Toolkit**: Includes multi-stage ETL pipelines, unit testing suites, local mock REST server, type contract generation, and sensitive data anonymization.

---

## Features

### 1. Interactive JavaScript Query Editor
- **Direct JS Evaluation & Async Support**: Transform JSON using standard JavaScript expressions. Full support for synchronous logic and asynchronous evaluations (`await Promise.all(...)` or `await fetch(...)`).
- **Dual-Pane Layout Modes**: Switch instantly between **Stacked** (vertical) and **Split** (side-by-side) panels using the layout toggle button.
- **CodeMirror Integration**: Full syntax highlighting, live syntax error validation, foldable results, line numbers, bracket matching, indentation beautifier, autocomplete hints, and `Ctrl+D` multi-cursor selection.
- **Interactive Execution Console**: Built-in console drawer capturing `console.log`, `console.info`, `console.warn`, `console.error`, `console.table`, `console.time`, `console.timeEnd`, `console.count`, and `console.assert` with structured inspection and log filtering.
- **Built-in Sandbox Security Protection**: Automatically blocks restricted operations (such as child processes, direct file system mutations, network socket spawning, or process termination) while allowing legitimate data transformations.
- **Chunked Streaming Output**: Handles multi-megabyte JSON payloads gracefully using incremental chunk rendering to prevent UI freezing.

### 2. SQL-Like JSON Query Engine
- **Declarative SQL over JSON**: Query structured JSON objects, arrays, and multi-source contexts using familiar SQL syntax without setting up external databases.
- **Full Clause Support**:
  - `SELECT [DISTINCT]`: Select top-level or deeply nested fields (`user.address.city`, `items[0].price`), arithmetic expressions (`subtotal + tax`), and column aliases (`field AS alias`).
  - `FROM & JOIN`: Query active file data (`FROM data`, shorthand `FROM users`, or dotted path `FROM data.users` / `FROM response.items` for arrays nested inside objects). Join multiple bound file/URL sources with `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `FULL JOIN`, or `CROSS JOIN` (e.g. `FROM users u LEFT JOIN orders o ON u.id = o.userId`).
  - `WHERE`: Filter rows with logical operators (`AND`, `OR`, `NOT`), comparisons (`=`, `!=`, `<`, `>`, `<=`, `>=`), `IS NULL` / `IS NOT NULL`, `IN (...)`, `BETWEEN ... AND ...`, and pattern matching with `LIKE` / `NOT LIKE` (`%` and `_` wildcards).
  - `GROUP BY & HAVING`: Group rows by multiple columns and filter aggregated buckets using `HAVING` conditions (e.g. `HAVING COUNT(*) > 5`).
  - `ORDER BY`: Multi-column sorting (`ASC` / `DESC`) with robust handling of `null` and undefined values.
  - `LIMIT & OFFSET`: Paginate query results effortlessly.
- **Built-in Aggregate & Scalar Functions**:
  - Aggregates: `COUNT(*)`, `COUNT(field)`, `SUM(field)`, `AVG(field)`, `MIN(field)`, `MAX(field)`.
  - Conditional: `CASE WHEN condition THEN val1 ELSE val2 END`.
  - Scalar helpers: `UPPER(str)`, `LOWER(str)`, `LENGTH(str)`, `ROUND(num, [decimals])`, `COALESCE(a, b, ...)`.
- **Integrated SQL Toolbar & Productivity**:
  - **Quick Mode Switching**: Toggle between JavaScript and SQL editors instantly via the mode bar or `Ctrl+Shift+E` (`Cmd+Shift+E`).
  - **SQL Query Beautifier**: Auto-format and indent SQL queries with standardized keyword casing via the toolbar beautify button or `Ctrl+Shift+F`.
  - **Snippet Presets**: Instant starter templates for basic queries, group-by aggregations, joins, case expressions, and filtering.
  - **Import & Export**: Save and load `.sql` queries directly to/from your workspace.
  - **Live Polling Compatibility**: Automatically re-executes SQL queries when live HTTP polling or file changes occur.

### 3. Multi-Source Context & HTTP Client
- **Multi-File Context**: Bind multiple JSON files from your workspace by alias and reference them simultaneously (e.g. `users.map(u => ({ ...u, order: orders.find(o => o.userId === u.id) }))`).
- **Full HTTP Client**: Fetch data directly from HTTP/HTTPS endpoints with support for all HTTP methods (GET, POST, PUT, PATCH, DELETE, etc.), custom headers (e.g. `Authorization: Bearer <token>`), and request bodies.
- **Postman-Style Query Parameters Table**: Key-value editor with checkboxes, live param count badges, and real-time bidirectional synchronization with the URL input bar.
- **cURL Import & Export**: One-click import of raw cURL commands into the URL fetcher, or export active endpoint configurations as ready-to-run cURL commands.
- **Response & Source Inspector**: Inspect cached API responses or bound file payloads with status code badges, response times, payload sizes, and header tables. Open inspected sources directly in a new VS Code editor tab.
- **In-Memory LRU Cache**: Automatic caching of remote responses with Time-To-Live (TTL) support to prevent redundant network queries.

### 4. Real-Time Streaming & Live Polling
- **Live Auto-Polling**: Automatically poll REST endpoints at configurable intervals (1s, 2s, 5s, 10s, 30s, or 60s) with live re-evaluation of expressions as remote data updates.
- **Server-Sent Events (SSE)**: Connect directly to real-time `text/event-stream` feeds, buffer incoming event payloads into `data`, and run live queries on real-time event streams.
- **WebSocket Streaming (WS/WSS)**: Establish live two-way WebSocket connections (`ws://` or `wss://`). Inspect incoming message buffers in real time, run live transformations, and dispatch outbound WebSocket messages directly from the editor panel.

### 5. Environment Manager & .env Support
- **Postman-Like Environments**: Define and switch between environments (such as `local`, `staging`, and `production`) stored in `.json-tools/environments.json`.
- **Seamless Switching**: Quick-switch active environments via the top toolbar dropdown or inside the URL fetcher modal.
- **Automatic .env File Parsing**: Automatically detects and parses local `.env` files in your workspace root, supporting comments, quotes, and variable expansions.
- **Environment Context in Scripts**: Access active environment variables directly inside your JavaScript queries via the `env` proxy object (e.g. `env.baseUrl`, `env.apiKey`, or `env.variables`).
- **Template Variable Interpolation**: Use `{{baseUrl}}`, `{{apiKey}}`, `{{$env.PROD_API_KEY}}`, or custom variables in expressions, URLs, headers, and request bodies.

### 6. Local & Cloud AI Query Assistant
- **llama.cpp & OpenAI-Compatible Servers**: Connect directly to your local `llama-server`, LM Studio, vLLM, LiteLLM, or LocalAI instance (e.g. `http://192.168.1.23:8081` or `http://localhost:8080`).
- **Endpoint Auto-Normalization**: Accepts bare server hosts, `/v1`, or `/v1/models` endpoints with automatic route resolution for model discovery and chat completions.
- **Ollama & Google Gemini**: Native local Ollama support and cloud Gemini integration.
- **Customizable Timeout**: Configure timeout lengths from 5 to 600 seconds directly in the AI drawer UI or via extension settings with automatic persistence.
- **Secure SecretStorage**: API keys and bearer tokens are stored in the operating system's native keychain via VS Code `SecretStorage` instead of plain text.

### 7. Privacy & Compliance: PII Anonymizer & Sanitizer
- **Client-Side Offline Sanitization**: Detect and mask sensitive Personally Identifiable Information (PII) before sharing data or sending prompts to AI models.
- **Rule Categories**:
  - Email addresses (`[EMAIL_1]`)
  - Credit card numbers (`[CREDIT_CARD_1]`)
  - Phone numbers (`[PHONE_1]`)
  - Social Security Numbers (`[SSN_1]`)
  - IPv4 and IPv6 network addresses (`[IP_ADDRESS_1]`)
  - API Keys, Bearer tokens, and secrets (`[SECRET_KEY_1]`)
- **Interactive Review Modal**: Preview sanitized outputs, inspect detection counts, copy masked data, or apply changes directly to the query context.
- **Built-in Functions in Expressions**: Use `anonymize(data)`, `maskPII(data)`, or `anonymizeWithReport(data)` directly inside your queries.

### 8. Multi-Stage Data Pipeline (ETL)
- **Sequential Transformations**: Chain multiple JavaScript transformation steps where each step's output flows into the next stage as `data`.
- **Stage Management**: Name steps, assign aliases, enable or disable individual steps, and preview intermediary stage results with one click.
- **Import & Export**: Export complete pipelines as reusable JSON or compile the entire pipeline into a single self-contained JavaScript expression.

### 9. Interactive Test Suite & Assertion Runner
- **BDD/TDD Testing Inside VS Code**: Write unit tests for your data transformations and APIs using familiar `describe()`, `it()`, and `expect()` syntax.
- **Comprehensive Matchers**:
  - `expect(val).toBe(expected)`
  - `expect(val).toEqual(expected)`
  - `expect(val).toBeDefined()` / `toBeUndefined()` / `toBeNull()`
  - `expect(val).toBeTruthy()` / `toBeFalsy()`
  - `expect(val).toContain(item)`
  - `expect(val).toHaveLength(num)`
  - `expect(val).toBeGreaterThan(num)` / `toBeLessThan(num)`
  - `expect(val).toMatch(regex)`
  - `expect(fn).toThrow()`
- **Visual Test Dashboard**: Live test runner status, progress bar, passed/failed counters, search/filter controls, and one-click test report copying.

### 10. Type & Contract Generator
- **Automatic Schema Inference**: Generate production-ready type definitions and validation schemas directly from JSON data or query results.
- **Supported Targets**:
  - **TypeScript**: Typed interfaces and type aliases
  - **Zod**: Runtime validation schemas (`z.object({...})`)
  - **JSON Schema**: Draft-07 compliant schema definitions
  - **Python**: Pydantic models and TypedDict classes
- **Instant Export**: Copy code to clipboard, save to a file, or open in a new VS Code editor tab.

### 11. Instant Local Mock REST API Server
- **Zero-Setup Mock Backend**: Spin up a local HTTP server serving query results or active JSON data without installing external tools.
- **Configurable Settings**: Custom port, custom endpoint paths, HTTP methods (GET, POST, PUT, PATCH, DELETE, or ALL), simulated network latency (ms), and HTTP status codes (200, 201, 400, 404, 500).
- **Auto-Filtering**: Optional JSON query filtering on incoming requests.
- **Live Request Feed**: In-panel console monitoring incoming requests with timestamps, paths, methods, query parameters, client IPs, and status codes.
- **cURL Integration**: One-click generation of ready-to-run cURL commands for the mock server.

### 12. Data Views, Visualizations & Visual Lens
- **JSON View**: Formatted, syntax-highlighted, and collapsible JSON tree.
- **Table View**: Paginated data grid with configurable page sizes (25, 50, 100, 200 rows), global search, and column sorting.
- **Chart View**: Render bar, line, and pie charts using Chart.js when results represent chartable numeric datasets. Includes one-click **Save as Image** (PNG/JPEG).
- **Diff View**: One-click visual diff comparing query results against original source JSON.
- **Visual JSON Path Lens**: Interactive breadcrumb bar displaying the active path with one-click **Copy Path** or **Insert Path** into your expression.
- **Smart CSV & JSON Exporter**: Export results as JSON or CSV with automatic handling for nested structures and custom delimiters.

### 13. JSONC (JSON with Comments) Support
- **Full Comment Tolerance**: Automatically strips single-line (`//`) and block (`/* ... */`) comments while preserving string literals.
- **Trailing Comma Handling**: Tolerates trailing commas in object and array definitions, making it ideal for `tsconfig.json`, VS Code `settings.json`, and `.jsonc` files.

---

## Quick Start

1. Open any JSON or JSONC file in VS Code.
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run **JSON Tools: Open Query Editor**.
3. Write your query in **JavaScript Mode** or **SQL Mode**:
   - **JavaScript Mode**:
     ```javascript
     // Filter active users and extract summary fields
     data.users
       .filter(user => user.active && user.age >= 21)
       .map(user => ({
         id: user.id,
         name: `${user.firstName} ${user.lastName}`,
         email: user.email
       }))
     ```
   - **SQL Mode** (`Ctrl+Shift+E`):
     ```sql
     -- Filter, aggregate, and sort with standard SQL
     SELECT 
       category,
       COUNT(*) AS total_items,
       ROUND(AVG(price), 2) AS avg_price,
       MAX(price) AS highest_price
     FROM data
     WHERE inStock = true AND price > 10
     GROUP BY category
     HAVING COUNT(*) >= 2
     ORDER BY avg_price DESC
     LIMIT 5;
     ```
4. Click **Run** (`Ctrl+Enter` or `Cmd+Enter`) to view results in **JSON**, **Table**, or **Chart** views.
5. Export results to CSV/JSON, generate TypeScript interfaces, or test data transformations with the built-in test suite.

---

## Configuration Settings

Configure these options in VS Code Settings (`Ctrl+,` or `Cmd+,` > search for `jsonQueryTools`):

| Setting | Type | Default | Description |
|---|---|---|---|
| `jsonQueryTools.aiProvider` | `string` | `"ollama"` | Active AI provider (`"ollama"`, `"gemini"`, `"llama-cpp"`, or `"openai-compatible"`). |
| `jsonQueryTools.llamaCppEndpoint` | `string` | `"http://localhost:8080"` | URL of the llama.cpp or OpenAI-compatible server (e.g. `http://192.168.1.23:8081` or `http://localhost:8080/v1`). |
| `jsonQueryTools.ollamaEndpoint` | `string` | `"http://localhost:11434"` | API endpoint for local Ollama service. |
| `jsonQueryTools.aiApiKey` | `string` | `""` | API key for cloud AI providers (stored securely in VS Code SecretStorage). |
| `jsonQueryTools.aiTimeout` | `number` | `60` | Timeout in seconds for AI queries and model discovery (5 to 600 seconds). |
| `jsonQueryTools.templateVariables` | `object` | `{}` | Custom key-value pairs for `{{variableName}}` interpolation in expressions, headers, and URLs. |

### Built-in Template Variables
- `{{fileName}}`: Active file name with extension
- `{{filePath}}`: Full file system path of the active file
- `{{fileDir}}`: Directory containing the active file
- `{{workspaceFolder}}`: Workspace root folder path
- `{{url}}`: Active URL source endpoint
- `{{host}}`: Hostname of the active URL source
- `{{method}}`: HTTP method of the active URL source
- `{{alias}}`: Bound source alias name
- `{{$env.NAME}}`: Environment variables from the host system

---

## Extension Commands

| Command | Title | Description |
|---|---|---|
| `jsonQueryTools.openHistory` | JSON Tools: Open Query Editor | Opens the interactive query editor panel for the active file. |
| `jsonQueryTools.openScratchpad` | JSON Tools: Open JS Scratchpad | Opens the query editor in standalone scratchpad mode without an open document. |
| `jsonQueryTools.transformWithExpression` | JSON Tools: Transform with Expression | Quick transformation prompt directly from the VS Code command palette. |
| `jsonQueryTools.diffResult` | JSON Tools: Compare Result with Original JSON | Opens a side-by-side diff comparing query results against the original JSON document. |
| `jsonQueryTools.generateTypes` | JSON Tools: Generate Types & Contracts | Generates TypeScript interfaces, Zod schemas, JSON Schema, or Python models. |
| `jsonQueryTools.runTests` | JSON Tools: Run Query as Test Suite | Runs assertion tests against current data and displays the visual test dashboard. |
| `jsonQueryTools.startMockServer` | JSON Tools: Start Local Mock REST API Server | Starts an instant local mock HTTP server serving your query results. |
| `jsonQueryTools.stopMockServer` | JSON Tools: Stop Local Mock REST API Server | Stops any active local mock server. |
| `jsonQueryTools.openMockServerBrowser` | JSON Tools: Open Mock Server in Browser | Opens the running mock server endpoint in your default web browser. |
| `jsonQueryTools.exportHistory` | JSON Tools: Export Query History as JSON | Exports your saved expressions and query history to a JSON file. |
| `jsonQueryTools.importHistory` | JSON Tools: Import Query History from JSON | Imports previously exported query history and snippets. |

---

## Contributing

Contributions, feedback, and suggestions are welcome! Feel free to open an Issue or submit a Pull Request on [GitHub](https://github.com/baguse/json-query-tools).

**Buy me a coffee**  
<a href="https://buymeacoffee.com/andreantobs"><img src="https://raw.githubusercontent.com/baguse/directus-extension-flow-manager/6edf42d9a46f11c84f4caef2dbef25de22085172/images/buyme-coffee.png" width="200" alt="Buy Me A Coffee" /></a>
