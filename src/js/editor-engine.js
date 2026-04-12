/**
 * editor-engine.js — Basic Video Editor
 * ──────────────────────────────────────
 * Responsibilities:
 *   1. Load a video file and initialise state
 *   2. Manage a segments array [{start, end, active}]
 *   3. Render an interactive timeline canvas (ruler + segments + handles + playhead)
 *   4. Handle split, delete, in/out trim operations
 *   5. Export via MediaRecorder canvas capture
 *   6. Optional FFmpeg.wasm MP4 transcoding (same pipeline as Dead-Air Destroyer)
 */

// ─── Global State ─────────────────────────────────────────────
let videoFile      = null;    // original File object
let videoDuration  = 0;       // total video duration in seconds
let segments       = [];      // [{start, end, active: bool}]
let inPoint        = 0;       // trim start (seconds)
let outPoint       = 0;       // trim end   (seconds)
let selIndex       = -1;      // index of currently selected segment (-1 = none)
let selectedFormat = 'webm';  // export format
let rafId          = null;    // requestAnimationFrame handle for playback sync
let isDragging     = false;   // timeline scrub state

// ─── Design Tokens ─────────────────────────────────────────────
const C_ACTIVE   = 'rgba(16,185,129,0.55)';   // emerald — kept segment
const C_SELECTED = 'rgba(16,185,129,0.95)';   // bright emerald — selected
const C_DELETED  = 'rgba(239,68,68,0.25)';    // red — deleted segment
const C_DIMMED   = 'rgba(0,0,0,0.55)';        // black overlay — outside trim range
const C_IN_OUT   = '#f59e0b';                  // amber — in/out handle lines
const C_PLAYHEAD = '#ffffff';                  // white — playhead line

// ─────────────────────────────────────────────────────────────
// VIDEO LOAD
// ─────────────────────────────────────────────────────────────

/**
 * onVideoLoaded
 * Entry point called by the file input. Sets up state, video element,
 * and triggers the first timeline draw.
 */
async function onVideoLoaded(input) {
    const file = input.files[0];
    if (!file) return;
    videoFile = file;

    const url = URL.createObjectURL(file);
    const vid = document.getElementById('preview-video');
    vid.src   = url;

    // Show editor, hide upload gate
    document.getElementById('upload-gate').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    document.getElementById('nav-export-btn').classList.remove('hidden');

    // Wait for metadata so we have an accurate duration
    await new Promise(r => { vid.onloadedmetadata = r; });
    videoDuration = vid.duration;

    // Initialise state — one full-length active segment
    segments = [{ start: 0, end: videoDuration, active: true }];
    inPoint  = 0;
    outPoint = videoDuration;
    selIndex = -1;

    // Animate timeline during playback
    vid.onplay  = () => { rafId = requestAnimationFrame(tickPlayhead); };
    vid.onpause = () => { cancelAnimationFrame(rafId); rafId = null; drawTimeline(); };
    vid.onended = () => { cancelAnimationFrame(rafId); rafId = null; drawTimeline(); };

    // Wire up timeline canvas interactions
    wireTimelineEvents();

    // Initial draw
    resizeCanvas();
    drawTimeline();
    updateStats();
}

// ─────────────────────────────────────────────────────────────
// PLAYBACK CONTROLS
// ─────────────────────────────────────────────────────────────

/** togglePlayPause — spacebar-style play/pause toggle */
function togglePlayPause() {
    const vid = document.getElementById('preview-video');
    vid.paused ? vid.play() : vid.pause();
    updatePlayIcon();
}

function updatePlayIcon() {
    const vid     = document.getElementById('preview-video');
    const icon    = document.getElementById('play-icon');
    icon.innerHTML = vid.paused
        ? `<polygon points="5 3 19 12 5 21 5 3"/>`       // play triangle
        : `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;  // pause bars
}

/** tickPlayhead — rAF loop that keeps the timeline in sync during playback */
function tickPlayhead() {
    drawTimeline();
    updateTimeBadge();
    rafId = requestAnimationFrame(tickPlayhead);
}

function updateTimeBadge() {
    const vid = document.getElementById('preview-video');
    document.getElementById('time-badge').textContent =
        `${fmtTime(vid.currentTime)} / ${fmtTime(videoDuration)}`;
}

// ─────────────────────────────────────────────────────────────
// TIMELINE CANVAS
// ─────────────────────────────────────────────────────────────

/**
 * resizeCanvas
 * Matches the canvas pixel width to its CSS-rendered width.
 * Call on window resize and on first load.
 */
function resizeCanvas() {
    const canvas = document.getElementById('timeline-canvas');
    canvas.width = canvas.parentElement.clientWidth;
    drawTimeline();
}

/**
 * drawTimeline
 * Renders the full timeline: ruler → segment blocks → trim overlay → handles → playhead.
 */
function drawTimeline() {
    if (!videoDuration) return;

    const canvas = document.getElementById('timeline-canvas');
    const W      = canvas.width;
    const H      = canvas.height;
    const ctx    = canvas.getContext('2d');
    const RULER  = 22;    // height of the time ruler at the top
    const BODY   = H - RULER;

    ctx.clearRect(0, 0, W, H);

    // ── Background ──
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, W, H);

    // ── Time ruler ──
    drawRuler(ctx, W, RULER);

    // ── Segment blocks ──
    segments.forEach((seg, i) => {
        const x1 = timeToX(seg.start, W);
        const x2 = timeToX(seg.end,   W);
        const w  = Math.max(1, x2 - x1 - 1);

        ctx.fillStyle = !seg.active
            ? C_DELETED
            : i === selIndex
                ? C_SELECTED
                : C_ACTIVE;

        ctx.fillRect(x1, RULER, w, BODY);

        // Segment divider
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x2 - 1, RULER, 2, BODY);
    });

    // ── Trim overlay: dim everything outside In/Out ──
    const inX  = timeToX(inPoint,  W);
    const outX = timeToX(outPoint, W);
    ctx.fillStyle = C_DIMMED;
    ctx.fillRect(0, RULER, inX, BODY);              // before In
    ctx.fillRect(outX, RULER, W - outX, BODY);      // after Out

    // ── In handle ──
    drawHandle(ctx, inX, H, C_IN_OUT, 'IN');

    // ── Out handle ──
    drawHandle(ctx, outX, H, C_IN_OUT, 'OUT');

    // ── Playhead ──
    const vid   = document.getElementById('preview-video');
    const playX = timeToX(vid.currentTime || 0, W);
    ctx.strokeStyle = C_PLAYHEAD;
    ctx.lineWidth   = 2;
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, H);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Time badge
    updateTimeBadge();
}

/** drawRuler — draws time tick marks and labels along the top strip */
function drawRuler(ctx, W, rulerH) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, W, rulerH);

    // Auto-scale tick interval based on duration
    const step = videoDuration <= 30  ? 1
               : videoDuration <= 120 ? 5
               : videoDuration <= 600 ? 15
               : 60;

    ctx.fillStyle  = '#475569';
    ctx.font       = '9px Outfit, sans-serif';
    ctx.textAlign  = 'center';

    for (let t = 0; t <= videoDuration; t += step) {
        const x    = timeToX(t, W);
        const major = t % (step * 2) === 0;

        ctx.fillStyle = major ? '#64748b' : '#334155';
        ctx.fillRect(x, 0, 1, major ? rulerH : rulerH / 2);

        if (major) {
            ctx.fillStyle = '#64748b';
            ctx.fillText(fmtTime(t), x, rulerH - 4);
        }
    }
}

/** drawHandle — draws an In or Out handle line with a small label tab */
function drawHandle(ctx, x, H, colour, label) {
    ctx.strokeStyle = colour;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();

    // Tab
    ctx.fillStyle = colour;
    ctx.fillRect(x - (label === 'IN' ? 0 : 16), 0, 16, 12);
    ctx.fillStyle = '#000';
    ctx.font      = 'bold 8px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + (label === 'IN' ? 8 : -8), 9);
}

// ─────────────────────────────────────────────────────────────
// TIMELINE MOUSE INTERACTIONS
// ─────────────────────────────────────────────────────────────

function wireTimelineEvents() {
    const canvas = document.getElementById('timeline-canvas');

    canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        isDragging = true;
        seekToPointer(e);
    });

    canvas.addEventListener('pointermove', e => {
        if (!isDragging) return;
        seekToPointer(e);
    });

    canvas.addEventListener('pointerup', e => {
        isDragging = false;
        canvas.releasePointerCapture(e.pointerId);
        // Select segment under click
        const vid = document.getElementById('preview-video');
        selIndex  = getSegmentAt(vid.currentTime);
        updateDeleteBtn();
        drawTimeline();
    });
}

/** seekToPointer — moves the video playhead to the clicked timeline position */
function seekToPointer(e) {
    const canvas = document.getElementById('timeline-canvas');
    const rect   = canvas.getBoundingClientRect();
    const normX  = (e.clientX - rect.left) / rect.width;
    const t      = Math.max(0, Math.min(videoDuration, normX * videoDuration));
    document.getElementById('preview-video').currentTime = t;
    if (!document.getElementById('preview-video').paused) return;
    drawTimeline();
}

// ─────────────────────────────────────────────────────────────
// EDITING OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * splitAtPlayhead
 * Inserts a cut at the current playhead position, dividing the
 * containing segment into two segments.
 */
function splitAtPlayhead() {
    const t   = document.getElementById('preview-video').currentTime;
    const idx = getSegmentAt(t);
    if (idx === -1) return;

    const seg   = segments[idx];
    // Don't split if the cut is right at the boundary (< 0.05s margin)
    if (t - seg.start < 0.05 || seg.end - t < 0.05) return;

    // Replace the segment with two halves
    const left  = { start: seg.start, end: t,       active: seg.active };
    const right = { start: t,         end: seg.end,  active: seg.active };
    segments.splice(idx, 1, left, right);

    selIndex = idx;  // select the left half
    updateDeleteBtn();
    drawTimeline();
    updateStats();

    showToast(`Split at ${fmtTime(t)}`);
}

/**
 * deleteSelected
 * Marks the currently selected segment as inactive.
 * The segment remains visible on the timeline in red.
 */
function deleteSelected() {
    if (selIndex === -1 || !segments[selIndex]) return;
    if (!segments[selIndex].active) {
        // Already deleted — restore it
        segments[selIndex].active = true;
        showToast('Segment restored');
    } else {
        segments[selIndex].active = false;
        showToast('Segment deleted');
    }
    drawTimeline();
    updateStats();
}

/** setInPoint — snaps the In trim handle to the current playhead */
function setInPoint() {
    const t = document.getElementById('preview-video').currentTime;
    if (t >= outPoint) return;
    inPoint = t;
    document.getElementById('in-display').textContent = fmtTime(inPoint);
    drawTimeline();
    updateStats();
}

/** setOutPoint — snaps the Out trim handle to the current playhead */
function setOutPoint() {
    const t = document.getElementById('preview-video').currentTime;
    if (t <= inPoint) return;
    outPoint = t;
    document.getElementById('out-display').textContent = fmtTime(outPoint);
    drawTimeline();
    updateStats();
}

// ─────────────────────────────────────────────────────────────
// FORMAT SELECTOR
// ─────────────────────────────────────────────────────────────

function setFormat(fmt) {
    selectedFormat = fmt;
    const ACTIVE   = 'fmt-btn py-2.5 rounded-xl text-sm font-black border border-emerald-500 bg-emerald-500/15 text-emerald-400 transition-all';
    const INACTIVE = 'fmt-btn py-2.5 rounded-xl text-sm font-black border border-white/10 text-slate-400 transition-all hover:border-white/25';
    document.getElementById('fmt-webm').className = fmt === 'webm' ? ACTIVE : INACTIVE;
    document.getElementById('fmt-mp4').className  = fmt === 'mp4'  ? ACTIVE : INACTIVE;
    document.getElementById('fmt-note').textContent = fmt === 'webm'
        ? 'Fast export · no conversion'
        : 'Universal MP4 · FFmpeg converts in-browser (~10 MB first use)';
}

// ─────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────

function updateStats() {
    const exportSegs = getExportSegments();
    const totalKept  = exportSegs.reduce((a, s) => a + (s.end - s.start), 0);
    const cuts       = Math.max(0, exportSegs.length - 1);
    document.getElementById('stat-duration').textContent = fmtTime(totalKept);
    document.getElementById('stat-cuts').textContent     = cuts;
    document.getElementById('stat-segs').textContent     = exportSegs.length;

    // Update in/out displays
    document.getElementById('in-display').textContent  = fmtTime(inPoint);
    document.getElementById('out-display').textContent = fmtTime(outPoint);
}

function updateDeleteBtn() {
    const btn = document.getElementById('delete-btn');
    if (selIndex === -1 || !segments[selIndex]) {
        btn.textContent = '🗑 Delete Segment';
        btn.disabled    = true;
        btn.classList.add('opacity-40');
        return;
    }
    btn.disabled = false;
    btn.classList.remove('opacity-40');
    btn.textContent = segments[selIndex].active
        ? '🗑 Delete Selected'
        : '♻ Restore Selected';
}

// ─────────────────────────────────────────────────────────────
// EXPORT ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * startExport
 * Iterates over all export segments, seeks the source video to each
 * one, and captures it to a recording canvas via MediaRecorder.
 * Optionally transcodes to MP4 via FFmpeg.wasm.
 */
async function startExport() {
    const exportSegs = getExportSegments();
    if (exportSegs.length === 0) {
        return alert('Nothing to export! Make sure you have at least one active segment within your In/Out range.');
    }

    // ── Show overlay ──
    const overlay = document.getElementById('export-overlay');
    const title   = document.getElementById('exp-title');
    const desc    = document.getElementById('exp-desc');
    const bar     = document.getElementById('exp-bar');

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    title.textContent = 'Preparing Engine…';
    bar.style.width   = '0%';

    // ── Source video (hidden, used for scrubbing) ──
    const srcVid = document.createElement('video');
    srcVid.src   = URL.createObjectURL(videoFile);
    srcVid.muted = false;
    document.body.appendChild(srcVid);
    await new Promise(r => { srcVid.onloadedmetadata = r; });

    // ── Recording canvas ──
    const canvas  = document.createElement('canvas');
    canvas.width  = srcVid.videoWidth  || 1920;
    canvas.height = srcVid.videoHeight || 1080;
    const ctx     = canvas.getContext('2d');

    // ── Audio routing ──
    const audioCtx  = new AudioContext();
    const audioDest = audioCtx.createMediaStreamDestination();
    const srcNode   = audioCtx.createMediaElementSource(srcVid);
    srcNode.connect(audioDest);
    srcNode.connect(audioCtx.destination);

    // ── MediaRecorder ──
    const stream   = new MediaStream([
        canvas.captureStream(30).getVideoTracks()[0],
        audioDest.stream.getAudioTracks()[0],
    ]);
    const recorder = new MediaRecorder(stream, {
        mimeType:          'video/webm',
        videoBitsPerSecond: 8_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    // ── onstop handler: optional MP4 conversion then show result ──
    recorder.onstop = async () => {
        const webmBlob = new Blob(chunks, { type: 'video/webm' });

        let finalBlob = webmBlob;
        let finalExt  = 'webm';

        // Optional MP4 transcoding via FFmpeg.wasm
        if (selectedFormat === 'mp4') {
            title.textContent = 'Converting to MP4…';
            desc.textContent  = 'Loading FFmpeg.wasm (one-time ~10 MB download)';
            bar.style.width   = '95%';
            overlay.classList.remove('hidden');
            overlay.classList.add('flex');

            try {
                const { createFFmpeg, fetchFile } = FFmpeg;
                const ffmpeg = createFFmpeg({
                    log: false,
                    progress: ({ ratio }) => {
                        bar.style.width  = (95 + ratio * 4).toFixed(1) + '%';
                        desc.textContent = `Converting… ${Math.round(ratio * 100)}%`;
                    },
                });

                await ffmpeg.load();
                desc.textContent = 'Transcoding VP9 → H.264…';
                ffmpeg.FS('writeFile', 'input.webm', await fetchFile(webmBlob));
                await ffmpeg.run(
                    '-i', 'input.webm',
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
                    '-c:a', 'aac', '-b:a', '128k',
                    '-movflags', '+faststart',
                    'output.mp4'
                );
                const data = ffmpeg.FS('readFile', 'output.mp4');
                finalBlob  = new Blob([data.buffer], { type: 'video/mp4' });
                finalExt   = 'mp4';
                ffmpeg.FS('unlink', 'input.webm');
                ffmpeg.FS('unlink', 'output.mp4');
            } catch (err) {
                console.error('MP4 conversion failed:', err);
                desc.textContent = 'Conversion failed — using WebM instead.';
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        // ── Cleanup ──
        document.body.removeChild(srcVid);
        audioCtx.close();

        const url = URL.createObjectURL(finalBlob);
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');

        // ── Populate result overlay ──
        document.getElementById('result-video').src = url;
        const dl    = document.getElementById('dl-link');
        dl.href     = url;
        dl.download = `${videoFile.name.replace(/\.[^.]+$/, '') || 'edited'}_export.${finalExt}`;
        document.getElementById('dl-label').textContent = `Download ${finalExt.toUpperCase()}`;

        const keptTime = exportSegs.reduce((a, s) => a + (s.end - s.start), 0);
        document.getElementById('result-meta').textContent =
            `${fmtTime(keptTime)} · ${exportSegs.length} segment${exportSegs.length !== 1 ? 's' : ''} · ${Math.round(finalBlob.size / 1024)} KB · ${finalExt.toUpperCase()}`;

        document.getElementById('result-overlay').classList.remove('hidden');
        document.getElementById('result-overlay').classList.add('flex');
    };

    recorder.start();
    bar.style.width = '3%';

    // ── Render each export segment ──
    for (let i = 0; i < exportSegs.length; i++) {
        const seg = exportSegs[i];
        title.textContent = `Rendering Segment ${i + 1} of ${exportSegs.length}…`;
        desc.textContent  = `${fmtTime(seg.start)} → ${fmtTime(seg.end)}`;

        srcVid.currentTime = seg.start;
        await new Promise(r => { srcVid.onseeked = r; });
        await srcVid.play();

        while (srcVid.currentTime < seg.end && !srcVid.ended) {
            ctx.drawImage(srcVid, 0, 0, canvas.width, canvas.height);
            const segPct   = (srcVid.currentTime - seg.start) / (seg.end - seg.start);
            const totalPct = (i + segPct) / exportSegs.length;
            bar.style.width = (3 + totalPct * 90).toFixed(1) + '%';
            await new Promise(r => requestAnimationFrame(r));
        }
        srcVid.pause();
    }

    bar.style.width = '100%';
    await new Promise(r => setTimeout(r, 200));
    recorder.stop();
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

/** getExportSegments — returns active segments clamped to In/Out range */
function getExportSegments() {
    return segments
        .filter(s => s.active)
        .map(s => ({
            start: Math.max(s.start, inPoint),
            end:   Math.min(s.end,   outPoint),
        }))
        .filter(s => s.end - s.start > 0.02);
}

/** getSegmentAt — returns the index of the segment containing time t */
function getSegmentAt(t) {
    return segments.findIndex(s => t >= s.start && t < s.end);
}

/** timeToX — converts a time value to a canvas X coordinate */
function timeToX(t, canvasWidth) {
    return (t / videoDuration) * canvasWidth;
}

/** fmtTime — converts seconds to "M:SS" string */
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

/**
 * showToast — brief status toast notification
 * @param {string} msg
 */
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('opacity-0', 'translate-y-2');
    el.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => {
        el.classList.remove('opacity-100', 'translate-y-0');
        el.classList.add('opacity-0', 'translate-y-2');
    }, 2000);
}

// Re-draw on window resize
window.addEventListener('resize', resizeCanvas);
