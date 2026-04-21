/**
 * ranking-engine.js — Auto Shorts Ranking Maker
 * ──────────────────────────────────────────────
 * Responsibilities:
 *   1. Manage dynamic ranking slot creation / removal / drag-sorting
 *   2. Render real-time rank badge labels as the user sorts
 *   3. Drive the HTML5 Canvas rendering loop that composes the
 *      final countdown video frame-by-frame
 *   4. Record the composed stream as WebM via MediaRecorder, then
 *      convert to H.264/AAC MP4 via FFmpeg.wasm for YT & Instagram Shorts
 */

// ─── State ───────────────────────────────────────────────────
// slots stores the uploaded File and label text keyed by a stable
// integer index that never changes even after drag-reordering.
let slots            = {};
let slotIndexCounter = 0;

// ─────────────────────────────────────────────────────────────
// SLOT MANAGEMENT
// ─────────────────────────────────────────────────────────────

/**
 * handleFileUpload
 * Called by the file input's onchange event inside each slot card.
 * Stores the chosen File object and shows the video thumbnail preview.
 */
function handleFileUpload(index, input) {
    const file          = input.files[0];
    slots[index].file   = file;
    const previewEl     = document.getElementById('preview-' + index);
    const thumbContainer = document.getElementById('thumb-container-' + index);

    if (file) {
        previewEl.src = URL.createObjectURL(file);
        thumbContainer.classList.remove('hidden');
    } else {
        previewEl.src = '';
        thumbContainer.classList.add('hidden');
    }
}

/**
 * addSlot
 * Creates a new draggable slot card and inserts it into the list.
 * @param {boolean} appendAtBottom  true = append, false = prepend
 */
function addSlot(appendAtBottom = false) {
    const i     = slotIndexCounter++;
    slots[i]    = { file: null, label: '', duration: 10 };
    const list  = document.getElementById('slots-list');

    const div               = document.createElement('div');
    div.className           = 'slot-item glass p-4 mt-3 rounded-xl flex gap-3 relative cursor-grab active:cursor-grabbing hover:bg-slate-800/80 transition-colors';
    div.dataset.origIndex   = i;

    div.innerHTML = `
        <!-- Remove button -->
        <div onclick="removeSlot(this)"
             class="absolute -right-2 -top-2 bg-red-600 hover:bg-red-500 rounded-full w-5 h-5
                    flex items-center justify-center text-white shadow-lg text-[10px] font-black
                    pointer-events-auto cursor-pointer z-10 transition-colors">
            X
        </div>

        <!-- Rank badge (updated by updateRankLabels) -->
        <div class="rank-badge absolute -top-3 -left-2 text-[9px] font-black px-2 py-1
                    rounded shadow-lg tracking-widest transform transition-all"></div>

        <!-- Drag handle + rank number -->
        <div class="flex flex-col items-center self-center gap-1 w-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" class="text-slate-500">
                <circle cx="9"  cy="12" r="1"/><circle cx="9"  cy="5"  r="1"/>
                <circle cx="9"  cy="19" r="1"/><circle cx="15" cy="12" r="1"/>
                <circle cx="15" cy="5"  r="1"/><circle cx="15" cy="19" r="1"/>
            </svg>
            <div class="rank-number text-xl font-black italic text-slate-500 text-center"></div>
        </div>

        <!-- File input + label text -->
        <div class="flex-1 mt-1 space-y-2 self-center">
            <div class="flex gap-2">
                <input type="file" accept="video/*"
                       onchange="handleFileUpload(${i}, this)"
                       class="text-[10px] block flex-1 text-slate-300
                              file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0
                              file:text-[10px] file:font-bold file:bg-slate-700 file:text-emerald-400
                              hover:file:bg-slate-600 cursor-pointer">
                
                <div class="flex flex-col gap-0.5 shrink-0">
                    <label class="text-[8px] text-slate-500 font-bold uppercase">Time</label>
                    <select onchange="slots[${i}].duration = parseInt(this.value)"
                            class="bg-slate-800 text-[10px] text-emerald-400 font-bold px-1 py-0.5 rounded border border-white/5 outline-none focus:border-emerald-500 transition-colors">
                        <option value="5">5s</option>
                        <option value="10" selected>10s</option>
                        <option value="15">15s</option>
                        <option value="20">20s</option>
                        <option value="30">30s</option>
                    </select>
                </div>
            </div>
            <input type="text" placeholder="Reveal text"
                   oninput="slots[${i}].label = this.value"
                   class="rank-label-input font-bold bg-black/30 w-full px-3 py-2
                          rounded-md outline-none focus:ring-1 focus:ring-emerald-500
                          transition-all text-sm">
        </div>

        <!-- Video thumbnail preview (shown after file selected) -->
        <div id="thumb-container-${i}"
             class="w-16 h-16 mt-1 hidden shrink-0 rounded-lg overflow-hidden
                    border-2 border-slate-700 bg-black/50 ml-1 hover:border-emerald-500 transition-colors">
            <video id="preview-${i}"
                   class="w-full h-full object-cover pointer-events-none"
                   muted loop playsinline
                   onmouseover="this.play()" onmouseout="this.pause()"></video>
        </div>
    `;

    appendAtBottom
        ? list.appendChild(div)
        : list.insertBefore(div, list.firstChild);

    updateRankLabels();
}

/** removeSlot — removes a slot card and refreshes labels */
function removeSlot(btn) {
    btn.closest('.slot-item').remove();
    updateRankLabels();
}

/**
 * init
 * Called on page load. Spawns 5 default slots and wires
 * up SortableJS drag-and-drop reordering.
 */
function init() {
    for (let k = 0; k < 5; k++) addSlot(true);

    new Sortable(document.getElementById('slots-list'), {
        animation:  150,
        ghostClass: 'opacity-50',
        onEnd:      updateRankLabels,
    });
}

/**
 * updateRankLabels
 * Reads current DOM order and re-stamps rank numbers and badge colours.
 * Top of list = highest rank (plays first in the countdown).
 */
function updateRankLabels() {
    const domSlots = Array.from(document.querySelectorAll('.slot-item'));
    const total    = domSlots.length;

    domSlots.forEach((el, index) => {
        const rank    = total - index;    // top card = highest rank
        const badge   = el.querySelector('.rank-badge');
        const numEl   = el.querySelector('.rank-number');
        const labelEl = el.querySelector('.rank-label-input');

        // Reset badge classes before applying new ones
        badge.classList.remove('bg-slate-600', 'bg-emerald-600', 'bg-yellow-500',
                               'text-black', 'scale-105', 'text-white');

        if (rank === total && total > 1) {
            // Highest rank — plays first
            badge.classList.add('bg-emerald-600', 'text-white', 'scale-105');
            badge.textContent = `RANK ${rank} (PLAYS FIRST)`;
        } else if (rank === 1) {
            // Winner / final reveal
            badge.classList.add('bg-yellow-500', 'text-black', 'scale-105');
            badge.textContent = 'RANK 1 (THE WINNER!)';
        } else {
            badge.classList.add('bg-slate-600', 'text-white');
            badge.textContent = `RANK ${rank}`;
        }

        numEl.textContent   = `#${rank}`;
        labelEl.placeholder = `Reveal text for Rank ${rank}`;
    });
}

// ─────────────────────────────────────────────────────────────
// MP4 CONVERSION (WebM → H.264/AAC MP4 via FFmpeg.wasm)
// ─────────────────────────────────────────────────────────────

/**
 * convertToMp4
 * Takes the raw WebM blob produced by MediaRecorder and re-encodes it
 * to H.264 + AAC inside an MP4 container — the universally accepted
 * format for YouTube Shorts and Instagram Reels.
 *
 * Settings chosen for Shorts/Reels compatibility:
 *   - Video: H.264 (libx264), yuv420p, CRF 18 (visually lossless), preset fast
 *   - Audio: AAC 192kbps stereo
 *   - Container: MP4 with -movflags +faststart (web-optimised — metadata at front)
 *
 * @param {Blob}   webmBlob   The raw WebM output from MediaRecorder
 * @param {string} filename   Base filename without extension
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
async function convertToMp4(webmBlob, filename) {
    const statusEl  = document.getElementById('status');
    const convertEl = document.getElementById('convert-status');
    const progressEl = document.getElementById('progress-bar');

    statusEl.textContent  = 'CONVERTING TO MP4 — PLEASE WAIT…';
    convertEl.classList.remove('hidden');
    progressEl.style.width = '95%';   // hold near-complete while FFmpeg runs

    // Load FFmpeg.wasm (loads WASM binary once, cached after first use)
    const { FFmpeg }   = FFmpegWASM;
    const { fetchFile } = FFmpegUtil;
    const ffmpeg        = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
        // Parse FFmpeg progress output to update sub-status text
        if (message.includes('time=')) {
            const match = message.match(/time=(\S+)/);
            if (match) convertEl.textContent = `Converting… ${match[1]}`;
        }
    });

    await ffmpeg.load({
        coreURL:   'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL:   'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        workerURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.worker.js',
    });

    // Write the WebM blob into FFmpeg's in-memory filesystem
    await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));

    // Re-encode:
    //   -c:v libx264        H.264 video (universal YT/IG support)
    //   -crf 18             Near-lossless quality (0=best, 51=worst; 18 is ideal for Shorts)
    //   -preset fast        Good speed/quality balance
    //   -pix_fmt yuv420p    Required for iOS/Android playback compatibility
    //   -c:a aac            AAC audio (required by MP4 spec and all platforms)
    //   -b:a 192k           High-quality stereo audio bitrate
    //   -movflags +faststart  Puts MP4 metadata at file start for instant web streaming
    await ffmpeg.exec([
        '-i',         'input.webm',
        '-c:v',       'libx264',
        '-crf',       '18',
        '-preset',    'fast',
        '-pix_fmt',   'yuv420p',
        '-c:a',       'aac',
        '-b:a',       '192k',
        '-movflags',  '+faststart',
        'output.mp4',
    ]);

    // Read the output MP4 back out of FFmpeg's virtual filesystem
    const mp4Data = await ffmpeg.readFile('output.mp4');
    const mp4Blob = new Blob([mp4Data.buffer], { type: 'video/mp4' });

    convertEl.classList.add('hidden');
    progressEl.style.width = '100%';

    return { blob: mp4Blob, filename: `${filename}.mp4` };
}

// ─────────────────────────────────────────────────────────────
// CANVAS RENDERING & EXPORT ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * generateVideo
 * Main export pipeline:
 *   - Reads current slot order from the DOM
 *   - Plays each clip in reverse rank order (highest rank → Rank 1)
 *   - Each frame is drawn onto a 720×1280 canvas with HUD overlays
 *   - MediaRecorder captures the canvas stream → WebM blob
 *   - FFmpeg.wasm converts the WebM → H.264/AAC MP4 for YT & Instagram Shorts
 */
async function generateVideo() {
    // Build ordered slot list respecting the current drag order
    const domItems    = Array.from(document.querySelectorAll('.slot-item'));
    const total       = domItems.length;
    const orderedSlots = [];

    for (let i = total - 1; i >= 0; i--) {
        const origIndex = domItems[i].dataset.origIndex;
        orderedSlots.push({ ...slots[origIndex], id: total - i });
    }

    const valid = orderedSlots.filter(s => s.file);
    if (valid.length < 1) return alert('Please upload at least one video!');

    // ── Canvas setup ──
    document.getElementById('loader').classList.remove('hidden');
    const canvas    = document.getElementById('canvas');
    const ctx       = canvas.getContext('2d');
    const CW = 720, CH = 1280;     // 9:16 portrait (Shorts format)
    canvas.width    = CW;
    canvas.height   = CH;

    // ── Audio routing ──
    const audioCtx  = new AudioContext();
    const audioDest = audioCtx.createMediaStreamDestination();

    // ── MediaRecorder ──
    const stream    = new MediaStream([
        canvas.captureStream(30).getTracks()[0],
        audioDest.stream.getTracks()[0],
    ]);
    const recorder  = new MediaRecorder(stream, {
        mimeType:          'video/webm;codecs=vp9,opus',
        videoBitsPerSecond: 8_000_000,
    });
    const chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);

    // ── On recording complete: convert WebM → MP4 then show result ──
    recorder.onstop = async () => {
        const webmBlob = new Blob(chunks, { type: 'video/webm' });

        // Build filename from user-entered titles
        const t1 = document.getElementById('t1').value;
        const t2 = document.getElementById('t2').value;
        const t3 = document.getElementById('t3').value;
        const t4 = document.getElementById('t4').value;
        let baseFilename = `${t1} ${t2} ${t3} ${t4}`.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
        if (!baseFilename) baseFilename = 'ranking_final';

        try {
            // Convert to MP4 (H.264 + AAC) for YouTube & Instagram Shorts
            const { blob: mp4Blob, filename: mp4Filename } = await convertToMp4(webmBlob, baseFilename);

            const url = URL.createObjectURL(mp4Blob);
            document.getElementById('final-video').src  = url;
            document.getElementById('dl-link').href     = url;
            document.getElementById('dl-link').download = mp4Filename;

        } catch (err) {
            // FFmpeg failed — fall back to original WebM so the user still gets their video
            console.error('MP4 conversion failed, falling back to WebM:', err);
            const url = URL.createObjectURL(webmBlob);
            document.getElementById('final-video').src  = url;
            document.getElementById('dl-link').href     = url;
            document.getElementById('dl-link').download = `${baseFilename}.webm`;
            document.getElementById('dl-link').textContent = '⬇ Download Video (WebM)';
        }

        document.getElementById('loader').classList.add('hidden');
        document.getElementById('result-modal').classList.remove('hidden');
    };

    recorder.start();

    // ── HUD overlay renderer (called once per frame) ──
    const drawOverlays = (currentRank) => {
        ctx.textAlign  = 'center';
        ctx.lineWidth  = 10;
        ctx.strokeStyle = '#000';
        ctx.lineJoin   = 'round';

        /** Helper: draw outlined text at (x, y) with fill colour */
        const drawText = (text, x, y, colour) => {
            ctx.strokeText(text, x, y);
            ctx.fillStyle = colour;
            ctx.fillText(text, x, y);
        };

        // Title row 1  (e.g. "Ranking FUNNIEST")
        ctx.font = "900 65px 'Outfit'";
        const t1 = document.getElementById('t1').value;
        const t2 = document.getElementById('t2').value;
        const w1 = ctx.measureText(t1 + ' ').width;
        const w2 = ctx.measureText(t2).width;
        const x1 = (CW - (w1 + w2)) / 2;
        drawText(t1 + ' ', x1 + w1 / 2,        120, '#FFF');
        drawText(t2,        x1 + w1 + w2 / 2,   120, '#eab308');   // amber

        // Title row 2  (e.g. "Water Park MOMENTS")
        ctx.font = "900 60px 'Outfit'";
        const t3 = document.getElementById('t3').value;
        const t4 = document.getElementById('t4').value;
        const w3 = ctx.measureText(t3 + ' ').width;
        const w4 = ctx.measureText(t4).width;
        const x2 = (CW - (w3 + w4)) / 2;
        drawText(t3 + ' ', x2 + w3 / 2,        200, '#10b981');    // emerald
        drawText(t4,        x2 + w3 + w4 / 2,   200, '#FFF');

        // Rank list (reveals labels as the countdown builds up)
        ctx.textAlign = 'left';
        const RANK_COLOURS = ['#eab308', '#10b981', '#ef4444', '#FFF', '#FFF'];

        orderedSlots.forEach((slot, i) => {
            const y     = 320 + i * 80;
            const colour = RANK_COLOURS[i] || '#FFF';
            ctx.font    = "900 55px 'Outfit'";
            drawText(`${slot.id}.`, 50, y, colour);

            // Only show the label for ranks already revealed
            if (slot.id >= currentRank && slot.label) {
                ctx.font = "900 35px 'Outfit'";
                drawText(slot.label.toUpperCase(), 120, y, '#FFF');
            }
        });
    };

    // Play clips from highest rank down to Rank 1
    const playOrder = [...valid].reverse();

    for (let i = 0; i < playOrder.length; i++) {
        const clip  = playOrder[i];
        const video = document.createElement('video');
        video.src     = URL.createObjectURL(clip.file);
        video.muted   = false;    // audio is routed to the recorder
        video.preload = 'auto';   // hint browser to eagerly decode

        document.getElementById('status').textContent =
            `Decoding clip ${i + 1} of ${playOrder.length}… please wait`;

        // Wait for metadata + first decodable frame (with 15s timeout for heavy clips)
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout decoding clip ' + (i + 1))), 15000);
            video.onloadeddata = () => {
                clearTimeout(timeout);
                const srcNode = audioCtx.createMediaElementSource(video);
                srcNode.connect(audioDest);
                srcNode.connect(audioCtx.destination);
                resolve();
            };
            video.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Cannot decode clip ' + (i + 1) + '. Unsupported format.'));
            };
        }).catch(err => {
            console.warn(err.message);
            document.getElementById('status').textContent = `⚠️ Skipped: ${err.message}`;
        });

        // If load failed, skip this clip gracefully
        if (video.readyState < 2) {
            URL.revokeObjectURL(video.src);
            continue;
        }

        await video.play().catch(() => {});

        // Frame loop — draw until clip ends naturally or duration reached.
        // Stall guard: if video time doesn't advance for >3s, bail out.
        let lastTime   = -1;
        let stalledMs  = 0;
        const STALL_LIMIT = 3000; // ms
        let lastRaf    = performance.now();

        document.getElementById('status').textContent =
            `Rendering clip ${i + 1} of ${playOrder.length}… stay on this tab`;

        while (!video.ended && video.currentTime < clip.duration) {
            const now    = performance.now();
            const deltaMs = now - lastRaf;
            lastRaf = now;

            // Stall detection — if currentTime hasn't moved, accumulate stall time
            if (video.currentTime === lastTime) {
                stalledMs += deltaMs;
                if (stalledMs > STALL_LIMIT) {
                    console.warn(`Clip ${i + 1} stalled — skipping remainder`);
                    document.getElementById('status').textContent =
                        `⚠️ Clip ${i + 1} stalled (heavy file) — moving to next clip`;
                    break;
                }
            } else {
                stalledMs = 0;   // reset whenever the frame advances
            }
            lastTime = video.currentTime;

            // Only draw if browser has a frame ready
            if (video.readyState >= 2) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, CW, CH);

                // Cover-fit the video into the portrait canvas
                const aspect = video.videoWidth / video.videoHeight;
                let vw = CW, vh = CW / aspect;
                if (vh < CH) { vh = CH; vw = CH * aspect; }
                ctx.drawImage(video, (CW - vw) / 2, (CH - vh) / 2, vw, vh);

                drawOverlays(clip.id);
            }

            document.getElementById('progress-bar').style.width =
                `${((i + video.currentTime / clip.duration) / playOrder.length) * 100}%`;

            await new Promise(r => requestAnimationFrame(r));
        }

        video.pause();
        URL.revokeObjectURL(video.src);
    }

    document.getElementById('status').textContent = 'Finalising video…';

    recorder.stop();
}

// Bootstrap on page load
init();
