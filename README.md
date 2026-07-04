# 🌌 GitHub Activity Viewer

A full-stack web application to explore GitHub profiles, repositories, issues, pull requests, commits, and user activity — powered by the official GitHub REST API and an Express backend.

![GitHub last commit](https://img.shields.io/github/last-commit/swas-g/Github-User-Activity?style=for-the-badge&color=2ea043)
![GitHub license](https://img.shields.io/github/license/swas-g/Github-User-Activity?style=for-the-badge&color=58a6ff)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)

---

## ✨ Features

### Search & discovery
- 🔍 **Username search** — fetch recent public activity for any GitHub user
- 🔗 **Link paste support** — paste a GitHub URL and get an instant detailed breakdown (auto-searches on paste)
- 📋 **Recent searches** — quick access to your last 8 lookups (stored in browser localStorage)

### Supported link types
| Link | Example | What you get |
|------|---------|--------------|
| **Profile** | `https://github.com/torvalds` | Avatar, bio, stats, recent activity |
| **Repository** | `https://github.com/facebook/react` | Stars, forks, language, license, topics |
| **Issue** | `https://github.com/owner/repo/issues/42` | Title, status, labels, comments |
| **Pull request** | `https://github.com/owner/repo/pull/99` | Merge status, branches, diff stats |
| **Commit** | `https://github.com/owner/repo/commit/abc123` | Message, author, additions/deletions |

### Activity feed
- 📌 **PushEvent** — branch-aware push messages
- ⭐ **WatchEvent** — starred repositories
- 🍴 **ForkEvent** — forked repositories
- ✨ **CreateEvent** — new repos, branches, or tags
- 🔹 **Fallback** — human-readable names for any other event type

### Backend
- ⚡ **Express API** — proxies GitHub requests through `/api/search`
- 🗄️ **In-memory caching** — reduces duplicate API calls (5-minute TTL)
- 🔑 **Optional GitHub token** — raise rate limits from 60 to 5,000 requests/hour
- 📊 **Rate limit tracking** — remaining API quota shown in the UI

### Frontend
- 🎨 **GitHub dark theme** — responsive layout with gradient accents and animations
- ⌨️ **Keyboard support** — press `Enter` to search
- ⏳ **Loading & error states** — spinner, clear messages, connection status pill
- 🕐 **Relative timestamps** — activity shown as "2h ago", "3d ago", etc.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|-------|--------------|
| **Frontend** | HTML5, CSS3 (CSS variables, Flexbox, Grid, animations) |
| **Client** | ES6+ JavaScript (Fetch API, localStorage) |
| **Backend** | Node.js, Express, CORS, dotenv |
| **API** | [GitHub REST API](https://docs.github.com/en/rest) |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) **18 or higher**
- npm (included with Node.js)

### Installation

```bash
git clone https://github.com/swas-g/Github-User-Activity.git
cd Github-User-Activity
npm install
```

### Configuration (optional)

Copy the example env file and add a GitHub personal access token for higher API rate limits:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
GITHUB_TOKEN=your_github_token_here
```

Create a token at [github.com/settings/tokens](https://github.com/settings/tokens) — no special scopes are required for public data.

### Run the app

```bash
npm start
```

Open **http://localhost:3000** in your browser.

For development with auto-restart on file changes:

```bash
npm run dev
```

> **Note:** The app requires the backend server. Opening `index.html` directly in the browser will not work because API calls go to `/api/search`.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server status, token config, cache stats |
| `GET` | `/api/search?q={input}` | Search by username or GitHub URL |

**Example:**

```bash
curl "http://localhost:3000/api/search?q=octocat"
curl "http://localhost:3000/api/search?q=https://github.com/facebook/react"
```

---

## 📂 Project Structure

```
Github-User-Activity/
├── server.js          # Express server entry point
├── lib/
│   ├── github.js      # GitHub API client & lookup handlers
│   ├── parser.js      # Username / URL parser
│   └── cache.js       # In-memory response cache
├── index.html         # App markup
├── style.css          # GitHub dark theme styling
├── script.js          # Frontend rendering & API calls
├── package.json       # Dependencies & scripts
├── .env.example       # Environment variable template
├── LICENSE            # MIT License
└── README.md          # Documentation
```

---

## 📜 License

This project is licensed under the [MIT License](LICENSE). Feel free to use, modify, and distribute it!
