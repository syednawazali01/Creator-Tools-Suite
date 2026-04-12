/**
 * editor-engine.js — Video Editor (Reimagined)
 * ─────────────────────────────────────────────
 * Timeline has three drag zones:
 *   IN handle   → drag left edge of trim region
 *   OUT handle  → drag right edge of trim region
 *   Playhead    → scrub anywhere else
 *
 * Segments array stores the cut map [{start, end, active}].
 * Export plays only (active && within inPoint→outPoint) segments.
 */

// ─── State ────────────────────────────────────────────────────
let videoFile      = null;
let videoDuration  = 0;
let segments       = [];
let inPoint        = 0;
let outPoint       = 0;
let selIndex       = -1;
let selectedFormat = 'webm';
let dragMode       = 'NONE';   // 'NONE' | 'IN' | 'OUT' | 'PLAYHEAD'
let rafId          = null;

// ─── Layout constants ─────────────────────────────────────────
const RULER_H    = 20;     // px — height of the time ruler strip
const HANDLE_HIT = 12;     // px — click hit zone around each trim handle
const HANDLE_W   = 12;     // px — width of the handle flag tab

// ─── Color palette ────────────────────────────────────────────
const C = {
    bg:          '#0f172a',
    ruler:       '#1e293b',
    rulerTick:   '#475569',
    rulerLabel:  '#64748b',
    segActive:   'rgba(16,185,129,0.55)',
    segSelected: 'rgba(16,185,129,0.92)',
    segDeleted:  'rgba(239,68,68,0.28)',
    segGap:      '#0f172a',
    trimDimmed:  'rgba(0,0,0,0.58)',
    trimBorder:  'rgba(245,158,11,0.4)',
    handle:      '#f59e0b',
    handleText:  '#000000',
    playhead:    '#ffffff',
    cutMark:     'rgba(255,255,255,0.6)',
};

// ─────────────────────────────────────────────────────────────
// LOAD
// ─────────────────────────────────────────────────────────────

async function onVideoLoaded(input) {
    const file = input.files[0];
    if (!file) return;
    videoFile = file;

    const url = URL.createObjectURL(file);
    const vid = document.getElementById('preview-video');
    vid.src   = url;

    document.getElementById('upload-gate').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');

    await new Promise(r => { vid.onloadedmetadata = r; });
    videoDuration = vid.duration;

    segments = [{ start: 0, end: videoDuration, active: true }];
    inPoint  = 0;
    outPoint = videoDuration;
    selIndex = -1;

    vid.onplay  = () => { rafId = requestAnimationFrame(tickPlayhead); };
    vid.onpause = () => { cancelAnimationFrame(rafId); rafId = null; drawTimeline(); };
    vid.onended = () => { cancelAnimationFrame(rafId); rafId = null; drawTimeline(); };

    wireTimelineEvents();
    resizeCanvas();
    updateStats();
    updateDeleteBtn();
}

// ─────────────────────────────────────────────────────────────
// PLAYBACK
// ─────────────────────────────────────────────────────────────

function togglePlayPause() {
    const vid = document.getElementById('preview-video');
    vid.paused ? vid.play() : vid.pause();
    updatePlayIcon();
}

function updatePlayIcon() {
    const vid  = document.getElementById('preview-video');
    const icon = document.getElementById('play-icon');
    icon.innerHTML = vid.paused
        ? `<polygon points="5 3 19 12 5 21 5 3"/>`
        : `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
}

function tickPlayhead() {
    drawTimeline();
    updateTimeBadge();
    rafId = requestAnimationFrame(tickPlayhead);
}

function updateTimeBadge() {
    const vid = document.getElementById('preview-video');
    document.getElementById('time-badge').textContent =
        `${fmtTime(vid.currentTime || 0)} / ${fmtTime(videoDuration)}`;
}

// ─────────────────────────────────────────────────────────────
// TIMELINE CANVAS
// ─────────────────────────────────────────────────────────────

function resizeCanvas() {
    const canvas = document.getElementById('timeline-canvas');
    canvas.width = canvas.parentElement.clientWidth;
    drawTimeline();
}

/**
 * drawTimeline — full repaint of the timeline canvas.
 * Draw order: bg → ruler → segments → trim dim → trim border →
 *             cut marks → IN handle → OUT handle → playhead
 */
function drawTimeline() {
    if (!videoDuration) return;

    const canvas = document.getElementById('timeline-canvas');
    const W      = canvas.width;
    const H      = canvas.height;
    const BODY_Y = RULER_H;
    const BODY_H = H - RULER_H;
    const ctx    = canvas.getContext('2d');

    ctx.clearRect(0, 0, W, H);

    // ── Background ──
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // ── Ruler ──
    drawRuler(ctx, W);

    // ── Segment blocks ──
    segments.forEach((seg, i) => {
        const x1 = timeToX(seg.start, W);
        const x2 = timeToX(seg.end,   W);
        const w  = Math.max(1, x2 - x1 - 1);

        ctx.fillStyle = !seg.active
            ? C.segDeleted
            : i === selIndex
                ? C.segSelected
                : C.segActive;
        ctx.fillRect(x1, BODY_Y, w, BODY_H);

        // 2px gap between segments
        ctx.fillStyle = C.segGap;
        ctx.fillRect(x2 - 1, BODY_Y, 2, BODY_H);
    });

    // ── Trim dim: shade everything outside IN→OUT ──
    const inX  = timeToX(inPoint,  W);
    const outX = timeToX(outPoint, W);

    ctx.fillStyle = C.trimDimmed;
    if (inX > 0) ctx.fillRect(0, BODY_Y, inX, BODY_H);
    if (outX < W) ctx.fillRect(outX, BODY_Y, W - outX, BODY_H);

    // ── Trim region top border (amber glow line) ──
    ctx.strokeStyle = C.handle;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(inX, BODY_Y, outX - inX, BODY_H);
    ctx.globalAlpha = 1;

    // ── Cut marks at segment boundaries ──
    segments.forEach((seg, i) => {
        if (i === 0) return;
        const x = timeToX(seg.start, W);
        ctx.strokeStyle = C.cutMark;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, BODY_Y);
        ctx.lineTo(x, H);
        ctx.stroke();

        // small downward triangle at top
        ctx.fillStyle = C.cutMark;
        ctx.beginPath();
        ctx.moveTo(x - 4, BODY_Y);
        ctx.lineTo(x + 4, BODY_Y);
        ctx.lineTo(x, BODY_Y + 6);
        ctx.closePath();
        ctx.fill();
    });

    // ── IN handle ──
    drawHandle(ctx, inX, BODY_Y, H, 'IN');

    // ── OUT handle ──
    drawHandle(ctx, outX, BODY_Y, H, 'OUT');

    // ── Playhead ──
    const vid   = document.getElementById('preview-video');
    const playX = timeToX(vid.currentTime || 0, W);
    ctx.strokeStyle = C.playhead;
    ctx.lineWidth   = 2;
    ctx.shadowColor = 'rgba(255,255,255,0.5)';
    ctx.shadowBlur  = 5;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, H);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Playhead circle head
    ctx.fillStyle = C.playhead;
    ctx.beginPath();
    ctx.arc(playX, 9, 5, 0, Math.PI * 2);
    ctx.fill();

    updateTimeBadge();
}

/**
 * drawHandle — renders one trim handle (IN or OUT).
 * A vertical amber line with a flag tab and directional arrow.
 */
function drawHandle(ctx, x, bodyY, H, type) {
    const isIn = type === 'IN';

    // Vertical line
    ctx.strokeStyle = C.handle;
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = 'rgba(245,158,11,0.6)';
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Flag tab (extends toward the trim region centre)
    ctx.fillStyle = C.handle;
    const tabX = isIn ? x : x - HANDLE_W;
    ctx.beginPath();
    ctx.roundRect(tabX, bodyY, HANDLE_W, 20, 3);
    ctx.fill();

    // Arrow in tab
    ctx.fillStyle   = C.handleText;
    ctx.font        = 'bold 9px sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isIn ? '◀' : '▶', tabX + HANDLE_W / 2, bodyY + 10);
}

/**
 * drawRuler — draws the time ruler at the top of the timeline.
 */
function drawRuler(ctx, W) {
    ctx.fillStyle = C.ruler;
    ctx.fillRect(0, 0, W, RULER_H);

    const step = videoDuration <= 30  ? 1
               : videoDuration <= 120 ? 5
               : videoDuration <= 600 ? 15
               : 60;

    ctx.font      = '9px Outfit, sans-serif';
    ctx.textAlign = 'center';

    for (let t = 0; t <= videoDuration; t += step) {
        const x     = timeToX(t, W);
        const major = t % (step * 2) === 0;

        ctx.fillStyle = major ? C.rulerLabel : C.rulerTick;
        ctx.fillRect(x, 0, 1, major ? RULER_H : RULER_H / 2);

        if (major) {
            ctx.fillStyle = C.rulerLabel;
            ctx.fillText(fmtTime(t), x, RULER_H - 4);
        }
    }
}

// ─────────────────────────────────────────────────────────────
// TIMELINE MOUSE / POINTER EVENTS
// ─────────────────────────────────────────────────────────────

function wireTimelineEvents() {
    const canvas = document.getElementById('timeline-canvas');

    // Determine which drag zone the pointer is in
    const getMode = (clientX) => {
        const rect = canvas.getBoundingClientRect();
        const x    = (clientX - rect.left) * (canvas.width / rect.width);
        const inX  = timeToX(inPoint,  canvas.width);
        const outX = timeToX(outPoint, canvas.width);

        if (Math.abs(x - inX)  <= HANDLE_HIT) return { mode: 'IN',      x };
        if (Math.abs(x - outX) <= HANDLE_HIT) return { mode: 'OUT',     x };
        return { mode: 'PLAYHEAD', x };
    };

    canvas.addEventListener('pointermove', e => {
        const { mode, x } = getMode(e.clientX);

        // Update cursor when not dragging
        if (dragMode === 'NONE') {
            canvas.style.cursor = (mode === 'IN' || mode === 'OUT')
                ? 'ew-resize' : 'col-resize';
            return;
        }

        const t = clamp(xToTime(x, canvas.width), 0, videoDuration);

        if (dragMode === 'IN') {
            inPoint = Math.min(t, outPoint - 0.05);
            document.getElementById('in-display').textContent  = fmtTime(inPoint);
        } else if (dragMode === 'OUT') {
            outPoint = Math.max(t, inPoint + 0.05);
            document.getElementById('out-display').textContent = fmtTime(outPoint);
        } else {
            document.getElementById('preview-video').currentTime = t;
        }

        updateStats();
        drawTimeline();
    });

    canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        const { mode, x } = getMode(e.clientX);
        dragMode           = mode;
        canvas.style.cursor = (mode === 'IN' || mode === 'OUT') ? 'ew-resize' : 'col-resize';

        // If clicking playhead area → also select segment under click
        if (mode === 'PLAYHEAD') {
            const t = clamp(xToTime(x, canvas.width), 0, videoDuration);
            document.getElementById('preview-video').currentTime = t;
            selIndex = getSegmentAt(t);
            updateDeleteBtn();
        }

        drawTimeline();
    });

    canvas.addEventListener('pointerup', e => {
        dragMode = 'NONE';
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = 'col-resize';
        drawTimeline();
    });
}

// ─────────────────────────────────────────────────────────────
// EDIT OPERATIONS
// ─────────────────────────────────────────────────────────────

function splitAtPlayhead() {
    const t   = document.getElementById('preview-video').currentTime;
    const idx = getSegmentAt(t);
    if (idx === -1) return;
    const seg = segments[idx];
    if (t - seg.start < 0.05 || seg.end - t < 0.05) return;

    segments.splice(idx, 1,
        { start: seg.start, end: t,       active: seg.active },
        { start: t,         end: seg.end,  active: seg.active }
    );

    selIndex = idx;
    updateDeleteBtn();
    drawTimeline();
    updateStats();
    showToast(`✂ Split at ${fmtTime(t)}`);
}

function deleteSelected() {
    if (selIndex === -1 || !segments[selIndex]) return;
    const wasActive = segments[selIndex].active;
    segments[selIndex].active = !wasActive;
    showToast(wasActive ? '🗑 Segment deleted' : '♻ Segment restored');
    updateDeleteBtn();
    drawTimeline();
    updateStats();
}

// ─────────────────────────────────────────────────────────────
// FORMAT
// ─────────────────────────────────────────────────────────────

function setFormat(fmt) {
    selectedFormat = fmt;
    const ACTIVE   = 'fmt-btn py-2 rounded-xl font-black text-sm border border-emerald-500 bg-emerald-500/15 text-emerald-400 transition-all';
    const INACTIVE = 'fmt-btn py-2 rounded-xl font-black text-sm border border-white/10 text-slate-500 transition-all hover:border-white/20';
    document.getElementById('fmt-webm').className = fmt === 'webm' ? ACTIVE : INACTIVE;
    document.getElementById('fmt-mp4').className  = fmt === 'mp4'  ? ACTIVE : INACTIVE;
    document.getElementById('fmt-note').textContent = fmt === 'webm'
        ? 'Fast · no conversion needed'
        : 'Universal · FFmpeg converts in-browser';
}

// ─────────────────────────────────────────────────────────────
// STATS & UI HELPERS
// ─────────────────────────────────────────────────────────────

function updateStats() {
    const segs    = getExportSegments();
    const kept    = segs.reduce((a, s) => a + (s.end - s.start), 0);
    const cuts    = Math.max(0, segs.length - 1);
    document.getElementById('stat-duration').textContent = fmtTime(kept);
    document.getElementById('stat-cuts').textContent     = cuts;
    document.getElementById('stat-segs').textContent     = segs.length;
    document.getElementById('in-display').textContent    = fmtTime(inPoint);
    document.getElementById('out-display').textContent   = fmtTime(outPoint);
}

function updateDeleteBtn() {
    const btn = document.getElementById('delete-btn');
    if (selIndex === -1 || !segments[selIndex]) {
        btn.textContent = '🗑  Delete Segment';
        btn.disabled    = true;
        btn.classList.add('opacity-40', 'cursor-not-allowed');
        return;
    }
    btn.disabled = false;
    btn.classList.remove('opacity-40', 'cursor-not-allowed');
    btn.textContent = segments[selIndex].active
        ? '🗑  Delete Segment'
        : '♻  Restore Segment';
}

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

// ─────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────

async function startExport() {
    const exportSegs = getExportSegments();
    if (!exportSegs.length) return alert('Nothing to export. Check your trim range and active segments.');

    const overlay = document.getElementById('export-overlay');
    const title   = document.getElementById('exp-title');
    const desc    = document.getElementById('exp-desc');
    const bar     = document.getElementById('exp-bar');

    overlay.classList.remove('hidden'); overlay.classList.add('flex');
    title.textContent = 'Preparing…';
    bar.style.width   = '0%';

    const srcVid = document.createElement('video');
    srcVid.src   = URL.createObjectURL(videoFile);
    srcVid.muted = false;
    document.body.appendChild(srcVid);
    await new Promise(r => { srcVid.onloadedmetadata = r; });

    const canvas  = document.createElement('canvas');
    canvas.width  = srcVid.videoWidth  || 1920;
    canvas.height = srcVid.videoHeight || 1080;
    const ctx     = canvas.getContext('2d');

    const audioCtx  = new AudioContext();
    const audioDest = audioCtx.createMediaStreamDestination();
    const srcNode   = audioCtx.createMediaElementSource(srcVid);
    srcNode.connect(audioDest);
    srcNode.connect(audioCtx.destination);

    const stream   = new MediaStream([
        canvas.captureStream(30).getVideoTracks()[0],
        audioDest.stream.getAudioTracks()[0],
    ]);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 8_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
        const webmBlob = new Blob(chunks, { type: 'video/webm' });
        let finalBlob  = webmBlob;
        let finalExt   = 'webm';

        if (selectedFormat === 'mp4') {
            title.textContent = 'Converting to MP4…';
            desc.textContent  = 'Loading FFmpeg.wasm (one-time ~10 MB download)';
            bar.style.width   = '95%';
            overlay.classList.remove('hidden'); overlay.classList.add('flex');
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
                ffmpeg.FS('writeFile', 'in.webm', await fetchFile(webmBlob));
                await ffmpeg.run('-i', 'in.webm', '-c:v', 'libx264', '-preset', 'ultrafast',
                    '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4');
                const data = ffmpeg.FS('readFile', 'out.mp4');
                finalBlob  = new Blob([data.buffer], { type: 'video/mp4' });
                finalExt   = 'mp4';
                ffmpeg.FS('unlink', 'in.webm');
                ffmpeg.FS('unlink', 'out.mp4');
            } catch (err) {
                console.error('FFmpeg error:', err);
                desc.textContent = 'Conversion failed — using WebM instead.';
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        document.body.removeChild(srcVid);
        audioCtx.close();
        overlay.classList.add('hidden'); overlay.classList.remove('flex');

        const url = URL.createObjectURL(finalBlob);
        document.getElementById('result-video').src = url;
        const dl   = document.getElementById('dl-link');
        dl.href    = url;
        dl.download = `${(videoFile.name.replace(/\.[^.]+$/, '') || 'export')}.${finalExt}`;
        document.getElementById('dl-label').textContent = `Download ${finalExt.toUpperCase()}`;

        const kept = exportSegs.reduce((a, s) => a + (s.end - s.start), 0);
        document.getElementById('result-meta').textContent =
            `${fmtTime(kept)} · ${exportSegs.length} segment${exportSegs.length !== 1 ? 's' : ''} · ${Math.round(finalBlob.size / 1024)} KB · ${finalExt.toUpperCase()}`;

        document.getElementById('result-overlay').classList.remove('hidden');
        document.getElementById('result-overlay').classList.add('flex');
    };

    recorder.start();
    bar.style.width = '3%';

    for (let i = 0; i < exportSegs.length; i++) {
        const seg = exportSegs[i];
        title.textContent = `Rendering ${i + 1} / ${exportSegs.length}`;
        desc.textContent  = `${fmtTime(seg.start)} → ${fmtTime(seg.end)}`;

        srcVid.currentTime = seg.start;
        await new Promise(r => { srcVid.onseeked = r; });
        await srcVid.play();

        while (srcVid.currentTime < seg.end && !srcVid.ended) {
            ctx.drawImage(srcVid, 0, 0, canvas.width, canvas.height);
            bar.style.width = (3 + ((i + (srcVid.currentTime - seg.start)/(seg.end - seg.start))/exportSegs.length) * 90).toFixed(1) + '%';
            await new Promise(r => requestAnimationFrame(r));
        }
        srcVid.pause();
    }

    bar.style.width = '100%';
    await new Promise(r => setTimeout(r, 150));
    recorder.stop();
}

// ─────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────

function getExportSegments() {
    return segments
        .filter(s => s.active)
        .map(s => ({ start: Math.max(s.start, inPoint), end: Math.min(s.end, outPoint) }))
        .filter(s => s.end - s.start > 0.02);
}

function getSegmentAt(t) {
    return segments.findIndex(s => t >= s.start && t < s.end);
}

/** timeToX — video time → canvas X pixel */
function timeToX(t, W) { return (t / videoDuration) * W; }

/** xToTime — canvas X pixel → video time  */
function xToTime(x, W) { return (x / W) * videoDuration; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

window.addEventListener('resize', resizeCanvas);
