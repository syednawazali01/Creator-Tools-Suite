# Shorts Ranking Pro

A browser-based client-side application for generating viral "Top 5" style ranking videos for YouTube Shorts, TikTok, and Instagram Reels. Build dynamic ranking videos with custom text overlays, drag-and-drop ordering, and real-time canvas rendering natively exported to `.webm`.

## Features

- **Infinite Dynamic Ranks:** Add as many video clips as you want. Ranks automatically adjust formatting.
- **Drag & Drop UI:** Powered by SortableJS, intuitively rearrange your ranking stack. The #1 rank is automatically positioned and styled.
- **Real-time Live Preview:** Watch the canvas visually assemble your video frame-by-frame built right into the rendering screen. 
- **Browser-Native Exporter:** Uses the HTML5 Canvas API and MediaRecorder to render your fully composited video directly into a single high-bitrate WebM file. No server backend required!
- **Glassmorphism Aesthetic:** A gorgeous TailwindCSS interface optimized for creators.

## Demo

- Open `index.html` in Chrome or Edge for the best experience.
- Fill out the customization form, upload your video clips, and hit **Generate Video**.

## Getting Started

### Local Setup

Because this is a static client-side web application, you can simply open the `index.html` file in your browser to run it. If you wish to use a local web server (to avoid Cross-Origin Resource Sharing restrictions with local video blobs), you can use NodeJS.

```bash
git clone https://github.com/your-username/shorts-ranking-pro.git
cd shorts-ranking-pro
npm install
npm start
```
This will launch a local server and host the directory.

## Technologies Used

- [Tailwind CSS](https://tailwindcss.com/) - Rapid UI Styling
- [SortableJS](https://sortablejs.github.io/Sortable/) - Core drag-and-drop sorting physics
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) - Hardware-accelerated frame composition
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) - Stream capture for Video/Audio muxing

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
