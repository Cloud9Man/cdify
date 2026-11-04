(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const canvas = $('#artwork');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const guidesCanvas = $('#guides');
  const guides = guidesCanvas.getContext('2d');
  const queueCanvas = $('#queuePreview');
  const queueCtx = queueCanvas.getContext('2d');
  const shell = $('#previewShell');
  const state = { template: 'front', imageBlob: null, zoom: 1, rotation: 0, brightness: 1, contrast: 1, saturation: 1, text: '', textColor: '#ffffff', tx: 0, ty: 0, layers: [], selectedId: null, guidelines: true, grid: false, printQueue: [] };
  let sourceImage = null;
  const layerImages = new Map();
  let saveTimer;
  let drag = null;
  const DPI = 300;
  const mmPx = (mm) => Math.round(mm / 25.4 * DPI);
  const templates = {
    front: { w: 120, h: 120, title: 'Priekšējais vāks · viena lapa', note: 'Vienas priekšējās vāka lapas sagatave. Pēc izdrukas apgriez līdz 120 × 120 mm.' },
    frontBooklet: { w: 242, h: 120, title: 'Priekšējais vāks · salocīta lapa', note: 'Atvērta vienas lapas sagatave 242 × 120 mm; pēc salocīšanas abas puses veido aptuveni 120 × 120 mm vāku. Punktotā viduslīnija norāda locījumu.' },
    tray: { w: 151, h: 118, title: 'Aizmugures ieliktnis · tray card', note: 'Aizmugures ieliktnis ar divām 6,5 mm muguriņām. Kopējais izmērs 151 × 118 mm; vidējais laukums ir 138 mm.' },
    backBooklet: { w: 240, h: 120, title: 'Aizmugures bukleta izklājums', note: 'Divas 120 × 120 mm lapas vienā izklājumā. Šī ir bukleta loksnes sagatave, nevis tray card.' },
    disc: { w: 120, h: 120, title: 'CD etiķete · Epson XP-7100', note: 'PNG ir caurspīdīgs ārpus 120 mm diska un 18 mm centra cauruma. Ielādē to Epson Print CD un pārbaudi printera izmēru iestatījumus; atkarībā no paša diska iekšējo diametru var palielināt līdz 46 mm.' },
  };
  const dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('cdify-cover-editor', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('projects');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  async function localSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const db = await dbPromise;
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ ...state }, 'active');
        tx.oncomplete = () => { $('#saveStatus').textContent = 'Saglabāts šajā ierīcē · ' + new Date().toLocaleTimeString('lv-LV', { hour: '2-digit', minute: '2-digit' }); };
        tx.onerror = () => { $('#saveStatus').textContent = 'Neizdevās saglabāt. Pārbaudi pārlūka vietējo krātuvi.'; };
      } catch { $('#saveStatus').textContent = 'Vietējā saglabāšana nav pieejama šajā pārlūkā.'; }
    }, 350);
  }
  async function loadProject() {
    try {
      const db = await dbPromise;
      const tx = db.transaction('projects', 'readonly');
      const req = tx.objectStore('projects').get('active');
      req.onsuccess = () => {
        if (!req.result) return;
        Object.assign(state, req.result);
        if (!Array.isArray(state.layers)) state.layers = [];
        if (!Array.isArray(state.printQueue)) state.printQueue = [];
        $('#template').value = templates[state.template] ? state.template : 'front';
        $('#zoom').value = Math.round(state.zoom * 100); $('#rotation').value = state.rotation;
        $('#brightness').value = Math.round(state.brightness * 100); $('#contrast').value = Math.round(state.contrast * 100); $('#saturation').value = Math.round(state.saturation * 100);
        $('#toggleGuides').checked = state.guidelines !== false; $('#toggleGrid').checked = Boolean(state.grid);
        if (state.imageBlob) setImage(state.imageBlob, false);
        state.layers.forEach((layer) => { if (layer.type === 'image' && layer.blob) createImageBitmap(layer.blob).then((bitmap) => { layerImages.set(layer.id, bitmap); render(); }).catch(() => {}); });
        syncLayerPanel(); syncPrintQueue(); render(); calculateQueue();
      };
    } catch { render(); }
  }
  function setImage(blob, save = true) {
    state.imageBlob = blob;
    if (sourceImage?.close) sourceImage.close();
    createImageBitmap(blob).then((image) => { sourceImage = image; $('#emptyHint').hidden = true; render(); if (save) localSave(); }).catch(() => { $('#saveStatus').textContent = 'Šo attēlu neizdevās atvērt.'; });
  }
  const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  function layerName(layer, index) {
    if (layer.name) return layer.name;
    const names = { image: 'Attēls', text: 'Tekstlodziņš', rect: 'Taisnstūris', circle: 'Aplis', line: 'Līnija' };
    return `${names[layer.type] || 'Objekts'} ${index + 1}`;
  }
  function addLayer(layer) {
    state.layers.push({ id: makeId(), x: .5, y: .5, w: .38, h: .25, rotation: 0, opacity: 1, color: '#ee6253', ...layer });
    state.selectedId = state.layers.at(-1).id;
    syncLayerPanel(); render(); localSave();
  }
  function syncLayerPanel() {
    const list = $('#layerList'); list.replaceChildren();
    $('#layerCount').textContent = `${state.layers.length} ${state.layers.length === 1 ? 'objekts' : 'objekti'}`;
    if (!state.layers.length) { const hint = document.createElement('p'); hint.className = 'control-hint'; hint.textContent = 'Pievieno attēlu, tekstu vai formu.'; list.append(hint); }
    state.layers.forEach((layer, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = `layer-item${layer.id === state.selectedId ? ' is-selected' : ''}`;
      button.textContent = layerName(layer, index); button.title = 'Atlasīt slāni';
      button.addEventListener('click', () => { state.selectedId = layer.id; syncLayerPanel(); render(); }); list.append(button);
    });
    const selected = state.layers.find((layer) => layer.id === state.selectedId);
    $('#selectedObject').hidden = !selected;
    if (!selected) return;
    $('#selectedType').textContent = layerName(selected, state.layers.indexOf(selected));
    $('#textField').hidden = selected.type !== 'text'; $('#colorField').hidden = !['text','rect','circle','line'].includes(selected.type);
    $('#fontSizeField').hidden = selected.type !== 'text';
    $('#objectText').value = selected.text || ''; $('#objectColor').value = selected.color || '#ee6253';
    $('#objectWidth').value = Math.min(200, Math.max(5, Math.round(selected.w * 100))); $('#objectHeight').value = Math.min(200, Math.max(1, Math.round(selected.h * 100)));
    $('#objectRotation').value = selected.rotation || 0; $('#objectOpacity').value = Math.round((selected.opacity ?? 1) * 100);
    $('#fontSize').value = Math.round((selected.fontSize || .06) * 100);
    $('#objectWidthOut').textContent = `${Math.round(selected.w * 100)}%`; $('#objectHeightOut').textContent = `${Math.round(selected.h * 100)}%`;
    $('#objectRotationOut').textContent = `${Math.round(selected.rotation || 0)}°`; $('#objectOpacityOut').textContent = `${Math.round((selected.opacity ?? 1) * 100)}%`;
    $('#fontSizeOut').textContent = `${Math.round((selected.fontSize || .06) * 100)}%`;
  }
  function syncPrintQueue() {
    const list = $('#queueList'); list.replaceChildren();
    const totalCopies = state.printQueue.reduce((sum, item) => sum + Math.max(1, Number(item.copies) || 1), 0);
    $('#queueCount').textContent = `${totalCopies} ${totalCopies === 1 ? 'attēls' : 'attēli'}`;
    if (!state.printQueue.length) { const hint = document.createElement('p'); hint.className = 'control-hint'; hint.textContent = 'Pievieno attēlus vai pašreizējo dizainu drukas rindai.'; list.append(hint); }
    state.printQueue.forEach((item) => {
      const row = document.createElement('div'); row.className = 'queue-item';
      const title = document.createElement('span'); title.className = 'queue-item-title'; title.textContent = item.name || 'Attēls';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'queue-item-remove'; remove.textContent = 'Noņemt';
      remove.addEventListener('click', () => { state.printQueue = state.printQueue.filter((entry) => entry.id !== item.id); syncPrintQueue(); calculateQueue(); localSave(); });
      const fields = document.createElement('div'); fields.className = 'queue-item-fields';
      const addNumber = (label, key, min, max, step) => {
        const wrap = document.createElement('label'); wrap.append(document.createTextNode(label));
        const totalCopies = state.printQueue.reduce((sum, entry) => sum + Math.max(1, Number(entry.copies) || 1), 0);
        const effectiveMax = key === 'copies' ? Math.max(1, Math.min(max, 300 - (totalCopies - Math.max(1, Number(item.copies) || 1)))) : max;
        const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(effectiveMax); input.step = String(step); input.value = String(item[key]);
        input.addEventListener('change', () => { item[key] = Math.max(min, Math.min(effectiveMax, Number(input.value) || min)); input.value = String(item[key]); if (key === 'copies') syncPrintQueue(); calculateQueue(); localSave(); });
        wrap.append(input); fields.append(wrap);
      };
      addNumber('Platums mm', 'widthMm', 10, 290, .5); addNumber('Augstums mm', 'heightMm', 10, 200, .5); addNumber('Kopijas', 'copies', 1, 99, 1);
      row.append(title, remove, fields); list.append(row);
    });
  }
  function packPage(items, pageWidth, pageHeight) {
    const margin = 5, bottomReserve = 10, gap = 3, freeRects = [{ x: margin, y: margin, w: pageWidth - margin * 2, h: pageHeight - margin - bottomReserve }];
    const placements = [], remaining = [];
    const sorted = [...items].sort((a, b) => (b.widthMm * b.heightMm) - (a.widthMm * a.heightMm));
    const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const prune = () => {
      for (let i = freeRects.length - 1; i >= 0; i--) {
        for (let j = 0; j < freeRects.length; j++) {
          if (i !== j && freeRects[i] && freeRects[j] && freeRects[i].x >= freeRects[j].x && freeRects[i].y >= freeRects[j].y && freeRects[i].x + freeRects[i].w <= freeRects[j].x + freeRects[j].w && freeRects[i].y + freeRects[i].h <= freeRects[j].y + freeRects[j].h) { freeRects.splice(i, 1); break; }
        }
      }
    };
    for (const item of sorted) {
      const sourceW = Number(item.widthMm) + .5, sourceH = Number(item.heightMm) + .5;
      let best = null;
      for (let i = 0; i < freeRects.length; i++) {
        const free = freeRects[i];
        for (const rotated of [false, true]) {
          const w = (rotated ? sourceH : sourceW) + gap, h = (rotated ? sourceW : sourceH) + gap;
          if (w > free.w || h > free.h) continue;
          const shortFit = Math.min(free.w - w, free.h - h), longFit = Math.max(free.w - w, free.h - h);
          if (!best || shortFit < best.shortFit || (shortFit === best.shortFit && longFit < best.longFit)) best = { freeIndex: i, x: free.x, y: free.y, w, h, artW: rotated ? sourceH : sourceW, artH: rotated ? sourceW : sourceH, sourceW, sourceH, rotated, shortFit, longFit, item };
        }
      }
      if (!best) { remaining.push(item); continue; }
      placements.push({ ...best, item });
      const used = { x: best.x, y: best.y, w: best.w, h: best.h };
      for (let i = freeRects.length - 1; i >= 0; i--) {
        const free = freeRects[i]; if (!intersects(free, used)) continue;
        freeRects.splice(i, 1);
        if (used.x > free.x) freeRects.push({ x: free.x, y: free.y, w: used.x - free.x, h: free.h });
        if (used.x + used.w < free.x + free.w) freeRects.push({ x: used.x + used.w, y: free.y, w: free.x + free.w - used.x - used.w, h: free.h });
        if (used.y > free.y) freeRects.push({ x: free.x, y: free.y, w: free.w, h: used.y - free.y });
        if (used.y + used.h < free.y + free.h) freeRects.push({ x: free.x, y: used.y + used.h, w: free.w, h: free.y + free.h - used.y - used.h });
      }
      prune();
    }
    return { pageWidth, pageHeight, placements, remaining };
  }
  function packQueue() {
    const copies = [];
    let requested = 0;
    state.printQueue.forEach((entry) => {
      const quantity = Math.max(1, Math.min(99, Number(entry.copies) || 1));
      requested += quantity;
      for (let copy = 1; copy <= quantity && copies.length < 300; copy++) copies.push({ ...entry, copy });
    });
    let remaining = copies, sheets = [];
    while (remaining.length && sheets.length < 200) {
      const chosen = packPage(remaining, 297, 210);
      if (!chosen.placements.length) break;
      sheets.push(chosen); remaining = chosen.remaining;
    }
    return { copies, sheets, remaining, truncated: requested > copies.length || (remaining.length > 0 && sheets.length >= 200) };
  }
  function maxCopiesOfSize(widthMm, heightMm) {
    const margin = 5, bottomReserve = 10, gap = 3, w = widthMm + .5, h = heightMm + .5;
    const count = (pageW, pageH, itemW, itemH) => Math.floor((pageW - margin * 2 + gap) / (itemW + gap)) * Math.floor((pageH - margin - bottomReserve + gap) / (itemH + gap));
    return Math.max(count(297,210,w,h), count(297,210,h,w));
  }
  function drawQueuePreview(page) {
    queueCanvas.hidden = !page?.placements.length;
    if (!page?.placements.length) return;
    const scale = queueCanvas.width / page.pageWidth;
    queueCtx.clearRect(0,0,queueCanvas.width,queueCanvas.height); queueCtx.fillStyle = '#fff'; queueCtx.fillRect(0,0,queueCanvas.width,queueCanvas.height);
    queueCtx.strokeStyle = '#20242d'; queueCtx.lineWidth = 2; queueCtx.strokeRect(1,1,queueCanvas.width-2,queueCanvas.height-2);
    queueCtx.strokeStyle = '#73c8d8'; queueCtx.lineWidth = 1.5; queueCtx.setLineDash([5,5]); queueCtx.strokeRect(5*scale,5*scale,(page.pageWidth-10)*scale,(page.pageHeight-15)*scale); queueCtx.setLineDash([]);
    const colors = ['#fee0db','#dff5ff','#e8e0ff','#e0f3d9','#fff1c9','#f6dff0'];
    page.placements.forEach((placement, index) => {
      const x=placement.x*scale, y=placement.y*scale, w=placement.artW*scale, h=placement.artH*scale;
      queueCtx.fillStyle = colors[index % colors.length]; queueCtx.fillRect(x,y,w,h); queueCtx.strokeStyle='#263039'; queueCtx.lineWidth=1.5; queueCtx.strokeRect(x,y,w,h);
      queueCtx.fillStyle='#182027'; queueCtx.font='bold 13px system-ui'; queueCtx.textAlign='center'; queueCtx.textBaseline='middle'; queueCtx.fillText(String(index+1),x+w/2,y+h/2);
    });
    const rulerW=100.5*scale, rulerX=(queueCanvas.width-rulerW)/2, rulerY=(page.pageHeight-10)*scale;
    queueCtx.strokeStyle='#111'; queueCtx.lineWidth=2; queueCtx.beginPath(); queueCtx.moveTo(rulerX,rulerY); queueCtx.lineTo(rulerX+rulerW,rulerY); queueCtx.stroke();
    queueCtx.beginPath(); queueCtx.moveTo(rulerX,rulerY-6); queueCtx.lineTo(rulerX,rulerY+6); queueCtx.moveTo(rulerX+rulerW,rulerY-6); queueCtx.lineTo(rulerX+rulerW,rulerY+6); queueCtx.stroke();
    queueCtx.fillStyle='#111'; queueCtx.font='12px system-ui'; queueCtx.textAlign='center'; queueCtx.textBaseline='top'; queueCtx.fillText('100 mm',queueCanvas.width/2,rulerY+7);
  }
  function calculateQueue() {
    if (!state.printQueue.length) { $('#queueAnalysis').textContent = 'A4 ainava · 5 mm malas · 3 mm atstarpe · 100 mm pārbaudes līnija apakšā. Pievieno attēlus, lai aprēķinātu izvietojumu.'; drawQueuePreview(null); return; }
    const result = packQueue(), first = result.sheets[0];
    const firstItem = state.printQueue[0], identicalMax = maxCopiesOfSize(Number(firstItem.widthMm), Number(firstItem.heightMm));
    const total = result.copies.length, placed = result.sheets.reduce((sum, page) => sum + page.placements.length, 0);
    const sheetLines = result.sheets.map((page, index) => `Lapa ${index+1}: ${page.placements.length} attēli · A4 ${page.pageWidth > page.pageHeight ? 'ainava' : 'portrets'}`);
    let message = `Rindā ${total} kopijas. Pirmajā lapā ietilpst ${first?.placements.length || 0}; kopā vajadzīgas ${result.sheets.length} A4 lapas.\n${sheetLines.join('\n')}\nVienāda izmēra ${firstItem.widthMm} × ${firstItem.heightMm} mm attēlu režģa ietilpība: līdz ${identicalMax} uz lapas. Aprēķinā rezervēta vieta 100 mm līnijai apakšā.`;
    if (result.remaining.length) message += `\n${result.remaining.length} kopijas palikušas ārpus aprēķinātā izkārtojuma.`;
    if (result.truncated) message += '\nAprēķina limits ir 300 kopijas; samazini kopiju skaitu, lai varētu sagatavot visu rindu.';
    if (total > placed && !result.remaining.length) message += `\nIzvietojums ir automātisks; dažādu izmēru kombinācijām cits izkārtojums reizēm var izmantot vietu labāk.`;
    $('#queueAnalysis').textContent = message; drawQueuePreview(first);
  }
  function drawGuides(t, w, h) {
    guidesCanvas.width = canvas.width; guidesCanvas.height = canvas.height;
    guides.clearRect(0, 0, w, h);
    guides.save();
    if (state.grid) {
      const stepX = mmPx(5), stepY = mmPx(5);
      guides.strokeStyle = 'rgba(90,220,255,.19)'; guides.lineWidth = Math.max(1, w / 1800); guides.setLineDash([]);
      for (let x = stepX; x < w; x += stepX) { guides.beginPath(); guides.moveTo(x, 0); guides.lineTo(x, h); guides.stroke(); }
      for (let y = stepY; y < h; y += stepY) { guides.beginPath(); guides.moveTo(0, y); guides.lineTo(w, y); guides.stroke(); }
    }
    if (state.guidelines) {
      guides.strokeStyle = 'rgba(255,255,255,.96)'; guides.fillStyle = 'rgba(255,255,255,.96)'; guides.lineWidth = Math.max(3, w / 650); guides.shadowColor = 'rgba(0,0,0,.9)'; guides.shadowBlur = Math.max(5, w / 180); guides.setLineDash([w / 85, w / 130]);
      if (t !== 'disc') {
        const safe = mmPx(3); guides.strokeStyle = '#ffd15c'; guides.lineWidth = Math.max(4, w / 450); guides.strokeRect(safe, safe, w - safe * 2, h - safe * 2);
      }
      if (t === 'frontBooklet' || t === 'backBooklet') {
        guides.beginPath(); guides.moveTo(w / 2, 0); guides.lineTo(w / 2, h); guides.stroke();
        guides.setLineDash([]); guides.font = `${Math.max(10, w / 65)}px system-ui`; guides.fillText('LOCĪJUMS', w / 2 + 8, h - 12);
      } else if (t === 'tray') {
        const spine = w * (6.5 / 151);
        [spine, w - spine].forEach((x) => { guides.beginPath(); guides.moveTo(x, 0); guides.lineTo(x, h); guides.stroke(); });
        guides.setLineDash([]); guides.font = `${Math.max(9, w / 80)}px system-ui`; guides.fillText('MUGURIŅA', 4, h - 10); guides.fillText('MUGURIŅA', w - spine + 4, h - 10);
      } else if (t === 'disc') {
        const cx = w / 2, cy = h / 2, outer = Math.min(w, h) / 2, inner = outer * (18 / 120);
        guides.setLineDash([]); guides.strokeStyle = 'rgba(255,255,255,.95)'; guides.beginPath(); guides.arc(cx, cy, outer, 0, Math.PI * 2); guides.stroke();
        guides.fillStyle = 'rgba(8,10,18,.8)'; guides.beginPath(); guides.arc(cx, cy, inner, 0, Math.PI * 2); guides.fill();
        guides.strokeStyle = 'rgba(255,255,255,.95)'; guides.setLineDash([w / 100, w / 120]); guides.beginPath(); guides.arc(cx, cy, inner, 0, Math.PI * 2); guides.stroke();
        guides.save(); guides.beginPath(); guides.arc(cx, cy, inner - 2, 0, Math.PI * 2); guides.clip(); guides.strokeStyle = 'rgba(255,255,255,.5)'; guides.setLineDash([]);
        for (let x = cx - inner; x < cx + inner; x += 7) { guides.beginPath(); guides.moveTo(x, cy - inner); guides.lineTo(x + inner * 2, cy + inner); guides.stroke(); } guides.restore();
      }
    }
    const selected = state.layers.find((layer) => layer.id === state.selectedId);
    if (selected) {
      guides.save(); guides.translate(selected.x * w, selected.y * h); guides.rotate((selected.rotation || 0) * Math.PI / 180);
      guides.setLineDash([w / 150, w / 220]); guides.shadowColor = '#00131a'; guides.shadowBlur = Math.max(10, w / 100);
      guides.strokeStyle = 'rgba(0,0,0,.95)'; guides.lineWidth = Math.max(12, w / 160); guides.strokeRect(-selected.w * w / 2, -selected.h * h / 2, selected.w * w, selected.h * h);
      guides.shadowBlur = 0; guides.strokeStyle = '#00e5ff'; guides.lineWidth = Math.max(6, w / 320); guides.strokeRect(-selected.w * w / 2, -selected.h * h / 2, selected.w * w, selected.h * h);
      guides.setLineDash([]); const handle = Math.max(24, w / 60); const hx = selected.w * w / 2 - handle / 2, hy = selected.h * h / 2 - handle / 2;
      guides.fillStyle = '#00e5ff'; guides.fillRect(hx, hy, handle, handle); guides.strokeStyle = '#00131a'; guides.lineWidth = Math.max(3, w / 600); guides.strokeRect(hx, hy, handle, handle); guides.restore();
    }
    guides.restore();
    guides.style.width = `${canvas.clientWidth}px`; guides.style.height = `${canvas.clientHeight}px`;
  }
  function drawLayers(w, h) {
    for (const layer of state.layers) {
      const cx = layer.x * w, cy = layer.y * h, boxW = layer.w * w, boxH = layer.h * h;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((layer.rotation || 0) * Math.PI / 180); ctx.globalAlpha = layer.opacity ?? 1;
      if (layer.type === 'image') {
        const bitmap = layerImages.get(layer.id);
        if (bitmap) {
          const scale = Math.min(boxW / bitmap.width, boxH / bitmap.height);
          const iw = bitmap.width * scale, ih = bitmap.height * scale;
          ctx.filter = `brightness(${layer.brightness ?? 1}) contrast(${layer.contrast ?? 1}) saturate(${layer.saturation ?? 1})`;
          ctx.drawImage(bitmap, -iw / 2, -ih / 2, iw, ih);
        }
      } else if (layer.type === 'rect') {
        ctx.fillStyle = layer.color || '#ee6253'; ctx.fillRect(-boxW / 2, -boxH / 2, boxW, boxH);
      } else if (layer.type === 'circle') {
        ctx.fillStyle = layer.color || '#ee6253'; ctx.beginPath(); ctx.ellipse(0, 0, boxW / 2, boxH / 2, 0, 0, Math.PI * 2); ctx.fill();
      } else if (layer.type === 'line') {
        ctx.strokeStyle = layer.color || '#ee6253'; ctx.lineWidth = Math.max(2, Math.min(boxH, w * .02)); ctx.beginPath(); ctx.moveTo(-boxW / 2, 0); ctx.lineTo(boxW / 2, 0); ctx.stroke();
      } else if (layer.type === 'text') {
        const fontSize = Math.max(12, Math.min(w, h) * (layer.fontSize || .06));
        ctx.fillStyle = layer.color || '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
        ctx.shadowColor = layer.shadow ? '#000b' : 'transparent'; ctx.shadowBlur = layer.shadow ? fontSize * .2 : 0;
        const lines = [];
        for (const paragraph of String(layer.text || '').split('\n')) {
          let line = '';
          for (const word of paragraph.split(/\s+/)) {
            const candidate = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(candidate).width > boxW * .94) { lines.push(line); line = word; } else line = candidate;
          }
          lines.push(line);
        }
        const lineHeight = fontSize * 1.2, maxLines = Math.max(1, Math.floor(boxH / lineHeight));
        const shown = lines.slice(0, maxLines), startY = -((shown.length - 1) * lineHeight) / 2;
        shown.forEach((line, i) => ctx.fillText(line, 0, startY + i * lineHeight, boxW * .96));
      }
      ctx.restore();
    }
  }
  function render() {
    const t = templates[state.template] || templates.front;
    const w = mmPx(t.w), h = mmPx(t.h);
    canvas.width = w; canvas.height = h;
    $('#dimensions').textContent = `${t.w} × ${t.h} mm · ${DPI} dpi${state.template === 'disc' ? ' · Ø 120 / centra caurums Ø 18 mm' : ''}`;
    $('#templateNote').textContent = t.note;
    $('#discHint').hidden = state.template !== 'disc';
    $('#guideLegend').textContent = state.template === 'disc' ? 'Svītrotais centrs ir caurums, attēlā tas būs caurspīdīgs' : 'Dzeltenā līnija rāda 3 mm drošo malu; baltās — locījumu un muguriņas';
    $('#zoomOut').textContent = `${Math.round(state.zoom * 100)}%`; $('#rotationOut').textContent = `${Math.round(state.rotation)}°`;
    $('#brightnessOut').textContent = `${Math.round(state.brightness * 100)}%`; $('#contrastOut').textContent = `${Math.round(state.contrast * 100)}%`; $('#saturationOut').textContent = `${Math.round(state.saturation * 100)}%`;
    ctx.clearRect(0, 0, w, h);
    if (sourceImage) {
      ctx.save(); ctx.translate(w / 2 + state.tx * w, h / 2 + state.ty * h); ctx.rotate(state.rotation * Math.PI / 180);
      const baseScale = Math.max(w / sourceImage.width, h / sourceImage.height) * state.zoom;
      const iw = sourceImage.width * baseScale, ih = sourceImage.height * baseScale;
      ctx.filter = `brightness(${state.brightness}) contrast(${state.contrast}) saturate(${state.saturation})`;
      ctx.drawImage(sourceImage, -iw / 2, -ih / 2, iw, ih); ctx.filter = 'none';
      if (state.text) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = state.textColor;
        ctx.font = `700 ${Math.max(24, Math.min(w, h) * .055)}px system-ui, sans-serif`;
        ctx.shadowColor = '#000b'; ctx.shadowBlur = Math.min(w, h) * .012; ctx.shadowOffsetY = Math.min(w, h) * .004;
        ctx.fillText(state.text, 0, h * .36, w * .85);
      }
      ctx.restore();
    }
    drawLayers(w, h);
    if (state.template === 'disc') {
      ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(w / 2, h / 2, mmPx(9), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    $('#emptyHint').hidden = Boolean(sourceImage || state.layers.length);
    drawGuides(state.template, w, h);
  }
  function updateFromControls(save = true) {
    state.template = $('#template').value;
    state.zoom = Number($('#zoom').value) / 100; state.rotation = Number($('#rotation').value);
    state.brightness = Number($('#brightness').value) / 100; state.contrast = Number($('#contrast').value) / 100; state.saturation = Number($('#saturation').value) / 100;
    render(); if (save) localSave();
  }
  $('#template').addEventListener('change', () => updateFromControls());
  ['zoom','rotation','brightness','contrast','saturation'].forEach((id) => $(`#${id}`).addEventListener('input', () => updateFromControls()));
  async function addImageFiles(files) {
    const images = [...files].filter((file) => file.type.startsWith('image/'));
    for (const file of images) {
      if (!state.imageBlob && !state.layers.some((layer) => layer.type === 'image')) { setImage(file, false); continue; }
      try {
        const bitmap = await createImageBitmap(file), id = makeId();
        layerImages.set(id, bitmap);
        addLayer({ id, type: 'image', name: file.name, blob: file, x: .5, y: .5, w: .4, h: .4, rotation: 0, opacity: 1 });
      } catch { $('#saveStatus').textContent = `Neizdevās atvērt attēlu “${file.name}”.`; }
    }
    localSave();
  }
  $('#imageFile').addEventListener('change', (e) => { if (e.target.files?.length) addImageFiles(e.target.files); e.target.value = ''; });
  $('#replaceBackground').addEventListener('click', () => $('#backgroundFile').click());
  $('#backgroundFile').addEventListener('change', (e) => { const file = e.target.files?.[0]; if (file?.type.startsWith('image/')) setImage(file); e.target.value = ''; });
  $('#addText').addEventListener('click', () => addLayer({ type: 'text', name: 'Teksts', text: 'Tavs teksts', x: .5, y: .5, w: .55, h: .16, fontSize: .06, color: '#ffffff' }));
  $('#addRect').addEventListener('click', () => addLayer({ type: 'rect', name: 'Taisnstūris', w: .32, h: .22 }));
  $('#addCircle').addEventListener('click', () => addLayer({ type: 'circle', name: 'Aplis', w: .26, h: .26 }));
  $('#addLine').addEventListener('click', () => addLayer({ type: 'line', name: 'Līnija', w: .42, h: .04 }));
  $('#toggleGuides').addEventListener('change', (e) => { state.guidelines = e.target.checked; render(); localSave(); });
  $('#toggleGrid').addEventListener('change', (e) => { state.grid = e.target.checked; render(); localSave(); });
  function selectedLayer() { return state.layers.find((layer) => layer.id === state.selectedId); }
  function updateSelectedLayer() {
    const layer = selectedLayer(); if (!layer) return;
    layer.w = Number($('#objectWidth').value) / 100; layer.h = Number($('#objectHeight').value) / 100;
    layer.rotation = Number($('#objectRotation').value); layer.opacity = Number($('#objectOpacity').value) / 100;
    if (layer.type === 'text') { layer.text = $('#objectText').value; layer.fontSize = Number($('#fontSize').value) / 100; }
    if (['text','rect','circle','line'].includes(layer.type)) layer.color = $('#objectColor').value;
    $('#objectWidthOut').textContent = `${Math.round(layer.w * 100)}%`; $('#objectHeightOut').textContent = `${Math.round(layer.h * 100)}%`;
    $('#objectRotationOut').textContent = `${Math.round(layer.rotation)}°`; $('#objectOpacityOut').textContent = `${Math.round(layer.opacity * 100)}%`;
    $('#fontSizeOut').textContent = `${Math.round((layer.fontSize || .06) * 100)}%`;
    render(); localSave();
  }
  ['objectWidth','objectHeight','objectRotation','objectOpacity','objectText','objectColor','fontSize'].forEach((id) => $(`#${id}`).addEventListener('input', updateSelectedLayer));
  $('#deleteObject').addEventListener('click', () => {
    const index = state.layers.findIndex((layer) => layer.id === state.selectedId); if (index < 0) return;
    layerImages.get(state.selectedId)?.close?.(); layerImages.delete(state.selectedId); state.layers.splice(index, 1);
    state.selectedId = state.layers[Math.min(index, state.layers.length - 1)]?.id || null; syncLayerPanel(); render(); localSave();
  });
  function shiftLayer(delta) {
    const index = state.layers.findIndex((layer) => layer.id === state.selectedId), next = index + delta;
    if (index < 0 || next < 0 || next >= state.layers.length) return;
    [state.layers[index], state.layers[next]] = [state.layers[next], state.layers[index]]; syncLayerPanel(); render(); localSave();
  }
  $('#layerUp').addEventListener('click', () => shiftLayer(1)); $('#layerDown').addEventListener('click', () => shiftLayer(-1));
  shell.addEventListener('dragover', (e) => { e.preventDefault(); });
  shell.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) addImageFiles(e.dataTransfer.files); });
  function layerAt(x, y) {
    for (let index = state.layers.length - 1; index >= 0; index--) {
      const layer = state.layers[index], dx = (x - layer.x) * canvas.width, dy = (y - layer.y) * canvas.height;
      const a = -(layer.rotation || 0) * Math.PI / 180, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= layer.w * canvas.width / 2 && Math.abs(ly) <= layer.h * canvas.height / 2) return layer;
    }
    return null;
  }
  shell.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas) return;
    const rect = canvas.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
    const selected = selectedLayer(); let layer = selected;
    const a = selected ? -(selected.rotation || 0) * Math.PI / 180 : 0;
    const px = (x - (selected?.x || 0)) * canvas.width, py = (y - (selected?.y || 0)) * canvas.height;
    const dx = selected ? px * Math.cos(a) - py * Math.sin(a) : 0;
    const dy = selected ? px * Math.sin(a) + py * Math.cos(a) : 0;
    const onHandle = selected && dx > selected.w * canvas.width / 2 - 18 && dy > selected.h * canvas.height / 2 - 18;
    if (!onHandle) layer = layerAt(x, y);
    if (layer) {
      state.selectedId = layer.id; syncLayerPanel();
      drag = { layer, mode: onHandle && layer.id === selected?.id ? 'resize' : 'move', x, y, cx: layer.x, cy: layer.y, w: layer.w, h: layer.h };
    } else if (sourceImage) { state.selectedId = null; syncLayerPanel(); drag = { mode: 'background', x: e.clientX, y: e.clientY, tx: state.tx, ty: state.ty }; }
    else { state.selectedId = null; syncLayerPanel(); render(); }
    shell.setPointerCapture(e.pointerId);
  });
  shell.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.mode === 'background') { const rect = canvas.getBoundingClientRect(); state.tx = drag.tx + (e.clientX - drag.x) / rect.width; state.ty = drag.ty + (e.clientY - drag.y) / rect.height; }
    else {
      const rect = canvas.getBoundingClientRect(), x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
      if (drag.mode === 'resize') { drag.layer.w = Math.max(.02, drag.w + x - drag.x); drag.layer.h = Math.max(.02, drag.h + y - drag.y); }
      else { drag.layer.x = drag.cx + x - drag.x; drag.layer.y = drag.cy + y - drag.y; }
    }
    render();
  });
  shell.addEventListener('pointerup', () => { if (drag) { syncLayerPanel(); localSave(); } drag = null; });
  function addToQueue(blob, name, widthMm, heightMm) {
    if (state.printQueue.length >= 100) { $('#queueAnalysis').textContent = 'Drukas rindā var būt līdz 100 attēlu failiem. Noņem kādu attēlu, lai pievienotu citus.'; return; }
    if (state.printQueue.reduce((sum, item) => sum + Math.max(1, Number(item.copies) || 1), 0) >= 300) { $('#queueAnalysis').textContent = 'Drukas rindā var būt līdz 300 kopijām vienā aprēķinā. Samazini kopiju skaitu, lai pievienotu attēlus.'; return; }
    state.printQueue.push({ id: makeId(), blob, name, widthMm, heightMm, copies: 1 });
    syncPrintQueue(); calculateQueue(); localSave();
  }
  $('#queueFiles').addEventListener('change', (e) => {
    const template = templates[state.template];
    [...(e.target.files || [])].forEach((file) => { if (file.type.startsWith('image/')) addToQueue(file, file.name, template.w, template.h); });
    e.target.value = '';
  });
  $('#queueCurrent').addEventListener('click', () => {
    if (!sourceImage && !state.layers.length) { $('#queueAnalysis').textContent = 'Vispirms pievieno attēlu, tekstu vai formu redaktora priekšskatījumam.'; return; }
    const template = templates[state.template];
    canvas.toBlob((blob) => { if (blob) addToQueue(blob, `CDify dizains · ${state.template}`, template.w, template.h); }, 'image/png');
  });
  $('#printQueue').addEventListener('click', async () => {
    if (!state.printQueue.length) { $('#queueAnalysis').textContent = 'Drukas rinda ir tukša.'; return; }
    const result = packQueue();
    if (result.truncated || result.remaining.length) { $('#queueAnalysis').textContent = 'Drukas rinda pārsniedz vienas sagatavošanas limitu. Samazini kopiju skaitu un mēģini vēlreiz.'; return; }
    if (!result.sheets.length) { $('#queueAnalysis').textContent = 'Neviena attēla izmērs neietilpst A4 lapā. Samazini rindas attēlu izmērus.'; return; }
    const win = window.open('', '_blank');
    if (!win) { $('#queueAnalysis').textContent = 'Atļauj uznirstošos logus, lai drukātu rindu.'; return; }
    $('#queueAnalysis').textContent += '\nSagatavo drukas lapas…';
    try {
      const toDataUrl = (blob) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
      const sources = new Map();
      for (const item of state.printQueue) sources.set(item.id, await toDataUrl(item.blob));
      const sheets = result.sheets.map((page) => {
        const images = page.placements.map((placement) => {
          const itemW = Number(placement.item.widthMm) + .5, itemH = Number(placement.item.heightMm) + .5;
          const left = placement.x + (placement.artW - itemW) / 2, top = placement.y + (placement.artH - itemH) / 2;
          const rotation = placement.rotated ? 'rotate(90deg)' : 'none';
          return `<img src="${sources.get(placement.item.id)}" alt="" style="left:${left}mm;top:${top}mm;width:${itemW}mm;height:${itemH}mm;transform:${rotation}">`;
        }).join('');
        return `<main class="sheet">${images}<div class="calibration"><div class="rule"></div><span>100 mm</span></div></main>`;
      }).join('');
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>CDify drukas rinda</title><style>@page{size:A4 landscape;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}.sheet{position:relative;width:297mm;height:210mm;overflow:hidden;break-after:page;page-break-after:always}.sheet:last-child{break-after:auto;page-break-after:auto}.sheet img{position:absolute;display:block;object-fit:cover;transform-origin:center}.calibration{position:absolute;left:50%;bottom:5mm;transform:translateX(-50%);width:100.5mm;height:5mm;text-align:center;color:#000;font:6pt Arial,sans-serif}.calibration .rule{position:absolute;left:0;top:0;width:100.5mm;border-top:.45mm solid #000}.calibration .rule:before,.calibration .rule:after{content:"";position:absolute;top:-.8mm;height:2.5mm;border-left:.45mm solid #000}.calibration .rule:before{left:0}.calibration .rule:after{right:0}.calibration span{position:absolute;left:0;right:0;top:1mm;background:#fff}</style></head><body>${sheets}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
      win.document.close();
    } catch (error) { win.close(); $('#queueAnalysis').textContent = 'Neizdevās sagatavot drukas rindu. Pārbaudi, vai attēlus var atvērt.'; }
  });
  $('#download').addEventListener('click', () => {
    if (!sourceImage && !state.layers.length) { $('#saveStatus').textContent = 'Vispirms pievieno attēlu, tekstu vai formu.'; return; }
    canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `cdify-${state.template}-${templates[state.template].w}x${templates[state.template].h}mm.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }, 'image/png');
  });
  $('#print').addEventListener('click', () => {
    if (!sourceImage && !state.layers.length) { $('#saveStatus').textContent = 'Vispirms pievieno attēlu, tekstu vai formu.'; return; }
    if (state.template === 'disc') { $('#download').click(); $('#saveStatus').textContent = 'PNG lejupielādēts. Atver to Epson Print CD, lai drukātu uz diska.'; return; }
    const t = templates[state.template]; const image = canvas.toDataURL('image/png'); const win = window.open('', '_blank');
    if (!win) { $('#saveStatus').textContent = 'Atļauj uznirstošo logu, lai izveidotu drukas lapu.'; return; }
    const landscape = t.w > 200;
    const pageWidth = landscape ? 297 : 210;
    const pageHeight = landscape ? 210 : 297;
    const orientation = landscape ? 'landscape' : 'portrait';
    const correctionMm = 0.5;
    const outputWidth = t.w + correctionMm;
    const outputHeight = t.h + correctionMm;
    const rulerWidth = 100 + correctionMm;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>CDify drukas sagatave</title><style>@page{size:A4 ${orientation};margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:${pageWidth}mm;height:${pageHeight}mm}.sheet{width:${pageWidth}mm;height:${pageHeight}mm;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}img{display:block;width:${outputWidth}mm;height:${outputHeight}mm}.calibration{position:absolute;z-index:2;left:50%;bottom:12mm;transform:translateX(-50%);width:112mm;padding:2mm 5mm;background:#fff;border:.4mm solid #000;text-align:center;font:9pt Arial,sans-serif;font-weight:bold;color:#000}.rule{position:relative;width:${rulerWidth}mm;height:5mm;margin:0 auto 1.5mm;border-top:.7mm solid #000}.rule:before,.rule:after{content:"";position:absolute;top:-1mm;height:5mm;border-left:.7mm solid #000}.rule:before{left:0}.rule:after{right:0}</style></head><body><main class="sheet"><img src="${image}" alt="CD vāka sagatave"><div class="calibration"><div class="rule"></div>100 mm PĀRBAUDES LĪNIJA</div></main><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`); win.document.close();
  });
  $('#reset').addEventListener('click', () => {
    if (!confirm('Dzēst fona attēlu un visus dizaina objektus?')) return;
    layerImages.forEach((bitmap) => bitmap.close?.()); layerImages.clear();
    Object.assign(state, { imageBlob: null, layers: [], selectedId: null, zoom: 1, rotation: 0, brightness: 1, contrast: 1, saturation: 1, text: '', textColor: '#ffffff', tx: 0, ty: 0 });
    sourceImage?.close?.(); sourceImage = null;
    $('#zoom').value = 100; $('#rotation').value = 0; $('#brightness').value = 100; $('#contrast').value = 100; $('#saturation').value = 100;
    syncLayerPanel(); render(); localSave();
  });
  $('#themeToggle').addEventListener('click', () => {
    const root = document.documentElement; const next = root.dataset.theme === 'dark' ? 'light' : 'dark'; root.dataset.theme = next; root.dataset.themePref = next;
    try { localStorage.setItem('theme', next); } catch {}
    $('meta[name="theme-color"]').content = next === 'light' ? '#f9f5f4' : '#06070d';
  });
  $('#editorBurger').addEventListener('click', (e) => { const open = document.body.classList.toggle('menu-open'); e.currentTarget.setAttribute('aria-expanded', String(open)); e.currentTarget.setAttribute('aria-label', open ? 'Aizvērt izvēlni' : 'Atvērt izvēlni'); });
  const resize = new ResizeObserver(() => { guides.style.width = `${canvas.clientWidth}px`; guides.style.height = `${canvas.clientHeight}px`; }); resize.observe(shell);
  render(); syncPrintQueue(); calculateQueue(); loadProject();
})();
