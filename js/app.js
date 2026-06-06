const { notes, poems } = window.BOOK_DATA;

const els = {
  introText: document.getElementById('introText'),
  afterText: document.getElementById('afterText'),
  playlist: document.getElementById('playlist'),
  book: document.getElementById('book'),
  poemMood: document.getElementById('poemMood'),
  poemTitle: document.getElementById('poemTitle'),
  poemQuote: document.getElementById('poemQuote'),
  poemText: document.getElementById('poemText'),
  currentSubtitle: document.getElementById('currentSubtitle'),
  nextSubtitle: document.getElementById('nextSubtitle'),
  leftPageNumber: document.getElementById('leftPageNumber'),
  rightPageNumber: document.getElementById('rightPageNumber'),
  audio: document.getElementById('audio'),
  playBtn: document.getElementById('playBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  shuffleBtn: document.getElementById('shuffleBtn'),
  repeatBtn: document.getElementById('repeatBtn'),
  originalBtn: document.getElementById('originalBtn'),
  seek: document.getElementById('seek'),
  currentTime: document.getElementById('currentTime'),
  duration: document.getElementById('duration'),
  canvas: document.getElementById('visualizer'),
  dialog: document.getElementById('spreadDialog'),
  spreadImage: document.getElementById('spreadImage'),
  closeDialog: document.getElementById('closeDialog'),
  toast: document.getElementById('toast')
};

const ctx = els.canvas.getContext('2d');
let index = 0;
let isPlaying = false;
let isSeeking = false;
let repeat = false;
let toastTimer = null;
let audioContext = null;
let analyser = null;
let source = null;
let dataArray = null;
let rafId = null;

function flattenLines(poem) {
  return poem.stanzas.flatMap(stanza => stanza);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 5200);
}

function renderStaticText() {
  els.introText.innerHTML = notes.intro.map(line => `<span>${line}</span>`).join('<br>');
  els.afterText.innerHTML = notes.after.map(line => `<p>${line}</p>`).join('');
}

function renderPlaylist() {
  els.playlist.innerHTML = poems.map((poem, i) => `
    <li>
      <button class="track-btn" type="button" data-index="${i}" aria-label="Открыть ${poem.title}">
        <span class="track-num">${poem.number}.</span>
        <span class="track-title">${poem.title}</span>
        <span class="track-time">${formatTime(poem.duration)}</span>
      </button>
    </li>
  `).join('');

  els.playlist.querySelectorAll('.track-btn').forEach(button => {
    button.addEventListener('click', () => {
      const nextIndex = Number(button.dataset.index);
      const wasPlaying = isPlaying;
      loadPoem(nextIndex, true);
      if (wasPlaying) play();
    });
  });
}

function updatePlaylistActive() {
  els.playlist.querySelectorAll('.track-btn').forEach((button, i) => {
    button.classList.toggle('active', i === index);
  });
}

function renderPoem(poem) {
  els.poemMood.textContent = poem.mood;
  els.poemTitle.textContent = poem.title;
  els.poemQuote.textContent = `«${poem.quote}»`;
  els.rightPageNumber.textContent = poem.bookPage;
  els.leftPageNumber.textContent = 'audio';

  let lineIndex = 0;
  els.poemText.innerHTML = poem.stanzas.map(stanza => {
    const lines = stanza.map(line => {
      const html = `<span class="poem-line" data-line-index="${lineIndex}">${line}</span>`;
      lineIndex += 1;
      return html;
    }).join('');
    return `<p class="stanza">${lines}</p>`;
  }).join('');

  const lines = flattenLines(poem);
  els.currentSubtitle.textContent = lines[0] || 'Нажми play, чтобы начать.';
  els.nextSubtitle.textContent = lines[1] || '';
  highlightLine(0);
}

function loadPoem(nextIndex, animate = false) {
  index = (nextIndex + poems.length) % poems.length;
  const poem = poems[index];

  if (animate) {
    els.book.classList.remove('turning');
    void els.book.offsetWidth;
    els.book.classList.add('turning');
  }

  renderPoem(poem);
  updatePlaylistActive();
  els.seek.value = 0;
  els.currentTime.textContent = '0:00';
  els.duration.textContent = formatTime(poem.duration);
  els.audio.src = poem.audio;
  els.audio.load();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: poem.title,
      artist: notes.author,
      album: notes.title,
      artwork: [{ src: poem.pageImage, sizes: '512x512', type: 'image/webp' }]
    });
  }

  drawIdleCanvas();
}

function setupAudioGraph() {
  if (audioContext) return;
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  source = audioContext.createMediaElementSource(els.audio);
  source.connect(analyser);
  analyser.connect(audioContext.destination);
}

async function play() {
  try {
    setupAudioGraph();
    await audioContext.resume();
    await els.audio.play();
    isPlaying = true;
    els.playBtn.textContent = 'Ⅱ';
    startVisualizer();
  } catch (error) {
    isPlaying = false;
    els.playBtn.textContent = '▶';
    showToast('Не получилось запустить аудио. Проверь, что файл лежит в папке audio и путь не изменён.');
    console.error(error);
  }
}

function pause() {
  els.audio.pause();
  isPlaying = false;
  els.playBtn.textContent = '▶';
  stopVisualizer();
}

function togglePlay() {
  if (isPlaying) pause();
  else play();
}

function next(auto = false) {
  if (repeat && auto) {
    els.audio.currentTime = 0;
    play();
    return;
  }
  const wasPlaying = isPlaying || auto;
  loadPoem(index + 1, true);
  if (wasPlaying) play();
}

function previous() {
  const wasPlaying = isPlaying;
  if (els.audio.currentTime > 5) {
    els.audio.currentTime = 0;
    updateProgress();
    return;
  }
  loadPoem(index - 1, true);
  if (wasPlaying) play();
}

function randomPoem() {
  if (poems.length < 2) return;
  let nextIndex = index;
  while (nextIndex === index) nextIndex = Math.floor(Math.random() * poems.length);
  const wasPlaying = isPlaying;
  loadPoem(nextIndex, true);
  if (wasPlaying) play();
}

function toggleRepeat() {
  repeat = !repeat;
  els.repeatBtn.textContent = repeat ? 'повтор: вкл' : 'повтор: выкл';
  els.repeatBtn.classList.toggle('active', repeat);
}

function getCurrentLineIndex() {
  const poem = poems[index];
  const lines = flattenLines(poem);
  const duration = Number.isFinite(els.audio.duration) ? els.audio.duration : poem.duration;
  if (!duration || !lines.length) return 0;
  const rawIndex = Math.floor((els.audio.currentTime / duration) * lines.length);
  return Math.min(lines.length - 1, Math.max(0, rawIndex));
}

function highlightLine(lineIndex) {
  const poem = poems[index];
  const lines = flattenLines(poem);
  els.poemText.querySelectorAll('.poem-line').forEach(line => {
    line.classList.toggle('active', Number(line.dataset.lineIndex) === lineIndex);
  });
  els.currentSubtitle.textContent = lines[lineIndex] || 'Нажми play, чтобы начать.';
  els.nextSubtitle.textContent = lines[lineIndex + 1] || '';
}

function updateProgress() {
  const duration = Number.isFinite(els.audio.duration) ? els.audio.duration : poems[index].duration;
  const current = els.audio.currentTime || 0;
  if (!isSeeking && duration) {
    els.seek.value = Math.round((current / duration) * Number(els.seek.max));
  }
  els.currentTime.textContent = formatTime(current);
  els.duration.textContent = formatTime(duration);
  highlightLine(getCurrentLineIndex());
}

function seekToInput() {
  const duration = Number.isFinite(els.audio.duration) ? els.audio.duration : poems[index].duration;
  if (!duration) return;
  els.audio.currentTime = (Number(els.seek.value) / Number(els.seek.max)) * duration;
  updateProgress();
}

function openOriginalSpread() {
  const poem = poems[index];
  els.spreadImage.src = poem.pageImage;
  els.spreadImage.alt = `Оригинальный разворот книги со стихом «${poem.title}»`;
  if (typeof els.dialog.showModal === 'function') {
    els.dialog.showModal();
  } else {
    window.open(poem.pageImage, '_blank');
  }
}

function drawIdleCanvas() {
  const { width, height } = els.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 244, 221, 0.10)';
  ctx.fillRect(0, 0, width, height);
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 44, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(233, 201, 141, 0.60)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = '18px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 244, 221, 0.72)';
  ctx.fillText('тишина до первого звука', width / 2, height / 2 + 6);
}

function startVisualizer() {
  if (rafId) cancelAnimationFrame(rafId);
  drawVisualizer();
}

function stopVisualizer() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function drawVisualizer() {
  if (!analyser || !dataArray) return;
  rafId = requestAnimationFrame(drawVisualizer);
  analyser.getByteFrequencyData(dataArray);

  const { width, height } = els.canvas;
  ctx.clearRect(0, 0, width, height);
  const centerX = width / 2;
  const centerY = height / 2;

  const bg = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, Math.max(width, height) / 1.8);
  bg.addColorStop(0, 'rgba(143, 65, 80, 0.64)');
  bg.addColorStop(0.55, 'rgba(53, 40, 38, 0.88)');
  bg.addColorStop(1, 'rgba(35, 21, 25, 1)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const bars = 64;
  const step = Math.floor(dataArray.length / bars) || 1;
  for (let i = 0; i < bars; i++) {
    const value = dataArray[i * step] / 255;
    const angle = (Math.PI * 2 * i) / bars;
    const inner = 36;
    const outer = inner + 18 + value * 66;
    const x1 = centerX + Math.cos(angle) * inner;
    const y1 = centerY + Math.sin(angle) * inner;
    const x2 = centerX + Math.cos(angle) * outer;
    const y2 = centerY + Math.sin(angle) * outer;

    const alpha = 0.28 + value * 0.62;
    ctx.strokeStyle = `rgba(246, 220, 135, ${alpha})`;
    ctx.lineWidth = 2 + value * 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(centerX, centerY, 34, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 244, 221, 0.92)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX, centerY, 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(143, 65, 80, 0.9)';
  ctx.fill();
}

function bindEvents() {
  els.playBtn.addEventListener('click', togglePlay);
  els.nextBtn.addEventListener('click', () => next(false));
  els.prevBtn.addEventListener('click', previous);
  els.shuffleBtn.addEventListener('click', randomPoem);
  els.repeatBtn.addEventListener('click', toggleRepeat);
  els.originalBtn.addEventListener('click', openOriginalSpread);
  els.closeDialog.addEventListener('click', () => els.dialog.close());

  els.audio.addEventListener('timeupdate', updateProgress);
  els.audio.addEventListener('loadedmetadata', updateProgress);
  els.audio.addEventListener('ended', () => next(true));
  els.audio.addEventListener('error', () => {
    const poem = poems[index];
    showToast(`Аудиофайл не найден или не загрузился: ${poem.audio}`);
  });

  els.seek.addEventListener('input', () => { isSeeking = true; seekToInput(); });
  els.seek.addEventListener('change', () => { isSeeking = false; seekToInput(); });

  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'button') return;
    if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
    if (event.code === 'ArrowRight') next(false);
    if (event.code === 'ArrowLeft') previous();
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('previoustrack', previous);
    navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
  }
}

function init() {
  renderStaticText();
  renderPlaylist();
  bindEvents();
  loadPoem(0, false);
  drawIdleCanvas();
  showToast('Подсказка: пробел — play/pause, стрелки ← → переключают стихи.');
}

init();
