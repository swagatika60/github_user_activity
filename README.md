# 🌌 GitHub Activity Viewer

A modern, responsive, and clean web application to fetch and display the recent activity of any GitHub user using the official GitHub REST API.

![GitHub last commit](https://img.shields.io/github/last-commit/swas-g/Github-User-Activity?style=for-the-badge&color=2ea043)
![GitHub license](https://img.shields.io/github/license/swas-g/Github-User-Activity?style=for-the-badge&color=58a6ff)

---

## ✨ Features

- 🔍 **Real-time Search:** Instantly look up any public GitHub username.
- 📌 **Detailed Event Mapping:** Parses events such as Pushes, Stars (`WatchEvent`), Forks, and Repository Creation dynamically.
- 🔗 **Direct Links:** Click on any repository name to open it in a new tab on GitHub.
- ⌨️ **Keyboard Support:** Submit searches seamlessly by pressing the `Enter` key.
- 🎨 **Elegant GitHub Dark Theme:** Fully responsive UI designed to mimic GitHub's native modern dark theme.
- ⚠️ **Robust Error Handling:** Informative feedback for non-existent users, empty searches, or zero recent activity.

---

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3 (Custom Variables, Flexbox, Keyframe Animations)
- **Scripting:** Modern ES6+ JavaScript (Async/Await, Fetch API)
- **API Integration:** [GitHub REST API](https://docs.github.com/en/rest)

---

## 🚀 How to Run Locally

Since this is a lightweight, purely client-side application, you don't need to install any heavy packages or compile any code.

### Option 1: Double-click
Simply clone this repository or download the ZIP, then double-click `index.html` to open it in any web browser.

### Option 2: Live Server (Recommended)
If you are using **VS Code**, install the **Live Server** extension, then:
1. Open the project folder in VS Code.
2. Click **Go Live** at the bottom right of the status bar.
3. Your browser will automatically open `http://127.0.0.1:5500/index.html`.

---

## 📂 Project Structure

```
Github-User-Activity/
├── index.html     # App structure and markup
├── style.css      # Custom GitHub Dark styling & animations
├── script.js     # DOM manipulation & GitHub API integration
├── LICENSE        # MIT License
└── README.md      # Documentation
```

---

## 📜 License

This project is licensed under the [MIT License](LICENSE). Feel free to use, modify, and distribute it!
