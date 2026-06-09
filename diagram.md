# FreeLLMAPI — Architecture Diagram

```mermaid
---
title: FreeLLMAPI System Architecture
---
graph TB
    %% ── External Clients ──────────────────────────────────────────
    subgraph Clients["Clients"]
        C1["OpenAI SDK / LangChain / LlamaIndex"]
        C2["Codex CLI / Claude Code / Agents"]
        C3["Custom HTTP Clients"]
    end

    %% ── Client-Side App ──────────────────────────────────────────
    subgraph Dashboard["Admin Dashboard (React + Vite)"]
        direction TB
        D1["App.tsx<br/>Routing & Auth Gate"]
        D2["Pages: KeysPage, PlaygroundPage,<br/>FallbackPage, EmbeddingsPage,<br/>AnalyticsPage"]
        D3["Components:<br/>auth-gate, floating-bar,<br/>markdown, models-tabs,<br/>page-header, ui/*"]
        D4["lib/api.ts<br/>API Fetch Layer"]
    end

    %% ── Server ───────────────────────────────────────────────────
    subgraph Server["Express Server (Node.js 20+)"]
        direction TB

        subgraph Middleware["Middleware Stack"]
            M1["helmet + cors<br/>(CSP disabled)"]
            M2["express.json<br/>(10mb limit)"]
            M3["createProxyRateLimiter()<br/>Per-IP, 120 RPM default"]
            M4["requireAuth<br/>(Session token gate)"]
            M5["errorHandler"]
        end

        subgraph Routes["API Routes"]
            R_AUTH["/api/auth<br/>Status, Setup, Login, Logout"]
            R_KEYS["/api/keys<br/>CRUD + encrypt/decrypt"]
            R_MODELS["/api/models<br/>List + availability"]
            R_FALLBACK["/api/fallback<br/>Chain order + routing strategy"]
            R_EMB["/api/embeddings<br/>Family config + usage"]
            R_ANALYTICS["/api/analytics<br/>Summary + by-model + savings"]
            R_HEALTH["/api/health<br/>Key health checks"]
            R_SETTINGS["/api/settings<br/>Unified API key mgmt"]
            R_PING["/api/ping"]
        end

        subgraph ProxyRoutes["OpenAI-Compatible Proxy"]
            P_CHAT["POST /v1/chat/completions<br/>(Streaming + Non-streaming)"]
            P_RESP["POST /v1/responses<br/>(Responses API shim for Codex)"]
            P_MODELS["GET /v1/models"]
            P_EMB["POST /v1/embeddings"]
        end
    end

    %% ── Services ─────────────────────────────────────────────────
    subgraph Services["Core Services"]
        S_ROUTER["router.ts<br/>Route request → best model"]
        S_SCORING["scoring.ts<br/>Thompson-sampled bandit:<br/>Reliability + Speed + Intelligence<br/>× Headroom × RateLimit"]
        S_RATELIMIT["ratelimit.ts<br/>Sliding window counters<br/>RPM/RPD/TPM/TPD"]
        S_AUTH["auth.ts<br/>scrypt passwords<br/>Session tokens (30d TTL)"]
        S_HEALTH["health.ts<br/>Periodic key validation<br/>Auto-disable @ 3 failures"]
        S_EMBED["embeddings.ts<br/>Family-based routing<br/>Cross-provider redundancy"]
        S_RETENTION["request-retention.ts<br/>90-day analytics retention<br/>Auto-prune @ 100K rows"]
    end

    %% ── Providers ────────────────────────────────────────────────
    subgraph Providers["Provider Adapters"]
        direction TB
        PROV_BASE["BaseProvider<br/>(abstract)"]
        PROV_OPENAI["OpenAICompatProvider<br/>Groq, Cerebras, SambaNova,<br/>NVIDIA, Mistral, OpenRouter,<br/>GitHub, Zhipu, HuggingFace,<br/>Ollama, Kilo, Pollinations,<br/>LLM7, OpenCode, Custom"]
        PROV_GOOGLE["GoogleProvider<br/>(Gemini native API)"]
        PROV_COHERE["CohereProvider<br/>(compat endpoint)"]
        PROV_CF["CloudflareProvider<br/>(account_id:token format)"]
    end

    %% ── Database ─────────────────────────────────────────────────
    subgraph Database["SQLite (better-sqlite3)"]
        DB_MAIN["freeapi.db<br/>WAL mode"]
        DB_MODELS["models + fallback_config +<br/>embedding_models"]
        DB_KEYS["api_keys<br/>(AES-256-GCM encrypted)"]
        DB_USAGE["rate_limit_usage<br/>requests + tokens sliding window"]
        DB_REQUESTS["requests<br/>(analytics log)"]
        DB_USERS["users + sessions"]
        DB_SETTINGS["settings KV store"]
    end

    %% ── Desktop App ──────────────────────────────────────────────
    subgraph Desktop["Electron Desktop App"]
        DT_MAIN["main.ts<br/>BrowserWindow"]
        DT_TRAY["tray.ts<br/>System tray"]
        DT_SERVER["server-host.ts<br/>Embedded server host"]
        DT_POPOVER["popover.ts<br/>Quick-access popover"]
    end

    %% ── Shared Types ─────────────────────────────────────────────
    subgraph Shared["@freellmapi/shared"]
        ST["types.ts<br/>Platform, ChatMessage,<br/>ChatCompletionResponse,<br/>Model, ApiKey, etc."]
    end

    %% ── Libraries ────────────────────────────────────────────────
    subgraph Libraries["Server Libraries"]
        L_CRYPTO["crypto.ts<br/>AES-256-GCM encrypt/decrypt"]
        L_CONTENT["content.ts<br/>Message normalization"]
        L_BUDGET["budget.ts<br/>Free-tier budget parser"]
        L_TOOLARGS["tool-args.ts<br/>Double-encoded JSON repair"]
        L_TOOLCALL["tool-call-rescue.ts<br/>Inline dialect detection"]
        L_ERROR["error-redaction.ts<br/>Key/token sanitization"]
        L_PASSWORD["password.ts<br/>scrypt hashing"]
        L_ESTIMATE["request-estimate.ts<br/>Token estimation heuristic"]
    end

    %% ── Connections ──────────────────────────────────────────────
    Clients -->|HTTP / SSE| Middleware
    Middleware --> Routes
    Middleware --> ProxyRoutes

    ProxyRoutes --> S_ROUTER
    ProxyRoutes --> S_EMBED

    S_ROUTER --> S_SCORING
    S_ROUTER --> S_RATELIMIT
    S_ROUTER --> Providers

    Providers --> PROV_OPENAI
    Providers --> PROV_GOOGLE
    Providers --> PROV_COHERE
    Providers --> PROV_CF

    Routes --> S_AUTH
    Routes --> S_HEALTH
    Routes --> S_RETENTION

    S_ROUTER --> DB_MAIN
    S_RATELIMIT --> DB_MAIN
    S_AUTH --> DB_MAIN
    S_HEALTH --> DB_MAIN
    S_RETENTION --> DB_MAIN

    L_CRYPTO --> DB_KEYS
    L_TOOLARGS --> ProxyRoutes
    L_TOOLCALL --> ProxyRoutes
    L_CONTENT --> Providers
    L_ESTIMATE --> ProxyRoutes

    Dashboard -->|fetch /api/*| Routes
    Dashboard -->|fetch /v1/*| ProxyRoutes

    Desktop --> Server
    Shared --> Server
    Shared --> Dashboard
```

## Request Flow (Chat Completion)

```mermaid
sequenceDiagram
    participant Client as OpenAI Client
    participant RateLimiter as Per-IP Rate Limiter
    participant Proxy as Proxy Router
    participant Auth as Auth (Unified Key)
    participant Router as Route Request
    participant Provider as Provider Adapter
    participant Upstream as Upstream LLM API

    Client->>RateLimiter: POST /v1/chat/completions
    RateLimiter->>Auth: Check X-Api-Key / Bearer
    Auth-->>Client: 401 if invalid

    alt stream: true
        Auth->>Proxy: Valid key, parse request
        Proxy->>Router: routeRequest()
        Router->>Router: Score & order models (Thompson sampling)
        Router->>Router: Check RPM/RPD/TPM/TPD
        Router->>Router: Check cooldowns & headroom
        Router->>Router: Decrypt API key
        Router-->>Proxy: RouteResult { provider, modelId, apiKey }

        loop Up to 20 attempts (failover chain)
            Proxy->>Provider: streamChatCompletion()
            Provider->>Upstream: HTTP POST + SSE
            alt Success
                Upstream-->>Provider: SSE chunks
                Provider-->>Proxy: AsyncGenerator<Chunk>
                Proxy-->>Client: SSE stream
                Proxy->>Router: recordSuccess()
                Proxy->>DB: Log analytics
            else 429 / 5xx / Timeout
                Upstream-->>Provider: Error
                Provider-->>Proxy: Error
                Proxy->>Router: recordRateLimitHit()
                Router->>Router: Skip model → next in chain
            end
        end
        Proxy-->>Client: "All models exhausted" (429)

    else stream: false
        Auth->>Proxy: Valid key, parse request
        Proxy->>Router: routeRequest()
        Router-->>Proxy: RouteResult
        Proxy->>Provider: chatCompletion()
        Provider->>Upstream: HTTP POST
        Upstream-->>Provider: JSON response
        Provider-->>Proxy: ChatCompletionResponse
        Proxy-->>Client: JSON response
        Proxy->>Router: recordSuccess()
        Proxy->>DB: Log analytics
    end
```

## Routing Strategy Decision Tree

```mermaid
flowchart TD
    REQ["Incoming Request"] --> CHECK{"model = 'auto'<br/>or isAutoModel?"}
    CHECK -->|Yes| ROUTE["Let router decide"]
    CHECK -->|No| PIN["Use client-specified model"]

    ROUTE --> STICKY{"Has assistant messages<br/>(multi-turn)?"}
    STICKY -->|Yes & sticky found| PREFER["Prefer sticky model"]
    STICKY -->|No| CHAIN["Score fallback chain"]

    PREFER --> SCORE
    CHAIN --> SCORE["Score each model"]

    SCORE --> STRATEGY{"Routing Strategy"}
    STRATEGY -->|priority| PRIO["Base priority + 429 penalty<br/>Ascending (lower = better)"]
    STRATEGY -->|balanced| BAL["Reliability: 0.5<br/>Speed: 0.25<br/>Intelligence: 0.25"]
    STRATEGY -->|smartest| SMA["Reliability: 0.35<br/>Speed: 0.10<br/>Intelligence: 0.55"]
    STRATEGY -->|fastest| FAS["Reliability: 0.35<br/>Speed: 0.55<br/>Intelligence: 0.10"]
    STRATEGY -->|reliable| REL["Reliability: 0.70<br/>Speed: 0.15<br/>Intelligence: 0.15"]
    STRATEGY -->|custom| CUST["User-defined weights"]

    PRIO --> FILTER
    BAL --> GUARD
    SMA --> GUARD
    FAS --> GUARD
    REL --> GUARD
    CUST --> GUARD

    subgraph GUARD["Guardrail Multiplication"]
        BASE["base = Σ(weight × axis_score)<br/>Axis: Reliability, Speed, Intelligence"]
        HEADROOM["headroomFactor<br/>→ 1.0 when under budget<br/>→ 0.0 when over budget"]
        RL["rateLimitFactor<br/>→ 1.0 when no 429s<br/>→ 0.5+ as penalties grow"]
        EFF["effective = base × headroom × rateLimit"]
    end

    BASE --> HEADROOM --> RL --> EFF

    EFF --> FILTER["Filter by context window /<br/>vision / tools support"]
    FILTER --> KEYS["Check key availability<br/>+ round-robin"]
    KEYS --> COOLDOWN{"On cooldown?"}
    COOLDOWN -->|Yes| NEXT["Next model in chain"]
    COOLDOWN -->|No| RLCHECK{"RPM/RPD/TPM/TPD<br/>under limit?"}
    RLCHECK -->|Yes| DECRYPT["Decrypt key + route"]
    RLCHECK -->|No| NEXT
    DECRYPT --> DONE["✅ Request served"]

    NEXT -->|Up to 20 attempts| CHAIN
```

## Database Schema (Simplified)

```mermaid
erDiagram
    models {
        int id PK
        string platform FK
        string model_id
        string display_name
        int intelligence_rank
        int speed_rank
        string size_label "Frontier/Large/Medium/Small"
        int rpm_limit
        int rpd_limit
        int tpm_limit
        int tpd_limit
        string monthly_token_budget "e.g. ~120M"
        int context_window
        bool enabled
        bool supports_vision
        bool supports_tools
        int key_id FK "custom models only"
    }

    fallback_config {
        int model_db_id PK,FK
        int priority
        bool enabled
    }

    api_keys {
        int id PK
        string platform FK
        string label
        string encrypted_key "AES-256-GCM"
        string iv
        string auth_tag
        string status "healthy|rate_limited|invalid|error|unknown"
        bool enabled
        string base_url "custom providers only"
    }

    requests {
        int id PK
        string request_type "chat|embedding"
        string platform FK
        string model_id
        string requested_model "client's original model"
        string status "success|error"
        int input_tokens
        int output_tokens
        int latency_ms
        int ttfb_ms
        datetime created_at
    }

    rate_limit_usage {
        int id PK
        string platform
        string model_id
        int key_id
        string kind "request|tokens"
        int tokens
        bigint created_at_ms
    }

    users {
        int id PK
        string email
        string password_hash "scrypt$salt$hash"
    }

    sessions {
        int id PK
        string token_hash "SHA-256"
        int user_id FK
        bigint expires_at_ms
    }

    settings {
        string key PK
        string value
    }

    embedding_models {
        int id PK
        string family
        string platform
        string model_id
        string display_name
        int dimensions
        int max_input_tokens
        int priority
        bool enabled
        string quota_label
    }

    models ||--o| fallback_config : "has"
    models ||--o{ requests : "serves"
    api_keys ||--o{ requests : "authenticates"
    users ||--o{ sessions : "creates"
```

## Provider Matrix

```mermaid
quadrantChart
    title Provider Coverage by Intelligence & Speed
    x-axis "Slow" --> "Fast"
    y-axis "Small" --> "Frontier"
    quadrant-1 "Frontier & Fast"
    quadrant-2 "Frontier & Slow"
    quadrant-3 "Small & Slow"
    quadrant-4 "Small & Fast"
    "Google Gemini 2.5 Pro": [0.65, 0.90]
    "Google Gemini 2.5 Flash": [0.80, 0.75]
    "Groq GPT-OSS 120B": [0.85, 0.70]
    "Cerebras Qwen3 235B": [0.75, 0.80]
    "SambaNova DeepSeek": [0.60, 0.85]
    "Mistral Large": [0.55, 0.75]
    "OpenRouter": [0.70, 0.60]
    "GitHub Models GPT-4.1": [0.70, 0.85]
    "Cloudflare Kimi K2.6": [0.65, 0.65]
    "Cohere Command A": [0.50, 0.70]
    "HuggingFace Router": [0.60, 0.55]
    "Ollama Cloud": [0.45, 0.50]
    "Kilo Gateway": [0.55, 0.40]
    "Pollinations": [0.70, 0.30]
    "Custom Endpoint": [0.50, 0.50]
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **SQLite over PostgreSQL** | Single-user tool; zero external deps; WAL mode for concurrent reads |
| **AES-256-GCM key encryption** | Keys decrypted only in-memory just before use; IV + auth tag stored per row |
| **Bandit routing over fixed chain** | Thompson sampling explores automatically; proportional to uncertainty |
| **Exponential decay weighting** | Recent behavior dominates; old data still stabilizes estimates |
| **Sticky sessions (30min TTL)** | Prevents hallucination from mid-conversation model switches |
| **In-memory rate limit penalty** | Fast-path for 429 backoff; decays every 2 minutes |
| **Responses API shim** | Codex CLI requires `wire_api="responses"`; translates to chat completions |
| **Tool-call dialect rescue** | Detects Kimi/DeepSeek/Llama/Qwen inline tool syntax mid-stream |
| **Per-IP rate limiter (120 RPM)** | Blunts brute-force attacks on the unified API key |
| **scrypt password hashing** | Built into Node.js; no external bcrypt/argon2 dependency |
