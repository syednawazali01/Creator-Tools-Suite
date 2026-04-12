/**
 * deadair-engine.js — Dead-Air Destroyer
 * ────────────────────────────────────────
 * Responsibilities:
 *   1. Decode video audio into raw PCM via AudioContext
 *   2. Scan 20ms chunks and compute per-chunk RMS dB levels
 *   3. Apply active filters (silence / noise / breath / filler)
 *      to build a keep-segment map
 *   4. Render waveform visualiser + colour-coded timeline to canvas
 *   5. Re-record only the keep segments via MediaRecorder canvas capture
 *   6. Optionally transcode the WebM output to MP4 via FFmpeg.wasm
 */

// ─── Global State ─────────────────────────────────────────────
let audioBuffer   = null;   // Decoded PCM from the uploaded video
let videoDuration = 0;      // Total duration in seconds
let videoFile     = null;   // Original File object (needed for export)
let keepSegments  = [];     // Array of {start, end} seconds to keep

// ─── Active filters (toggled by the UI buttons) ────────────────
const filters = {
    silence: true,   // Remove silent gaps
    noise:   true,   // Remove low-level constant hiss
    breath:  false,  // Remove breath / mouth sounds
    filler:  false,  // Remove long pauses between sentences
};

// ─── Export format ('webm' | 'mp4') ───────────────────────────
let selectedFormat = 'webm';

// ─────────────────────────────────────────────────────────────
// FORMAT SELECTOR
// ─────────────────────────────────────────────────────────────

/**
 * setFormat
 * Toggles the active export format and updates the UI buttons.
 * @param {'webm'|'mp4'} fmt
 */
function setFormat(fmt) {
    selectedFormat = fmt;

    const webmBtn = document.getElementById('fmt-webm');
    const mp4Btn  = document.getElementById('fmt-mp4');
    const note    = document.getElementById('fmt-note');

    const ACTIVE   = 'format-btn py-3 rounded-xl text-sm font-black border border-emerald-500 bg-emerald-500/15 text-emerald-400 transition-all';
    const INACTIVE = 'format-btn py-3 rounded-xl text-sm font-black border border-white/10 text-slate-400 transition-all hover:border-white/25';

    if (fmt === 'webm') {
        webmBtn.className = ACTIVE;
        mp4Btn.className  = INACTIVE;
        note.textContent  = 'WebM plays in all modern browsers and editors. Fast export, no conversion needed.';
    } else {
        mp4Btn.className  = ACTIVE;
        webmBtn.className = INACTIVE;
        note.textContent  = 'MP4 (H.264/AAC) — universally compatible. FFmpeg.wasm converts in-browser after recording. First use downloads ~10 MB.';
    }
}

// ─────────────────────────────────────────────────────────────
// VIDEO LOAD ENTRY POINT
// ─────────────────────────────────────────────────────────────

/**
 * onVideoLoaded
 * Called by the file input's onchange event. Shows the editor,
 * decodes audio, and triggers the first analysis pass.
 */
async function onVideoLoaded(input) {
    const file = input.files[0];
    if (!file) return;
    videoFile = file;

    // Set video source
    const url = URL.createObjectURL(file);
    const vid = document.getElementById('preview-video');
    vid.src   = url;

    // Swap upload gate → editor
    document.getElementById('upload-gate').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    document.getElementById('export-btn-wrap').classList.remove('hidden');

    // Wait for browser to parse the video header
    await new Promise(r => { vid.onloadedmetadata = r; });
    videoDuration = vid.duration;
    document.getElementById('dur-end').textContent   = fmtTime(videoDuration);
    document.getElementById('dur-start').textContent = '0:00';

    // Keep the playhead in sync with video playback
    vid.ontimeupdate = () => {
        const pct = vid.currentTime / videoDuration;
        document.getElementById('playhead').style.left =
            (pct * 100) + '%';
        document.getElementById('time-badge').textContent =
            `${fmtTime(vid.currentTime)} / ${fmtTime(videoDuration)}`;
    };

    // Decode audio and run first analysis
    document.getElementById('seg-count').textContent = 'Decoding audio…';
    await decodeAudio(file);
    analyzeAndDraw();
}

// ─────────────────────────────────────────────────────────────
// AUDIO DECODING
// ─────────────────────────────────────────────────────────────

/**
 * decodeAudio
 * Reads the video File as an ArrayBuffer and decodes it into
 * a mono AudioBuffer for RMS analysis.
 */
async function decodeAudio(file) {
    const arrayBuf = await file.arrayBuffer();
    const audioCtx = new AudioContext();
    try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
    } finally {
        audioCtx.close();  // Always release the audio context
    }
}

// ─────────────────────────────────────────────────────────────
// SLIDER & FILTER CALLBACKS
// ─────────────────────────────────────────────────────────────

/** onSliderChange — syncs displayed values and retriggers analysis */
function onSliderChange() {
    document.getElementById('sil-val').textContent =
        document.getElementById('sil-slider').value + ' dB';
    document.getElementById('pad-val').textContent =
        parseFloat(document.getElementById('pad-slider').value).toFixed(2) + ' s';
    document.getElementById('kp-val').textContent  =
        parseFloat(document.getElementById('kp-slider').value).toFixed(2) + ' s';
    analyzeAndDraw();
}

/** toggleFilter — flips a filter flag and retriggers analysis */
function toggleFilter(key) {
    filters[key] = !filters[key];
    document.getElementById('btn-' + key).classList.toggle('active', filters[key]);
    analyzeAndDraw();
}

// ─────────────────────────────────────────────────────────────
// CORE ANALYSIS ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * analyzeAndDraw
 * Full analysis pipeline:
 *   1. Compute per-chunk RMS dB (20ms resolution)
 *   2. Build a silence mask based on active filters
 *   3. Merge too-short silent runs back into the keep set
 *   4. Build the final keepSegments array with padding
 *   5. Update stats and re-render visuals
 */
function analyzeAndDraw() {
    if (!audioBuffer) return;

    // ── Read slider values ──
    const silThreshDB   = parseFloat(document.getElementById('sil-slider').value);
    const minSilenceSec = parseFloat(document.getElementById('pad-slider').value);
    const padding       = parseFloat(document.getElementById('kp-slider').value);

    // ── PCM extraction ──
    const sampleRate   = audioBuffer.sampleRate;
    const pcm          = audioBuffer.getChannelData(0);   // use channel 0 (mono)
    const CHUNK_SMPLS  = Math.floor(sampleRate * 0.02);   // samples per 20ms chunk
    const CHUNK_DUR    = 0.02;                             // seconds per chunk
    const numChunks    = Math.floor(pcm.length / CHUNK_SMPLS);

    // ── Step 1: compute RMS dB for each 20ms chunk ──
    const rmsDB = new Float32Array(numChunks);
    for (let c = 0; c < numChunks; c++) {
        let sumSq = 0;
        const off = c * CHUNK_SMPLS;
        for (let s = 0; s < CHUNK_SMPLS; s++) sumSq += pcm[off + s] ** 2;
        const rms  = Math.sqrt(sumSq / CHUNK_SMPLS);
        rmsDB[c]   = rms > 0 ? 20 * Math.log10(rms) : -120;
    }

    // ── Step 2: derive the noise floor (10th percentile RMS) ──
    const sorted     = Float32Array.from(rmsDB).sort();
    const noiseFloor = sorted[Math.floor(sorted.length * 0.1)];

    // ── Step 3: build silence mask (1 = remove this chunk) ──
    const mask = new Uint8Array(numChunks);
    for (let c = 0; c < numChunks; c++) {
        const db  = rmsDB[c];
        let remove = false;

        // Filter: dead silence
        if (filters.silence && db < silThreshDB) remove = true;

        // Filter: background hiss (just above noise floor but still quiet)
        if (filters.noise && !remove) {
            if (db < noiseFloor + 12 && db < silThreshDB + 10) remove = true;
        }

        // Filter: breaths / mouth sounds (slightly louder than silence)
        if (filters.breath && !remove) {
            if (db < silThreshDB + 15) remove = true;
        }

        mask[c] = remove ? 1 : 0;
    }

    // ── Step 4: restore silent runs shorter than minSilenceSec ──
    // (prevents cutting natural micro-pauses between words)
    const minSilChunks = Math.ceil(minSilenceSec / CHUNK_DUR);

    if (filters.silence || filters.noise || filters.breath) {
        let i = 0;
        while (i < numChunks) {
            if (mask[i] === 1) {
                let j = i;
                while (j < numChunks && mask[j] === 1) j++;
                // Keep this silent run if it's shorter than the threshold
                if (j - i < minSilChunks) {
                    for (let k = i; k < j; k++) mask[k] = 0;
                }
                i = j;
            } else {
                i++;
            }
        }
    }

    // ── Step 5: filler filter — mark long gaps between speech bursts ──
    if (filters.filler) {
        const fillerMinChunks = Math.ceil(1.0 / CHUNK_DUR);   // 1-second threshold
        let i = 0;
        while (i < numChunks) {
            if (mask[i] === 0) {
                // Find end of speech burst
                let j = i;
                while (j < numChunks && mask[j] === 0) j++;

                // Find end of following gap
                let k = j;
                while (k < numChunks && mask[k] === 1) k++;

                // Mark the gap as removable if it's long enough
                if (k - j >= fillerMinChunks) {
                    for (let m = j; m < k; m++) mask[m] = 1;
                }
                i = k;
            } else {
                i++;
            }
        }
    }

    // ── Step 6: convert silence mask → keep segments with padding ──
    keepSegments  = [];
    let inKeep    = false;
    let keepStart = 0;

    for (let c = 0; c <= numChunks; c++) {
        const shouldKeep = c < numChunks && mask[c] === 0;

        if (shouldKeep && !inKeep) {
            // Start of a new keep segment (with a small leading pad)
            keepStart = Math.max(0, c * CHUNK_DUR - padding);
            inKeep    = true;
        } else if (!shouldKeep && inKeep) {
            // End of a keep segment (with a small trailing pad)
            const keepEnd = Math.min(videoDuration, (c - 1) * CHUNK_DUR + padding);
            if (keepEnd - keepStart > 0.05) {
                keepSegments.push({ start: keepStart, end: keepEnd });
            }
            inKeep = false;
        }
    }

    // ── Step 7: merge segments separated by < 100ms (avoids micro-cuts) ──
    const merged = [];
    keepSegments.forEach(seg => {
        const prev = merged[merged.length - 1];
        if (prev && seg.start - prev.end < 0.1) {
            prev.end = seg.end;   // extend previous segment
        } else {
            merged.push({ ...seg });
        }
    });
    keepSegments = merged;

    // ── Update stats panel ──
    const keptTime    = keepSegments.reduce((a, s) => a + (s.end - s.start), 0);
    const removedTime = Math.max(0, videoDuration - keptTime);
    const cuts        = Math.max(0, keepSegments.length - 1);

    document.getElementById('stat-removed').textContent  = fmtTime(removedTime);
    document.getElementById('stat-kept').textContent     = fmtTime(keptTime);
    document.getElementById('stat-segments').textContent = cuts;
    document.getElementById('seg-count').textContent     =
        `${cuts} jump cut${cuts !== 1 ? 's' : ''} · ${fmtTime(removedTime)} saved`;

    // ── Render visuals ──
    drawWaveform(rmsDB, mask, silThreshDB);
    drawTimeline();
}

// ─────────────────────────────────────────────────────────────
// WAVEFORM VISUALISER
// ─────────────────────────────────────────────────────────────

/**
 * drawWaveform
 * Renders per-chunk RMS bars onto the waveform canvas.
 * Bars are colour-coded: green = kept, red = removed.
 * A dashed horizontal line marks the silence threshold.
 */
function drawWaveform(rmsDB, mask, silThreshDB) {
    const canvas  = document.getElementById('waveform-canvas');
    const W       = canvas.parentElement.clientWidth;
    const H       = canvas.height;
    canvas.width  = W;
    const ctx     = canvas.getContext('2d');

    ctx.clearRect(0, 0, W, H);

    // Threshold reference line
    const threshY = H - ((silThreshDB + 120) / 120) * H;
    ctx.strokeStyle = 'rgba(239,68,68,0.3)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(W, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Per-chunk bars
    const n    = rmsDB.length;
    const barW = W / n;

    for (let i = 0; i < n; i++) {
        const norm  = Math.max(0, (rmsDB[i] + 120) / 120);
        const barH  = norm * H;
        ctx.fillStyle = mask[i] === 1
            ? 'rgba(239,68,68,0.55)'    // red  = removed
            : 'rgba(16,185,129,0.7)';   // green = kept
        ctx.fillRect(i * barW, H - barH, Math.max(1, barW - 0.5), barH);
    }
}

// ─────────────────────────────────────────────────────────────
// SEGMENT TIMELINE
// ─────────────────────────────────────────────────────────────

/**
 * drawTimeline
 * Renders a proportional segmented bar below the waveform
 * showing the ratio of kept (green) vs removed (red) time.
 */
function drawTimeline() {
    const tl = document.getElementById('segment-timeline');
    tl.innerHTML = '';
    if (videoDuration === 0) return;

    keepSegments.forEach((seg, i) => {
        // Gap before the first segment
        if (i === 0 && seg.start > 0) {
            tl.appendChild(makeBar('seg-remove', seg.start / videoDuration,
                `REMOVED: 0s – ${fmtTime(seg.start)}`));
        }

        // Keep block
        tl.appendChild(makeBar('seg-keep', (seg.end - seg.start) / videoDuration,
            `KEPT: ${fmtTime(seg.start)} – ${fmtTime(seg.end)}`));

        // Gap after this segment (before the next one or end)
        const nextStart = i + 1 < keepSegments.length
            ? keepSegments[i + 1].start
            : videoDuration;

        if (nextStart > seg.end) {
            tl.appendChild(makeBar('seg-remove', (nextStart - seg.end) / videoDuration,
                `REMOVED: ${fmtTime(seg.end)} – ${fmtTime(nextStart)}`));
        }
    });

    // Fallback: all red if nothing is kept
    if (keepSegments.length === 0) {
        tl.appendChild(makeBar('seg-remove', 1, 'REMOVED: all audio below threshold'));
    }
}

/** makeBar — creates a flex timeline segment div */
function makeBar(className, flex, title) {
    const el      = document.createElement('div');
    el.style.flex = flex.toString();
    el.className  = className + ' h-full';
    el.title      = title;
    return el;
}

// ─────────────────────────────────────────────────────────────
// EXPORT ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * startExport
 * Renders the final video by seeking srcVid to each keep segment
 * in sequence and capturing frames via canvas + MediaRecorder.
 * If the user chose MP4, runs FFmpeg.wasm transcoding after recording.
 */
async function startExport() {
    if (keepSegments.length === 0) {
        return alert('No segments to export! Try adjusting your filters.');
    }

    // Show processing overlay
    const overlay = document.getElementById('export-overlay');
    const title   = document.getElementById('exp-title');
    const desc    = document.getElementById('exp-desc');
    const bar     = document.getElementById('exp-bar');

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    title.textContent = 'Preparing Engine…';
    bar.style.width   = '0%';

    // ── Source video element (hidden, used for scrubbing) ──
    const srcVid  = document.createElement('video');
    srcVid.src    = URL.createObjectURL(videoFile);
    srcVid.muted  = false;
    document.body.appendChild(srcVid);
    await new Promise(r => { srcVid.onloadedmetadata = r; });

    // ── Canvas for frame composition ──
    const canvas  = document.createElement('canvas');
    canvas.width  = srcVid.videoWidth  || 1280;
    canvas.height = srcVid.videoHeight || 720;
    const ctx     = canvas.getContext('2d');

    // ── Audio routing ──
    const audioCtx = new AudioContext();
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
        videoBitsPerSecond: 6_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    // ── onstop: optionally convert to MP4, then show result ──
    recorder.onstop = async () => {
        const webmBlob = new Blob(chunks, { type: 'video/webm' });

        let finalBlob = webmBlob;
        let finalExt  = 'webm';

        // ── Optional MP4 conversion via FFmpeg.wasm ──
        if (selectedFormat === 'mp4') {
            title.textContent = 'Converting to MP4…';
            desc.textContent  = 'Loading FFmpeg.wasm engine (one-time ~10 MB download)';
            bar.style.width   = '95%';
            overlay.classList.remove('hidden');
            overlay.classList.add('flex');

            try {
                const { createFFmpeg, fetchFile } = FFmpeg;
                const ffmpeg = createFFmpeg({
                    log: false,
                    progress: ({ ratio }) => {
                        bar.style.width   = (95 + ratio * 4).toFixed(1) + '%';
                        desc.textContent  = `Converting… ${Math.round(ratio * 100)}%`;
                    },
                });

                await ffmpeg.load();
                desc.textContent = 'Transcoding VP9 → H.264…';

                ffmpeg.FS('writeFile', 'input.webm', await fetchFile(webmBlob));
                await ffmpeg.run(
                    '-i',         'input.webm',
                    '-c:v',       'libx264',
                    '-preset',    'ultrafast',
                    '-crf',       '23',
                    '-c:a',       'aac',
                    '-b:a',       '128k',
                    '-movflags',  '+faststart',
                    'output.mp4'
                );

                const data = ffmpeg.FS('readFile', 'output.mp4');
                finalBlob  = new Blob([data.buffer], { type: 'video/mp4' });
                finalExt   = 'mp4';

                ffmpeg.FS('unlink', 'input.webm');
                ffmpeg.FS('unlink', 'output.mp4');

            } catch (ffErr) {
                console.error('FFmpeg conversion failed:', ffErr);
                desc.textContent = 'MP4 conversion failed — falling back to WebM.';
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        // ── Cleanup ──
        document.body.removeChild(srcVid);
        audioCtx.close();

        const url = URL.createObjectURL(finalBlob);

        overlay.classList.add('hidden');
        overlay.classList.remove('flex');

        // Populate result overlay
        document.getElementById('result-video').src = url;
        const dl     = document.getElementById('dl-link');
        dl.href      = url;
        dl.download  = `clean_${videoFile.name.replace(/\.[^.]+$/, '') || 'video'}.${finalExt}`;
        document.getElementById('dl-label').textContent = `Download ${finalExt.toUpperCase()}`;

        const keptTime = keepSegments.reduce((a, s) => a + (s.end - s.start), 0);
        document.getElementById('result-meta').textContent =
            `${fmtTime(keptTime)} clean output · ${keepSegments.length} segment${keepSegments.length !== 1 ? 's' : ''} · ${Math.round(finalBlob.size / 1024)} KB · ${finalExt.toUpperCase()}`;

        document.getElementById('result-overlay').classList.remove('hidden');
        document.getElementById('result-overlay').classList.add('flex');
    };

    recorder.start();
    bar.style.width = '5%';

    // ── Render each keep segment frame-by-frame ──
    for (let i = 0; i < keepSegments.length; i++) {
        const seg = keepSegments[i];

        title.textContent = 'Rendering Jump Cuts…';
        desc.textContent  =
            `Segment ${i + 1} of ${keepSegments.length}  (${fmtTime(seg.start)} → ${fmtTime(seg.end)})`;

        // Seek to segment start
        srcVid.currentTime = seg.start;
        await new Promise(r => { srcVid.onseeked = r; });
        await srcVid.play();

        // Capture frames until segment end
        while (srcVid.currentTime < seg.end && !srcVid.ended) {
            ctx.drawImage(srcVid, 0, 0, canvas.width, canvas.height);

            const segProgress = (srcVid.currentTime - seg.start) / (seg.end - seg.start);
            const totalPct    = (i + segProgress) / keepSegments.length;
            bar.style.width   = (5 + totalPct * 90).toFixed(1) + '%';

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

/** fmtTime — converts seconds to "M:SS" display string */
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// Re-draw the waveform on window resize
window.addEventListener('resize', () => {
    if (audioBuffer) analyzeAndDraw();
});
