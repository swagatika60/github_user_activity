# 🌌 GitHub Activity Viewer

A full-stack web application to explore GitHub profiles, repositories, issues, pull requests, commits, and user activity — with user accounts, persistent search history, and deploy-ready backend.

![GitHub last commit](https://img.shields.io/github/last-commit/swas-g/Github-User-Activity?style=for-the-badge&color=2ea043)
![GitHub license](https://img.shields.io/github/license/swas-g/Github-User-Activity?style=for-the-badge&color=58a6ff)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white)

---

## ✨ Features

### Search & discovery
- 🔍 **Username search** — fetch recent public activity for any GitHub user
- 🔗 **Link paste support** — paste a GitHub URL for an instant detailed breakdown (auto-searches on paste)
- 📋 **Search history** — local history for guests; synced to database when signed in

### Supported link types
| Link | Example | What you get |
|------|---------|--------------|
| **Profile** | `https://github.com/torvalds` | Avatar, bio, stats, recent activity |
| **Repository** | `https://github.com/facebook/react` | Stars, forks, language, license, topics |
| **Issue** | `https://github.com/owner/repo/issues/42` | Title, status, labels, comments |
| **Pull request** | `https://github.com/owner/repo/pull/99` | Merge status, branches, diff stats |
| **Commit** | `https://github.com/owner/repo/commit/abc123` | Message, author, additions/deletions |

### User accounts
- 👤 **Register & sign in** — email/password authentication with JWT sessions
- 💾 **Persistent history** — searches saved per user in the database (up to 50 entries)
- 🔐 **Secure passwords** — bcrypt hashing; tokens expire after 7 days

### Backend
- ⚡ **Express API** — proxies GitHub requests through `/api/search`
- 🗄️ **Database persistence** — SQLite locally, PostgreSQL in production
- 📦 **API response cache** — memory + database cache (5-minute TTL)
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
| **Frontend** | HTML5, CSS3, ES6+ JavaScript |
| **Backend** | Node.js, Express, JWT, bcrypt |
| **Database** | SQLite (local) / PostgreSQL (production) |
| **API** | [GitHub REST API](https://docs.github.com/en/rest) |
| **Deploy** | [Render](https://render.com), [Vercel](https://vercel.com) |

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

### Configuration

Copy the example env file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3000
GITHUB_TOKEN=your_github_token_here
JWT_SECRET=use-a-long-random-string-in-production
DATABASE_URL=
```

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default `3000`) |
| `GITHUB_TOKEN` | No | GitHub PAT for higher API rate limits |
| `JWT_SECRET` | Yes (production) | Secret for signing auth tokens |
| `DATABASE_URL` | No | PostgreSQL connection string; omit for local SQLite |

Create a GitHub token at [github.com/settings/tokens](https://github.com/settings/tokens) — no special scopes are required for public data.

### Run locally

```bash
npm start
```

Open **http://localhost:3000** in your browser.

For development with auto-restart:

```bash
npm run dev
```
īīī
> **Note:** The app requires the backend server. Opening `index.html` directly will not work.

Local SQLite data is stored in `data/app.db` (gitignored).

---

## 🔌 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | No | Server status, database driver, cache stats |
| `GET` | `/api/search?q={input}` | Optional | Search by username or GitHub URL |
| `POST` | `/api/auth/register` | No | Create account `{ email, name, password }` |
| `POST` | `/api/auth/login` | No | Sign in `{ email, password }` |
| `GET` | `/api/auth/me` | Yes | Current user profile |
| `GET` | `/api/history` | Yes | User search history |
| `DELETE` | `/api/history` | Yes | Clear user search history |

**Examples:**

```bash
# Search
curl "http://localhost:3000/api/search?q=octocat"
curl "http://localhost:3000/api/search?q=https://github.com/facebook/react"

# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Demo User","email":"demo@example.com","password":"secret123"}'

# Authenticated search (saves to history)
curl "http://localhost:3000/api/search?q=torvalds" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## ☁️ Deployment

### Render (recommended)

This repo includes a [`render.yaml`](render.yaml) Blueprint that provisions:

- A **Web Service** running `npm start`
- A free **PostgreSQL** database wired via `DATABASE_URL`
- Auto-generated `JWT_SECRET`

**Steps:**

1. Push this repo to GitHub
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect your repository — Render reads `render.yaml` automatically
4. Add `GITHUB_TOKEN` in the service environment variables (optional but recommended)
5. Deploy — your app will be live at `https://your-app.onrender.com`

### Vercel

This repo includes [`vercel.json`](vercel.json) for serverless deployment.

**Steps:**

1. Install the [Vercel CLI](https://vercel.com/docs/cli) or connect the repo on [vercel.com](https://vercel.com)
2. Add environment variables in the Vercel dashboard:
   - `JWT_SECRET` — required
   - `DATABASE_URL` — PostgreSQL from [Neon](https://neon.tech), [Supabase](https://supabase.com), or Render
   - `GITHUB_TOKEN` — optional
3. Deploy:

```bash
npx vercel
```

> **Vercel note:** Use an external PostgreSQL database (`DATABASE_URL`). SQLite does not work on Vercel's serverless runtime.

---

## 📂 Project Structure

```
Github-User-Activity/
├── server.js          # Local server entry point
├── app.js             # Express app factory
├── api/
│   └── index.js       # Vercel serverless handler
├── lib/
│   ├── auth.js        # JWT auth & user management
│   ├── cache.js       # Memory + DB API cache
│   ├── db.js          # SQLite / PostgreSQL adapter
│   ├── github.js      # GitHub API client
│   └── parser.js      # Username / URL parser
├── index.html         # App markup
├── style.css          # Styling
├── script.js          # Frontend logic
├── render.yaml        # Render Blueprint
├── vercel.json        # Vercel config
├── package.json
├── .env.example
└── README.md
```

---

## 📜 License

This project is licensed under the [MIT License](LICENSE). Feel free to use, modify, and distribute it!
