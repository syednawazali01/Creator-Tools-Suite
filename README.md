# Creator Tools Suite

A highly-optimized, completely browser-native suite of tools designed to automate viral video creation natively on your machine. All tools rely on client-side rendering with no heavy backend required.

## Tools Included

### 1. Auto Shorts Ranking Maker
Build dynamic, viral "Top 5" style ranking videos for YouTube Shorts and TikTok. Features custom dynamic HUD elements, infinite clip scrolling, real-time native Canvas playback, and high-quality WebM exports directly from your browser.
*(Try it via the main portal or directly at `src/components/shorts-ranking.html`)*

### 2. Dead-Air Destroyer
Upload raw footage and the engine scans audio waveforms to surgically remove dead silence, background noise, breaths, and long pauses — with native browser export.
*(Try it via the main portal or directly at `src/components/deadair-destroyer.html`)*

### 3. Video Editor
Visual timeline editor. Split, trim, and delete segments with a single click — then export a clean WebM or MP4 natively in your browser.
*(Try it via the main portal or directly at `src/components/video-editor.html`)*

## Project Structure

```
tool/
├── index.html                        # Main hub / dashboard
├── coi-serviceworker.js              # Cross-Origin Isolation service worker
├── package.json
├── .env.example                      # API key template (copy to .env.local)
├── CONTRIBUTING.md                   # Contribution guide
└── src/
    ├── components/                   # One HTML file per tool
    │   ├── shorts-ranking.html
    │   ├── deadair-destroyer.html
    │   └── video-editor.html
    ├── css/
    │   └── global.css                # Shared styles
    └── js/                           # Engine logic per tool
        ├── ranking-engine.js
        ├── deadair-engine.js
        └── editor-engine.js
```

## Getting Started

Because this is a static client-side web application, you can simply open `index.html` in your browser to access the hub.

For a clean local server (recommended — bypasses CORS issues with local video files):

```bash
git clone https://github.com/syednawazali01/Creator-Tools-Suite.git
cd Creator-Tools-Suite
npm install
npm start
```

This launches a local Node server. Open [http://localhost:3000](http://localhost:3000) in your browser.

## API Key Setup (Optional)

Some tools support optional AI features via the Google Gemini API (BYOK — Bring Your Own Key).

1. Copy `.env.example` to `.env.local`
2. Add your Gemini API key
3. The key is entered directly in the tool UI — it is never sent to any server

See `.env.example` for details.

## Technologies Used

- [Tailwind CSS](https://tailwindcss.com/) — Glassmorphism UI system (CDN)
- [SortableJS](https://sortablejs.github.io/Sortable/) — Drag-and-drop DOM nodes
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) — Hardware-accelerated frame composition
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) — Buffer-by-buffer video/audio muxing

## Contributing

Want to add a new tool or improve an existing one? See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Built With AI

This suite was built and maintained using advanced agentic coding assistants (Google Gemini & Claude).

## License

MIT — see [LICENSE](LICENSE) for details.
