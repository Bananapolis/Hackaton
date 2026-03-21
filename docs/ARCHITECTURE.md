# System Architecture

## Overview
The application is a full-stack real-time interactive learning and classroom management platform, designed to enhance the engagement between teachers and students during live sessions.

It encompasses three main components:
1. **Frontend**: A React application (built with Vite) that provides interfaces for both teachers and students.
2. **Backend**: A FastAPI server that handles persistent storage (SQLite), AI workloads (OpenAI integrations for quiz generation), and real-time state management via WebSockets.
3. **Desktop app**: An Electron wrapper wrapper packaging the Frontend for standalone distribution (AppImage, deb, rpm, exe, dmg).

## Deployment Architecture

```plantuml
@startuml
!theme plain

node "Client Side" {
  [Web Browser] as Browser
  [Electron Desktop App] as DesktopApp
}

node "Deployment Environment / VPS" {
  [Caddy Reverse Proxy] as Caddy
  
  node "Docker Compose" {
    [Frontend (Nginx)] as FrontendContainer
    [Backend (FastAPI/Python)] as BackendContainer
  }
}

database "SQLite Database" as SQLite
cloud "OpenAI API Service" as OpenAI

Browser --> Caddy : HTTPS
DesktopApp --> Caddy : HTTPS

Caddy --> FrontendContainer : Proxy Pass
Caddy --> BackendContainer : Proxy Pass

BackendContainer ..> SQLite : Read/Write
BackendContainer ..> OpenAI : REST API
@enduml
```

## System Components

- **Caddy**: Serves as the SSL termination and reverse proxy layer, routing `/api` and `/ws` to the Backend, and the rest to the Frontend.
- **Frontend Container**: Nginx server delivering static assets (HTML, CSS, JS) efficiently.
- **Backend Container**: Uvicorn server running the FastAPI application. It persists session state in memory (for real-time WebSockets tracking) and long-term analytics/documents to an embedded SQLite file (`data.sqlite3`).

---

## High-Level Sequence Diagrams

### 1. Session Connection & Live Share

When a session starts, both the teacher and students connect to the room via WebSockets to synchronize state.

```plantuml
@startuml
!theme plain

actor "Teacher\n(React/Electron)" as T
actor "Student\n(React/Browser)" as S
participant "Backend\n(FastAPI WebSockets)" as B

T -> B: POST /api/sessions/create {title, notes}
B --> T: 200 OK (Returns 6-digit JOINDCODE)

T -> B: HTTP GET /ws/{JOINCODE}?role=teacher&name=Instructor
B --> T: 101 Switching Protocols (WebSocket Established)

S -> B: POST /api/sessions/join {code: JOINCODE}
B --> S: 200 OK

S -> B: HTTP GET /ws/{JOINCODE}?role=student&name=Alice
B --> S: 101 Switching Protocols

B -> T: WS Emit "participant_joined" (Alice)
B -> S: WS Emit "metrics" (current room state)

@enduml
```

### 2. Notifications & Student Feedback (Confusion Signals & Break Votes)

The system allows students to push real-time, anonymous or attributed feedback to the teacher's dashboard without interrupting the flow verbally.

```plantuml
@startuml
!theme plain

actor Student as S
participant Backend as B
actor Teacher as T

S -> B: WS Send {type: "confusion", payload: {}}
B -> B: Record Metric & Set Cooldown
B -> T: WS Emit {type: "notification", payload: "A student is confused"}
B -> S: WS Emit {type: "metrics", payload: {confusionLevel: +1}}
B -> T: WS Emit {type: "metrics"}

S -> B: WS Send {type: "vote_break", payload: {}}
B -> B: Update Break Threshold
B -> T: WS Emit {type: "metrics", payload: {breakVotes: N}}

alt Break Threshold Reached
    B -> T: WS Emit {type: "notification", payload: "Class break requested by majority"}
end

@enduml
```

### 3. AI-Driven Live Quizzes

Teachers can trigger live quizzes generated from the current session's materials (like uploaded PDFs or live shared notes).

```plantuml
@startuml
!theme plain

actor Teacher as T
participant "Backend (FastAPI)" as B
participant "OpenAI API" as AI
actor Student as S

T -> B: WS Send {type: "generate_quiz"}
B -> AI: POST to LLM API with lecture notes context
AI --> B: Return Questions & Answers
B -> B: Save Quiz to Session State
B -> T: WS Emit {type: "quiz_ready", payload: {questions}}
B -> S: WS Emit {type: "quiz_ready", payload: {questions}}

S -> B: WS Send {type: "submit_quiz", payload: {answers}}
B -> B: Grade against generated rubric
B -> T: WS Emit {type: "participant_quiz_completed", payload: {score}}

@enduml
```

## Definition of Done Guidelines

- Ensure both API calls (`/api`) and WebSockets (`/ws`) are routing successfully through the reverse proxy.
- Ensure that the state isn't lost for users actively connected to WebSockets.
- Data persistence is tracked directly on the server's mount in SQLite.
