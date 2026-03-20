# Project Documentation: Real-Time Educational Engagement Platform (MVP)

## 1. Executive Summary

This project is a browser-based, live screen-sharing application designed to solve the lack of student engagement and accommodate shy students in educational settings. Tailored for the faculty at VIA University College, the platform overlays real-time, anonymous student feedback (confusion alerts, break requests) and AI-generated interactive elements (quizzes) directly onto a live presentation feed.

**Primary Objective:** Deliver a fully functional, deployed Minimum Viable Product (MVP) within a 24-hour hackathon timeframe.

## 2. Technical Architecture & Recommended Stack

To achieve a live-sharing Kahoot/Google Meet hybrid in 24 hours, the architecture must prioritize low latency and rapid development.

* **Real-Time Communication (Screen Sharing):** WebRTC. Essential for browser-to-browser, low-latency video feeds.
* **Real-Time Data (State/Engagement):** WebSockets (e.g., Socket.io or standard WebSockets). Required for instant break requests, confusion alerts, and quiz triggers without polling the database.
* **Frontend:** React with Tailwind
* **Backend:** Python with FastAPI
* **AI Integration:** OpenAI API (GPT-3.5/4o-mini) or Anthropic API. Used strictly for parsing the current context/notes and generating the 1-question quiz with 4 options.
* **Database:** SQLite or PostgreSQL. For a 24h MVP, SQLite is sufficient to store session data, attendance, and basic statistics.

## 3. Actor Analysis & Use Cases

### Actor 1: Teacher (Host)

* **UC-T1: Screen Management:** Initialize session, generate join code, share screen, freeze screen, pause sharing, and modify session settings.
* **UC-T2: Engagement Monitoring:** Receive non-intrusive UI alerts when students report confusion or request a break. View real-time aggregated engagement metrics.
* **UC-T3: AI Quiz Generation:** Trigger a single-button action to generate a contextual multiple-choice question (4 options). Push the question as a global overlay to all connected students.
* **UC-T4: Break Management:** Initiate a synchronized break timer manually or accept a break prompt triggered by student thresholds.
* **UC-T5: Note Distribution:** Create and push shared text notes to the student interface during the live session.
* **UC-T6: Analytics Dashboard:** Access post-session statistics, including attendance, aggregate engagement levels, quiz accuracy, and exported notes.

### Actor 2: Student (Client)

* **UC-S1: Session Access:** Join the live session via browser using the teacher's code. View the live screen share.
* **UC-S2: Confusion Reporting:** Click a button to anonymously flag confusion.
* **UC-S3: Break Request:** Click a button to vote for a break. *Constraint:* Must be governed by a rate-limiting cooldown mechanism to prevent spam.
* **UC-S4: Quiz Participation:** Receive and interact with the pop-up quiz overlay, selecting one of the 4 generated options.
* **UC-S5: Break Interface:** View the synchronized countdown timer indicating when the session resumes.

## 5. Deployment Protocol

You have an Ubuntu server and domains. Execute the following for a stable MVP deployment:

1. **Reverse Proxy:** Install Nginx. Point your domain to the server IP and configure Nginx to route traffic to your application port.
2. **SSL Configuration:** Run Certbot (Let's Encrypt) for the domain. **Critical:** WebRTC *requires* HTTPS to function in modern browsers. It will fail locally or over HTTP.
3. **Process Manager:** Use PM2 (if Node.js) or Gunicorn/Systemd (if Python) to keep the backend alive during the presentation.

To finalize the technical scope for the 24-hour window, I need clarification on the AI implementation: What specific input data will the AI use to generate the quiz question? Will it transcribe the teacher's audio, analyze the shared screen visually, or rely on the teacher's manually typed notes?

# 6. Implementation notes

Should be extremely simple to deploy. Everything must be in this one repository, ideally split into folders that make sense.

---
