# Creator Tools Suite

A highly-optimized, completely browser-native suite of tools designed to automate viral video creation natively on your machine. All tools rely on client-side rendering with no heavy backend required.

## Tools Included

### 1. Auto Shorts Ranking Maker
Build dynamic, viral "Top 5" style ranking videos for YouTube Shorts and TikTok. Features custom dynamic HUD elements, infinite clip scrolling, real-time native Canvas playback, and high-quality WebM exports directly from your browser.
*(Try it via the main portal or direct at `tools/shorts-ranking.html`)*

### 2. Auto Clipping Engine (Phase 1 Prototype)
Simulates an AI scanning long-form video content to find viral Hooks (funny, serious, educational) and instantly formats them for mobile (9:16 layout) locally. Incorporates a Bring-Your-Own-Key (BYOK) architecture designed to connect natively to Google Gemini API for transcript analysis.
*(Try it via the main portal or direct at `tools/auto-clipper.html`)*

## Getting Started

Because this is a static client-side web application, you can simply open `index.html` to access the hub suite. 

If you wish to run a clean local server Environment (to bypass CORS when working with local video fetching):
```bash
git clone https://github.com/syednawazali01/Creator-Tools-Suite.git
cd Creator-Tools-Suite
npm install
npm start
```
This will configure and launch a local node server for you on your desktop.

## Technologies Embedded

- [Tailwind CSS](https://tailwindcss.com/) - Rapid Glassmorphism System
- [SortableJS](https://sortablejs.github.io/Sortable/) - Organic dragging/dropping DOM nodes 
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) - Hardware-accelerated frame composition
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) - Muxes video overlays and native audio output together buffer-by-buffer.

## Built with AI

This entire suite, including its visual glassmorphism UI, client-side Canvas rendering logic, scalable repository architecture, and SortableJS physics integration, was written and maintained using Advanced Agentic Coding Assistants (Google Gemini).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
