# Contributing to Creator Tools Suite

Thanks for your interest in contributing! This is a zero-dependency, browser-native project — no build step, no framework. Keep it that way.

---

## Table of Contents

- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [How to Add a New Tool](#how-to-add-a-new-tool)
- [Naming Conventions](#naming-conventions)
- [Code Style](#code-style)
- [Submitting a PR](#submitting-a-pr)

---

## Project Structure

```
src/
├── components/    # One .html file per tool (UI + layout)
├── css/           # global.css — shared Tailwind overrides and glass styles
└── js/            # One engine .js file per tool (all logic lives here)
```

Each tool is a **self-contained pair**: `{tool-name}.html` + `{tool-name}-engine.js`.  
The HTML file loads its engine via a `<script src="...">` tag at the bottom.

---

## Running Locally

```bash
git clone https://github.com/syednawazali01/Creator-Tools-Suite.git
cd Creator-Tools-Suite
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). No build step needed — just save and refresh.

---

## How to Add a New Tool

1. **Create the component file**
   ```
   src/components/your-tool-name.html
   ```
   Copy an existing component (e.g. `shorts-ranking.html`) as a starting template.  
   Link to your engine at the bottom: `<script src="../js/your-tool-name-engine.js"></script>`

2. **Create the engine file**
   ```
   src/js/your-tool-name-engine.js
   ```
   All JavaScript logic for the tool goes here. Keep it in one file.

3. **Add a card to `index.html`**
   Copy an existing tool card block and update the `href`, icon, title, and description.

4. **Update `README.md`**
   Add your tool to the "Tools Included" section with a short description and the correct path.

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Component file | `kebab-case.html` | `clip-trimmer.html` |
| Engine file | `kebab-case-engine.js` | `clip-trimmer-engine.js` |
| CSS classes | Tailwind utilities + `global.css` overrides | `glass-card`, `interactive` |
| JS functions | `camelCase` | `initCanvas()`, `exportVideo()` |
| JS constants | `UPPER_SNAKE_CASE` | `MAX_CLIP_DURATION` |

---

## Code Style

- **No frameworks.** Vanilla HTML5, CSS3, and JavaScript only.
- **No bundlers.** Everything runs directly in the browser.
- **Canvas rendering** for video composition — use `requestAnimationFrame` loops.
- **One engine file per tool.** Don't import across tools.
- Keep global.css minimal — use Tailwind CDN classes wherever possible.
- Comment non-obvious logic, especially Canvas math and MediaRecorder buffer handling.

---

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b feature/your-tool-name`
2. Make your changes following the conventions above
3. Test in both Chrome and Firefox (MediaRecorder support varies)
4. Open a Pull Request with a short description of what the tool does and a screenshot/demo GIF if possible

---

Questions? Open an issue or reach out via GitHub.
