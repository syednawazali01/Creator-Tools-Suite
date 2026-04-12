// ==========================================
// STATE STORAGE
// ==========================================
let slots = {};
let slotIndexCounter = 0;

// ==========================================
// UI INTERACTIONS
// ==========================================

/**
 * Links the uploaded video file to the specific slot and generates a small preview thumbnail.
 */
function handleFileUpload(index, input) {
    const file = input.files[0];
    slots[index].file = file;
    const previewEl = document.getElementById('preview-' + index);
    const thumbContainer = document.getElementById('thumb-container-' + index);

    if (file) {
        previewEl.src = URL.createObjectURL(file);
        thumbContainer.classList.remove('hidden');
    } else {
        previewEl.src = "";
        thumbContainer.classList.add('hidden');
    }
}

/**
 * Dynamically appends a new ranking slot to the DOM and links it to internal storage.
 */
function addSlot(appendAtBottom = false) {
    const i = slotIndexCounter++;
    slots[i] = { file: null, label: '' };
    const list = document.getElementById('slots-list');
    
    const div = document.createElement('div');
    div.className = "slot-item glass p-4 mt-3 rounded-xl flex gap-3 relative cursor-grab active:cursor-grabbing hover:bg-slate-800/80 transition-colors";
    div.dataset.origIndex = i;
    div.innerHTML = `
        <div onclick="removeSlot(this)" class="absolute -right-2 -top-2 bg-red-600 hover:bg-red-500 rounded-full w-5 h-5 flex items-center justify-center text-white shadow-lg text-[10px] font-black pointer-events-auto cursor-pointer z-10 transition-colors">X</div>
        <div class="rank-badge absolute -top-3 -left-2 text-[9px] font-black px-2 py-1 rounded shadow-lg tracking-widest transform transition-all"></div>
        
        <div class="flex flex-col items-center self-center gap-1 w-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-500"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            <div class="rank-number text-xl font-black italic text-slate-500 text-center"></div>
        </div>

        <div class="flex-1 mt-1 space-y-2 self-center">
            <input type="file" accept="video/*" onchange="handleFileUpload(${i}, this)" class="text-[10px] block w-full text-slate-300 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[10px] file:font-bold file:bg-slate-700 file:text-emerald-400 transition-colors hover:file:bg-slate-600 cursor-pointer">
            <input type="text" placeholder="Reveal text" oninput="slots[${i}].label = this.value" class="rank-label-input font-bold bg-black/30 w-full px-3 py-2 rounded-md outline-none focus:ring-1 focus:ring-emerald-500 transition-all text-sm">
        </div>
        <div id="thumb-container-${i}" class="w-16 h-16 mt-1 hidden shrink-0 rounded-lg overflow-hidden border-2 border-slate-700 bg-black/50 ml-1 hover:border-emerald-500 transition-colors">
            <video id="preview-${i}" class="w-full h-full object-cover pointer-events-none" muted loop playsinline onmouseover="this.play()" onmouseout="this.pause()"></video>
        </div>
    `;
    
    if (appendAtBottom) {
        list.appendChild(div);
    } else {
        list.insertBefore(div, list.firstChild);
    }
    updateRankLabels();
}

function removeSlot(btn) {
    btn.closest('.slot-item').remove();
    updateRankLabels();
}

function init() {
    const list = document.getElementById('slots-list');
    for (let k = 0; k < 5; k++) {
        addSlot(true);
    }

    // Init drag and drop sorting
    new Sortable(list, {
        animation: 150,
        ghostClass: 'opacity-50',
        onEnd: updateRankLabels
    });
}

function updateRankLabels() {
    const domSlots = Array.from(document.querySelectorAll('.slot-item'));
    const total = domSlots.length;
    
    domSlots.forEach((el, index) => {
        const newRank = total - index; 
        const badgeEl = el.querySelector('.rank-badge');
        const numEl = el.querySelector('.rank-number');
        const inputEl = el.querySelector('.rank-label-input');
        
        let badgeText = `RANK ${newRank}`;
        badgeEl.classList.remove('bg-slate-600', 'bg-emerald-600', 'bg-yellow-500', 'text-black', 'scale-105', 'text-white');

        if (newRank === total && total > 1) { 
            badgeEl.classList.add('bg-emerald-600', 'text-white', 'scale-105');
            badgeText = `RANK ${newRank} (PLAYS FIRST)`; 
        } else if (newRank === 1) { 
            badgeEl.classList.add('bg-yellow-500', 'text-black', 'scale-105');
            badgeText = "RANK 1 (THE WINNER!)"; 
        } else {
            badgeEl.classList.add('bg-slate-600', 'text-white');
        }

        badgeEl.textContent = badgeText;
        numEl.textContent = `#${newRank}`;
        inputEl.placeholder = `Reveal text for Rank ${newRank}`;
    });
}

// ==========================================
// CORE RENDERING ENGINE
// ==========================================

async function generateVideo() {
    // Build orderedSlots based on current DOM to respect player's drag/drop sorting
    const domItems = Array.from(document.querySelectorAll('.slot-item'));
    const total = domItems.length;
    const orderedSlots = []; // will populate from Rank 1 up to Rank N locally
    
    for (let i = total - 1; i >= 0; i--) {
        const el = domItems[i];
        const origIndex = el.dataset.origIndex; 
        const rank = total - i;
        orderedSlots.push({ ...slots[origIndex], id: rank });
    }

    const valid = orderedSlots.filter(s => s.file);
    if (valid.length < 1) return alert("Please upload at least one video!");

    document.getElementById('loader').classList.remove('hidden');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const cw = 720, ch = 1280;
    canvas.width = cw; canvas.height = ch;

    // Audio Setup (To keep video sound)
    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();

    // Recorder Setup
    const stream = new MediaStream([canvas.captureStream(30).getTracks()[0], dest.stream.getTracks()[0]]);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 8000000 });
    const chunks = [];

    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        document.getElementById('final-video').src = url;
        document.getElementById('dl-link').href = url;
        document.getElementById('dl-link').download = "ranking_final.webm";
        document.getElementById('loader').classList.add('hidden');
        document.getElementById('result-modal').classList.remove('hidden');
    };

    recorder.start();

    const drawOverlays = (currentRank) => {
        // TITLE SECTION
        ctx.textAlign = 'center';
        ctx.font = "900 65px 'Outfit'";
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#000';
        ctx.lineJoin = 'round';

        const drawText = (t, x, y, color) => {
            ctx.strokeText(t, x, y);
            ctx.fillStyle = color;
            ctx.fillText(t, x, y);
        };

        const t1 = document.getElementById('t1').value;
        const t2 = document.getElementById('t2').value;
        const w1 = ctx.measureText(t1 + " ").width;
        const w2 = ctx.measureText(t2).width;
        const startX1 = (cw - (w1 + w2)) / 2;
        drawText(t1 + " ", startX1 + w1 / 2, 120, '#FFF');
        drawText(t2, startX1 + w1 + w2 / 2, 120, '#eab308');

        const t3 = document.getElementById('t3').value;
        const t4 = document.getElementById('t4').value;
        ctx.font = "900 60px 'Outfit'";
        const w3 = ctx.measureText(t3 + " ").width;
        const w4 = ctx.measureText(t4).width;
        const startX2 = (cw - (w3 + w4)) / 2;
        drawText(t3 + " ", startX2 + w3 / 2, 200, '#10b981'); // Emerald
        drawText(t4, startX2 + w3 + w4 / 2, 200, '#FFF');

        // RANKING LIST SECTION
        ctx.textAlign = 'left';
        const colors = ['#eab308', '#10b981', '#ef4444', '#FFF', '#FFF']; 

        orderedSlots.forEach((s, i) => {
            const y = 320 + (i * 80);
            ctx.font = "900 55px 'Outfit'";
            const color = colors[i] || '#FFF';
            drawText(`${s.id}.`, 50, y, color);

            // Show label if it matches the current rank or was higher
            if (s.id >= currentRank && s.label) {
                ctx.font = "900 35px 'Outfit'";
                drawText(s.label.toUpperCase(), 120, y, '#FFF');
            }
        });
    };

    const reversedValid = [...valid].reverse(); // Play bottom to top

    for (let i = 0; i < reversedValid.length; i++) {
        const clip = reversedValid[i];
        const video = document.createElement('video');
        video.src = URL.createObjectURL(clip.file);
        video.muted = false; // We need the sound for the output

        // Link video audio to recorder
        await new Promise(resolve => {
            video.onloadedmetadata = () => {
                const source = audioCtx.createMediaElementSource(video);
                source.connect(dest);
                source.connect(audioCtx.destination);
                resolve();
            };
        });

        await video.play();

        // Draw each frame of the video until it naturally ends
        while (!video.ended) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, cw, ch);

            // Scale video to fill background (Shorts style)
            const vAspect = video.videoWidth / video.videoHeight;
            let vw = cw, vh = cw / vAspect;
            if (vh < ch) { vh = ch; vw = ch * vAspect; }
            ctx.drawImage(video, (cw - vw) / 2, (ch - vh) / 2, vw, vh);

            drawOverlays(clip.id);

            document.getElementById('progress-bar').style.width = `${((i) / reversedValid.length) * 100}%`;
            await new Promise(r => requestAnimationFrame(r));
        }

        video.pause();
        URL.revokeObjectURL(video.src);
    }

    recorder.stop();
}

init();
