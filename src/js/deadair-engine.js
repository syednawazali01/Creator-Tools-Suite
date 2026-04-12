// ============================================================
// DEAD-AIR DESTROYER — Engine v1.0
// ============================================================
// Architecture:
//   1. Decode video audio via OfflineAudioContext
//   2. Scan per-chunk RMS to map silence/noise regions
//   3. Build keep-segment array respecting all active filters
//   4. Render waveform + segment timeline on canvas
//   5. Export via real-time MediaRecorder, jump-cutting currentTime
// ============================================================

// ─── Global State ───────────────────────────────────────────
let audioBuffer   = null;   // decoded PCM data
let videoDuration = 0;
let videoFile     = null;
let keepSegments  = [];     // [{start, end}]
let animFrame     = null;

const filters = {
    silence : true,
    noise   : true,
    breath  : false,
    filler  : false,
};

// ─── Entry Point ─────────────────────────────────────────────
async function onVideoLoaded(input) {
    const file = input.files[0];
    if (!file) return;
    videoFile = file;

    const url = URL.createObjectURL(file);
    const vid  = document.getElementById('preview-video');
    vid.src    = url;

    // Show editor
    document.getElementById('upload-gate').classList.add('hidden');
    document.getElementById('editor').classList.remove('hidden');
    document.getElementById('export-btn-wrap').classList.remove('hidden');

    // Wait for metadata
    await new Promise(r => { vid.onloadedmetadata = r; });
    videoDuration = vid.duration;
    document.getElementById('dur-end').textContent = fmtTime(videoDuration);
    document.getElementById('dur-start').textContent = '0:00';

    // Playhead sync
    vid.ontimeupdate = () => {
        const pct = vid.currentTime / videoDuration;
        document.getElementById('playhead').style.left = (pct * 100) + '%';
        document.getElementById('time-badge').textContent =
            fmtTime(vid.currentTime) + ' / ' + fmtTime(videoDuration);
    };

    // Decode audio
    document.getElementById('seg-count').textContent = 'Decoding audio…';
    await decodeAudio(file);
    analyzeAndDraw();
}

// ─── Audio Decoding ──────────────────────────────────────────
async function decodeAudio(file) {
    const arrayBuf  = await file.arrayBuffer();
    const offCtx    = new OfflineAudioContext(1, 1, 44100);  // dummy for decoding support
    const audioCtx  = new AudioContext();
    audioBuffer     = await audioCtx.decodeAudioData(arrayBuf);
    audioCtx.close();
}

// ─── Slider / Filter callbacks ───────────────────────────────
function onSliderChange() {
    document.getElementById('sil-val').textContent = document.getElementById('sil-slider').value + ' dB';
    document.getElementById('pad-val').textContent = parseFloat(document.getElementById('pad-slider').value).toFixed(2) + ' s';
    document.getElementById('kp-val').textContent  = parseFloat(document.getElementById('kp-slider').value).toFixed(2) + ' s';
    analyzeAndDraw();
}

function toggleFilter(key) {
    filters[key] = !filters[key];
    const btn = document.getElementById('btn-' + key);
    btn.classList.toggle('active', filters[key]);
    analyzeAndDraw();
}

// ─── Core Analysis ────────────────────────────────────────────
function analyzeAndDraw() {
    if (!audioBuffer) return;

    const silThreshDB   = parseFloat(document.getElementById('sil-slider').value);
    const minSilenceSec = parseFloat(document.getElementById('pad-slider').value);
    const padding       = parseFloat(document.getElementById('kp-slider').value);

    const sampleRate    = audioBuffer.sampleRate;
    const pcm           = audioBuffer.getChannelData(0);       // mono view
    const totalSamples  = pcm.length;
    const chunkSamples  = Math.floor(sampleRate * 0.02);       // 20 ms chunks

    // ── Compute per-chunk RMS dB ──
    const numChunks     = Math.floor(totalSamples / chunkSamples);
    const rmsDB         = new Float32Array(numChunks);

    for (let c = 0; c < numChunks; c++) {
        let sum = 0;
        const off = c * chunkSamples;
        for (let s = 0; s < chunkSamples; s++) sum += pcm[off + s] ** 2;
        const rms = Math.sqrt(sum / chunkSamples);
        rmsDB[c]  = rms > 0 ? 20 * Math.log10(rms) : -120;
    }

    // ── Compute noise floor for noise/breath filters ──
    const sorted    = Float32Array.from(rmsDB).sort();
    const noiseFloor = sorted[Math.floor(sorted.length * 0.1)]; // 10th percentile

    // ── Build silence mask ──
    const chunkDur    = 0.02;
    const silenceMask = new Uint8Array(numChunks); // 1 = remove

    for (let c = 0; c < numChunks; c++) {
        const db = rmsDB[c];

        let remove = false;

        // Dead silence
        if (filters.silence && db < silThreshDB) remove = true;

        // Background hiss: just above noise floor but below a gentle threshold
        if (filters.noise && !remove) {
            const noiseThresh = noiseFloor + 12; // 12 dB above noise floor
            if (db < noiseThresh && db < (silThreshDB + 10)) remove = true;
        }

        // Breaths: slightly louder transients, typically < silThresh + 15
        if (filters.breath && !remove) {
            if (db < silThreshDB + 15) remove = true;
        }

        // Long pauses (filler): silence > 1s
        // handled via run-length later

        silenceMask[c] = remove ? 1 : 0;
    }

    // ── Merge short sequences (run-length based) ──
    // First pass: fill gaps shorter than minSilence
    const minSilChunks = Math.ceil(minSilenceSec / chunkDur);

    if (filters.silence || filters.noise || filters.breath) {
        let i = 0;
        while (i < numChunks) {
            if (silenceMask[i] === 1) {
                // Count run
                let j = i;
                while (j < numChunks && silenceMask[j] === 1) j++;
                const runLen = j - i;
                if (runLen < minSilChunks) {
                    // Too short to cut — restore
                    for (let k = i; k < j; k++) silenceMask[k] = 0;
                }
                i = j;
            } else {
                i++;
            }
        }
    }

    // Filler filter: remove pauses > 1s between speech bursts
    if (filters.filler) {
        const fillerMin = Math.ceil(1.0 / chunkDur);
        let i = 0;
        while (i < numChunks) {
            if (silenceMask[i] === 0) {
                let j = i;
                while (j < numChunks && silenceMask[j] === 0) j++;
                // gap ends at j — look further for another speech burst
                let k = j;
                while (k < numChunks && silenceMask[k] === 1) k++;
                const gapLen = k - j;
                if (gapLen >= fillerMin) {
                    // Mark as removable
                    for (let m = j; m < k; m++) silenceMask[m] = 1;
                }
                i = k;
            } else {
                i++;
            }
        }
    }

    // ── Build keep segments ──
    keepSegments = [];
    let inKeep   = false;
    let keepStart = 0;
    const pad    = padding;

    for (let c = 0; c <= numChunks; c++) {
        const keep = c < numChunks && silenceMask[c] === 0;
        if (keep && !inKeep) {
            keepStart = Math.max(0, c * chunkDur - pad);
            inKeep    = true;
        } else if (!keep && inKeep) {
            const keepEnd = Math.min(videoDuration, (c - 1) * chunkDur + pad);
            if (keepEnd - keepStart > 0.05) {
                keepSegments.push({ start: keepStart, end: keepEnd });
            }
            inKeep = false;
        }
    }

    // Merge very close segments (< 0.1s gap)
    const merged = [];
    keepSegments.forEach(seg => {
        if (merged.length > 0 && seg.start - merged[merged.length-1].end < 0.1) {
            merged[merged.length-1].end = seg.end;
        } else {
            merged.push({ ...seg });
        }
    });
    keepSegments = merged;

    // ── Update stats ──
    const keptTime    = keepSegments.reduce((a, s) => a + (s.end - s.start), 0);
    const removedTime = videoDuration - keptTime;
    const cuts        = Math.max(0, keepSegments.length - 1);

    document.getElementById('stat-removed').textContent  = fmtTime(Math.max(0, removedTime));
    document.getElementById('stat-kept').textContent     = fmtTime(keptTime);
    document.getElementById('stat-segments').textContent = cuts;
    document.getElementById('seg-count').textContent     = `${cuts} jump cut${cuts !== 1 ? 's' : ''} · ${fmtTime(removedTime)} saved`;

    // ── Render Visuals ──
    drawWaveform(rmsDB, silenceMask, silThreshDB);
    drawTimeline();
}

// ─── Waveform Renderer ────────────────────────────────────────
function drawWaveform(rmsDB, silenceMask, silThreshDB) {
    const canvas = document.getElementById('waveform-canvas');
    const W      = canvas.parentElement.clientWidth;
    const H      = canvas.height;
    canvas.width = W;
    const ctx    = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const n     = rmsDB.length;
    const barW  = W / n;

    // Draw threshold line
    const threshY = H - ((silThreshDB + 120) / 120) * H;
    ctx.strokeStyle = 'rgba(239,68,68,0.3)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(W, threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let i = 0; i < n; i++) {
        const db     = rmsDB[i];
        const norm   = Math.max(0, (db + 120) / 120);
        const barH   = norm * H;
        const x      = i * barW;
        const remove = silenceMask[i] === 1;

        const color  = remove
            ? 'rgba(239,68,68,0.55)'
            : 'rgba(16,185,129,0.7)';
        ctx.fillStyle = color;
        ctx.fillRect(x, H - barH, Math.max(1, barW - 0.5), barH);
    }
}

// ─── Timeline Renderer ────────────────────────────────────────
function drawTimeline() {
    const tl    = document.getElementById('segment-timeline');
    tl.innerHTML = '';
    if (videoDuration === 0) return;

    keepSegments.forEach((seg, i) => {
        // Gap before (removed)
        if (i === 0 && seg.start > 0) {
            const el = document.createElement('div');
            el.style.flex = (seg.start / videoDuration).toString();
            el.className  = 'seg-remove h-full';
            el.title      = 'REMOVED: 0s – ' + fmtTime(seg.start);
            tl.appendChild(el);
        }
        // Keep
        const kept = document.createElement('div');
        kept.style.flex = ((seg.end - seg.start) / videoDuration).toString();
        kept.className  = 'seg-keep h-full';
        kept.title      = `KEPT: ${fmtTime(seg.start)} – ${fmtTime(seg.end)}`;
        tl.appendChild(kept);

        // Gap after
        const nextStart = i + 1 < keepSegments.length ? keepSegments[i+1].start : videoDuration;
        if (nextStart > seg.end) {
            const el = document.createElement('div');
            el.style.flex = ((nextStart - seg.end) / videoDuration).toString();
            el.className  = 'seg-remove h-full';
            el.title      = `REMOVED: ${fmtTime(seg.end)} – ${fmtTime(nextStart)}`;
            tl.appendChild(el);
        }
    });

    if (keepSegments.length === 0) {
        const el      = document.createElement('div');
        el.style.flex = '1';
        el.className  = 'seg-remove h-full';
        tl.appendChild(el);
    }
}

// ─── Export Engine ────────────────────────────────────────────
async function startExport() {
    if (keepSegments.length === 0) return alert('No segments to export! Adjust your filters.');

    const overlay = document.getElementById('export-overlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');

    const title   = document.getElementById('exp-title');
    const desc    = document.getElementById('exp-desc');
    const bar     = document.getElementById('exp-bar');

    title.textContent = 'Preparing Engine…';
    bar.style.width   = '0%';

    // Build a hidden video element for frame-accurate scrubbing
    const srcVid  = document.createElement('video');
    srcVid.src    = URL.createObjectURL(videoFile);
    srcVid.muted  = false;
    document.body.appendChild(srcVid);

    await new Promise(r => { srcVid.onloadedmetadata = r; });

    // Canvas + audio for recording
    const canvas  = document.createElement('canvas');
    canvas.width  = srcVid.videoWidth  || 1280;
    canvas.height = srcVid.videoHeight || 720;
    const ctx     = canvas.getContext('2d');

    const audioCtx = new AudioContext();
    const dest     = audioCtx.createMediaStreamDestination();
    const srcNode  = audioCtx.createMediaElementSource(srcVid);
    srcNode.connect(dest);
    srcNode.connect(audioCtx.destination);

    const stream   = new MediaStream([
        canvas.captureStream(30).getVideoTracks()[0],
        dest.stream.getAudioTracks()[0]
    ]);

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 6_000_000 });
    const chunks   = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = () => {
        document.body.removeChild(srcVid);
        audioCtx.close();

        const blob = new Blob(chunks, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);

        overlay.classList.add('hidden');
        overlay.classList.remove('flex');

        const resultVid = document.getElementById('result-video');
        resultVid.src = url;

        const dl = document.getElementById('dl-link');
        dl.href  = url;
        dl.download = 'clean_' + (videoFile.name.replace(/\.[^.]+$/, '') || 'video') + '.webm';

        const keptTime = keepSegments.reduce((a, s) => a + (s.end - s.start), 0);
        document.getElementById('result-meta').textContent =
            `${fmtTime(keptTime)} clean output · ${keepSegments.length} segment${keepSegments.length !== 1 ? 's' : ''} · ${Math.round(blob.size / 1024)} KB`;

        document.getElementById('result-overlay').classList.remove('hidden');
        document.getElementById('result-overlay').classList.add('flex');
    };

    recorder.start();
    bar.style.width = '5%';

    // ── Render each keep segment ──
    let rendered = 0;
    for (const seg of keepSegments) {
        title.textContent = `Rendering Jump Cuts…`;
        desc.textContent  = `Segment ${rendered + 1} of ${keepSegments.length}  (${fmtTime(seg.start)} → ${fmtTime(seg.end)})`;

        srcVid.currentTime = seg.start;
        await new Promise(r => { srcVid.onseeked = r; });
        await srcVid.play();

        // Draw frames until this segment ends
        while (srcVid.currentTime < seg.end && !srcVid.ended) {
            ctx.drawImage(srcVid, 0, 0, canvas.width, canvas.height);
            const progress = rendered / keepSegments.length + ((srcVid.currentTime - seg.start) / (seg.end - seg.start)) / keepSegments.length;
            bar.style.width = (5 + progress * 92).toFixed(1) + '%';
            await new Promise(r => requestAnimationFrame(r));
        }
        srcVid.pause();
        rendered++;
    }

    bar.style.width = '100%';
    await new Promise(r => setTimeout(r, 200));
    recorder.stop();
}

// ─── Helpers ─────────────────────────────────────────────────
function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// Redraw waveform on window resize
window.addEventListener('resize', () => {
    if (audioBuffer) analyzeAndDraw();
});
