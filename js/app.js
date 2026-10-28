/*
 * blz's whispers — browser edition.
 *
 * The interface and the twelve original XM modules are wired together here.
 * Playback is libopenmpt compiled to WebAssembly and runs inside an
 * AudioWorklet (vendored chiptune3), so nothing is pre-rendered.
 */

import { ChiptuneJsPlayer } from '../vendor/chiptune3.js';
import {
  SEASONS,
  SEASON_ORDER,
  MONTHS,
  MONTHS_BY_SLUG,
  TOTAL_SECONDS,
  getMonth,
  firstMonthOfSeason,
  formatTime,
} from './tracks.js';
import { ParticleField } from './particles.js';

const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const COVER_ART = 'assets/art/cover.jpg';
const VOLUME_KEY = 'whispers.volume.v1';
const REPEAT_MODES = ['all', 'one', 'off'];
const REPEAT_LABELS = { all: 'all months', one: 'one month', off: 'off' };

const dom = {
  coverView: $('coverView'),
  playerView: $('playerView'),
  seasonIndex: $('seasonIndex'),
  seasonRail: $('seasonRail'),
  monthRail: $('monthRail'),
  monthRailLabel: $('monthRailLabel'),
  artA: $('artA'),
  artB: $('artB'),
  particles: $('particles'),
  painting: $('painting'),
  plateSeason: $('plateSeason'),
  plateMonth: $('plateMonth'),
  enterCurrentBtn: $('enterCurrentBtn'),
  enterCurrentLabel: $('enterCurrentLabel'),
  coverNow: $('coverNow'),
  coverTotal: $('coverTotal'),
  homeBtn: $('homeBtn'),
  soundBtn: $('soundBtn'),
  fullscreenBtn: $('fullscreenBtn'),
  prevMonthBtn: $('prevMonthBtn'),
  nextMonthBtn: $('nextMonthBtn'),
  prevMonthLabel: $('prevMonthLabel'),
  nextMonthLabel: $('nextMonthLabel'),
  startPrompt: $('startPrompt'),
  playBtn: $('playBtn'),
  playIcon: $('playIcon'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  repeatBtn: $('repeatBtn'),
  repeatBadge: $('repeatBadge'),
  progress: $('progress'),
  progressFill: $('progressFill'),
  progressHandle: document.querySelector('.progress__handle'),
  timeNow: $('timeNow'),
  timeTotal: $('timeTotal'),
  channelCount: $('channelCount'),
  levels: $('levels'),
  loading: $('loading'),
  loadingText: $('loadingText'),
  miniPlayer: $('miniPlayer'),
  miniPlayBtn: $('miniPlayBtn'),
  miniPlayIcon: $('miniPlayIcon'),
  miniOpenBtn: $('miniOpenBtn'),
  miniOpenArrowBtn: $('miniOpenArrowBtn'),
  miniSeason: $('miniSeason'),
  miniTitle: $('miniTitle'),
  miniFill: $('miniFill'),
  miniNow: $('miniNow'),
  miniTotal: $('miniTotal'),
  miniSoundBtn: $('miniSoundBtn'),
  volumePop: $('volumePop'),
  volumeMuteBtn: $('volumeMuteBtn'),
  volumeRange: $('volumeRange'),
  volumeOut: $('volumeOut'),
  aboutBtn: $('aboutBtn'),
  aboutDialog: $('aboutDialog'),
  secretDot: $('secretDot'),
  secretText: $('secretText'),
  toast: $('toast'),
  railCoverBtn: $('railCoverBtn'),
  railCoverBtn2: $('railCoverBtn2'),
  backdropA: $('backdropA'),
  backdropB: $('backdropB'),
};

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const durationCache = new Map();
const channelCache = new Map();
const bufferCache = new Map();
const calendarMonth = getMonth(new Date().getMonth());
const bootRoute = readRoute(calendarMonth.index);
const bootIndex = bootRoute.view === 'player' ? bootRoute.index : calendarMonth.index;
const bootView = bootRoute.view === 'player' ? 'player' : 'cover';

const state = {
  index: bootIndex,
  season: MONTHS[bootIndex].season,
  view: bootView,
  duration: getKnownDuration(MONTHS[bootIndex]),
  position: 0,
  playing: false,
  hasStarted: false,
  loading: false,
  preparing: false,
  ended: false,
  ending: false,
  suppressEndUntil: 0,
  loadedIndex: null,
  metaIndex: null,
  playToken: 0,
  repeat: 'all',
  volume: readStoredVolume(),
  preMuteVolume: 75,
  monthRailSeason: null,
};

if (state.volume > 0) state.preMuteVolume = state.volume;

const audio = {
  context: null,
  player: null,
  analyser: null,
  frequencyData: null,
  ready: null,
  initTimer: 0,
  levelRaf: 0,
};

const artState = {
  active: null,
  url: null,
};

const backdropState = {
  active: dom.backdropA,
  url: COVER_ART,
};

let particleField = null;
let volumeAnchor = null;
let volumeTimer = 0;
let toastTimer = 0;
let loadingFallback = 0;
let dragState = null;

init();

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

function init() {
  dom.coverTotal.textContent = formatLong(TOTAL_SECONDS);
  dom.soundBtn.setAttribute('aria-haspopup', 'dialog');
  dom.soundBtn.setAttribute('aria-controls', 'volumePop');
  dom.soundBtn.setAttribute('aria-expanded', 'false');
  dom.miniSoundBtn.setAttribute('aria-haspopup', 'dialog');
  dom.miniSoundBtn.setAttribute('aria-controls', 'volumePop');
  dom.miniSoundBtn.setAttribute('aria-expanded', 'false');

  renderCover();
  renderSeasonRail();
  setupInitialArtwork();
  setupParticles();
  setVolumeUI();
  setRepeatMode('all');
  bindEvents();

  applyTrack(MONTHS[state.index], { initial: true });
  setView(bootView, { initial: true });
  updatePlayUI();
  updateStartPrompt();
  syncMini();
  updateDocumentTitle();

  schedulePreload();

  if (bootRoute.invalid) {
    // Keep the clean cover, but make the intended first action unambiguous.
    dom.coverNow.setAttribute('title', 'The link did not point at a month, so the calendar opened on the cover.');
  }
}

function readStoredVolume() {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return 75;
    const value = Number(raw);
    if (!Number.isFinite(value)) return 75;
    return clamp(Math.round(value), 0, 100);
  } catch (error) {
    return 75;
  }
}

function storeVolume(value) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(value));
  } catch (error) {
    /* Local storage can be unavailable in private or file contexts. */
  }
}

function getKnownDuration(month) {
  return durationCache.get(month.slug) ?? month.duration;
}

function getKnownChannels(month) {
  return channelCache.get(month.slug) ?? month.channels;
}

function formatLong(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins} min ${secs} sec`;
}

/* ------------------------------------------------------------------ */
/* route                                                               */
/* ------------------------------------------------------------------ */

function readRoute(preferredIndex) {
  const hash = window.location.hash;

  if (!hash || hash === '#' || hash === '#/') {
    return { view: 'cover', invalid: false };
  }

  let raw = hash.slice(1);
  try {
    raw = decodeURIComponent(raw);
  } catch (error) {
    return { view: 'cover', invalid: true };
  }

  raw = raw.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  if (!raw) return { view: 'cover', invalid: false };

  const parts = raw.split('/');
  if (parts.length > 2) return { view: 'cover', invalid: true };

  if (parts.length === 1) {
    if (SEASONS[parts[0]]) {
      const current = MONTHS[preferredIndex];
      const index = current && current.season === parts[0]
        ? current.index
        : firstMonthOfSeason(parts[0]).index;
      return { view: 'player', index, invalid: false };
    }

    const month = MONTHS_BY_SLUG[parts[0]];
    if (month) return { view: 'player', index: month.index, invalid: false };
    return { view: 'cover', invalid: true };
  }

  const season = SEASONS[parts[0]];
  const month = MONTHS_BY_SLUG[parts[1]];
  if (!season || !month || month.season !== season.id) {
    return { view: 'cover', invalid: true };
  }

  return { view: 'player', index: month.index, invalid: false };
}

function hashForTrack(index = state.index) {
  const month = MONTHS[index];
  return `#/${month.season}/${month.slug}`;
}

function writeHash(mode = 'replace') {
  const target = state.view === 'cover' ? '#/' : hashForTrack();
  if (window.location.hash === target) return;

  try {
    if (mode === 'push') {
      window.history.pushState({ whispers: true }, '', target);
    } else {
      window.history.replaceState({ whispers: true }, '', target);
    }
  } catch (error) {
    window.location.hash = target;
  }
}

function handleHashChange() {
  const route = readRoute(state.index);
  if (!route || route.invalid) {
    setView('cover', { pushHash: false });
    return;
  }

  if (route.view === 'cover') {
    setView('cover', { pushHash: false });
    return;
  }

  if (route.index !== state.index) {
    selectMonth(route.index, {
      enter: false,
      autoplay: state.hasStarted,
      updateRoute: false,
    });
  }

  setView('player', { pushHash: false });
}

/* ------------------------------------------------------------------ */
/* cover and rails                                                     */
/* ------------------------------------------------------------------ */

function renderCover() {
  const rows = SEASON_ORDER.map((seasonId) => {
    const season = SEASONS[seasonId];
    const chips = season.months.map((slug) => {
      const month = MONTHS_BY_SLUG[slug];
      return `
        <button class="track-chip" type="button" data-month-index="${month.index}"
          aria-label="${month.name}, ${season.name}, ${formatTime(month.duration)}">
          <span class="track-chip__num">${month.number}</span>
          <span>${month.name}</span>
          <span class="track-chip__dur">${formatTime(month.duration)}</span>
        </button>`;
    }).join('');

    return `
      <article class="season-row" data-season="${season.id}" style="--row-accent: ${season.accent}">
        <div class="season-row__wash" aria-hidden="true" style="background-image:url('${season.image}')"></div>
        <button class="season-row__main" type="button" data-open-season="${season.id}"
          aria-label="Open ${season.name}, ${season.range}">
          <span class="season-row__thumb">
            <img src="${season.image}" alt="" loading="lazy" decoding="async">
          </span>
          <span class="season-row__name-wrap">
            <span class="season-row__numeral">${season.numeral}</span>
            <span class="season-row__name">${season.name}</span>
            <span class="season-row__tagline">${season.tagline}</span>
          </span>
          <span class="season-row__range">${season.range}</span>
        </button>
        <div class="season-row__tracks" role="group" aria-label="${season.name} months">
          ${chips}
        </div>
      </article>`;
  });

  dom.seasonIndex.innerHTML = rows.join('');
}

function renderSeasonRail() {
  dom.seasonRail.innerHTML = SEASON_ORDER.map((seasonId) => {
    const season = SEASONS[seasonId];
    return `
      <button class="season-nav" type="button" data-open-season="${season.id}"
        aria-label="${season.name}, ${season.range}">
        <span class="season-nav__num">${season.numeral}</span>
        <span class="season-nav__name">${season.name}</span>
      </button>`;
  }).join('');
}

function renderMonthRail(season) {
  dom.monthRailLabel.textContent = season.name;

  if (state.monthRailSeason === season.id) {
    updateRailActive();
    return;
  }

  state.monthRailSeason = season.id;
  dom.monthRail.innerHTML = season.months.map((slug) => {
    const month = MONTHS_BY_SLUG[slug];
    return `
      <button class="month-nav" type="button" data-month-index="${month.index}"
        aria-label="${month.name}, ${formatTime(month.duration)}">
        <span class="month-nav__num">${month.number}</span>
        <span class="month-nav__name">${month.name}</span>
      </button>`;
  }).join('');

  updateRailActive();
}

function updateRailActive() {
  dom.seasonRail.querySelectorAll('[data-open-season]').forEach((button) => {
    const active = button.dataset.openSeason === state.season;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });

  dom.monthRail.querySelectorAll('[data-month-index]').forEach((button) => {
    const active = Number(button.dataset.monthIndex) === state.index;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
}

function updateActiveUI() {
  const month = MONTHS[state.index];
  const season = SEASONS[month.season];
  const prev = MONTHS[(state.index + MONTHS.length - 1) % MONTHS.length];
  const next = MONTHS[(state.index + 1) % MONTHS.length];

  dom.seasonIndex.querySelectorAll('.season-row').forEach((row) => {
    row.classList.toggle('is-current-season', row.dataset.season === season.id);
  });

  dom.seasonIndex.querySelectorAll('.track-chip').forEach((chip) => {
    const active = Number(chip.dataset.monthIndex) === state.index;
    chip.classList.toggle('is-active', active);
    if (active) chip.setAttribute('aria-current', 'true');
    else chip.removeAttribute('aria-current');
  });

  updateRailActive();

  dom.coverNow.innerHTML = `now in <em>${season.name}</em> · ${month.name.toLowerCase()}`;
  dom.enterCurrentLabel.textContent = `Begin with ${month.name}`;

  dom.prevMonthLabel.textContent = prev.name;
  dom.nextMonthLabel.textContent = next.name;
  dom.prevMonthBtn.setAttribute('aria-label', `Previous month, ${prev.name}`);
  dom.nextMonthBtn.setAttribute('aria-label', `Next month, ${next.name}`);
  dom.prevBtn.title = `Previous month, ${prev.name} (←)`;
  dom.nextBtn.title = `Next month, ${next.name} (→)`;

  dom.monthRailLabel.textContent = season.name;
  dom.miniSeason.textContent = season.name;
  dom.miniTitle.textContent = month.name;
  dom.miniTotal.textContent = formatTime(state.duration);
  updateDocumentTitle();
}

/* ------------------------------------------------------------------ */
/* artwork and view                                                    */
/* ------------------------------------------------------------------ */

function setupInitialArtwork() {
  const month = MONTHS[state.index];
  const season = SEASONS[month.season];

  artState.active = dom.artA;
  artState.url = season.image;

  dom.artA.src = season.image;
  dom.artA.alt = season.alt;
  dom.artA.classList.add('is-visible');
  dom.artA.removeAttribute('aria-hidden');

  dom.artB.removeAttribute('src');
  dom.artB.alt = '';
  dom.artB.setAttribute('aria-hidden', 'true');
  dom.artB.classList.remove('is-visible');

  // Warm the browser cache so season changes can crossfade immediately.
  SEASON_ORDER.forEach((id) => {
    const image = new Image();
    image.src = SEASONS[id].image;
  });

  dom.backdropA.style.backgroundImage = `url("${COVER_ART}")`;
}

function setArt(season) {
  if (!artState.active || artState.url === season.image) return;

  const outgoing = artState.active;
  const incoming = outgoing === dom.artA ? dom.artB : dom.artA;

  incoming.src = season.image;
  incoming.alt = season.alt;
  incoming.removeAttribute('aria-hidden');

  // Force the incoming frame back to opacity 0 before starting the fade.
  incoming.classList.remove('is-visible');
  void incoming.offsetWidth;
  incoming.classList.add('is-visible');

  outgoing.classList.remove('is-visible');
  outgoing.alt = '';
  outgoing.setAttribute('aria-hidden', 'true');

  artState.active = incoming;
  artState.url = season.image;
}

function setBackdrop(url) {
  if (!url || backdropState.url === url) return;

  const outgoing = backdropState.active;
  const incoming = outgoing === dom.backdropA ? dom.backdropB : dom.backdropA;

  incoming.style.backgroundImage = `url("${url}")`;
  incoming.classList.add('is-active');
  outgoing.classList.remove('is-active');

  backdropState.active = incoming;
  backdropState.url = url;
}

function setView(view, { pushHash = true, initial = false } = {}) {
  const changed = state.view !== view;
  state.view = view;

  document.body.dataset.view = view;
  dom.coverView.setAttribute('aria-hidden', view === 'cover' ? 'false' : 'true');
  dom.playerView.setAttribute('aria-hidden', view === 'player' ? 'false' : 'true');

  if (view === 'player') {
    setBackdrop(SEASONS[state.season].image);
    if (particleField) {
      particleField.setSeason(state.season);
      particleField.start();
    }
  } else {
    if (particleField) particleField.stop();
    setBackdrop(COVER_ART);
  }

  closeVolumePop();
  syncMini();
  updateStartPrompt();
  updateDocumentTitle();

  if (changed && !initial) {
    const focusTarget = view === 'player' ? dom.playBtn : dom.enterCurrentBtn;
    try {
      focusTarget.focus({ preventScroll: true });
    } catch (error) {
      focusTarget.focus();
    }
  }

  if (changed && pushHash && !initial) writeHash('push');
}

function updateDocumentTitle() {
  if (state.view === 'player') {
    const month = MONTHS[state.index];
    document.title = `${month.name} · ${SEASONS[month.season].name} — blz's whispers`;
  } else {
    document.title = "whispers — a musicdisk by blz";
  }
}

/* ------------------------------------------------------------------ */
/* track selection and navigation                                     */
/* ------------------------------------------------------------------ */

function monthForSeason(seasonId) {
  const current = MONTHS[state.index];
  if (current.season === seasonId) return current;
  return firstMonthOfSeason(seasonId);
}

function selectMonth(index, {
  enter = true,
  autoplay = state.hasStarted,
  updateRoute = true,
  quiet = false,
  startAt = null,
} = {}) {
  const target = getMonth(index);

  if (target.index === state.index) {
    if (enter && state.view !== 'player') setView('player');
    else if (updateRoute && state.view === 'player') writeHash('replace');

    if (autoplay && !state.playing) {
      void startPlayback({ quiet, startAt });
    }
    return;
  }

  stopCurrentPlayback();

  state.index = target.index;
  state.season = target.season;
  state.duration = getKnownDuration(target);
  state.position = 0;
  state.metaIndex = null;

  applyTrack(target);

  if (enter) {
    if (state.view !== 'player') {
      setView('player', { pushHash: updateRoute });
    } else if (updateRoute) {
      writeHash('replace');
    }
  } else if (updateRoute && state.view === 'player') {
    writeHash('replace');
  }

  if (autoplay) {
    void startPlayback({ quiet, startAt });
  }
}

function stepMonth(delta, { autoplay = state.hasStarted } = {}) {
  selectMonth(state.index + delta, {
    enter: true,
    autoplay,
  });
}

function applyTrack(month, { initial = false } = {}) {
  const season = SEASONS[month.season];

  state.season = season.id;
  state.duration = getKnownDuration(month);
  document.body.dataset.season = season.id;
  document.body.dataset.month = String(month.index);

  dom.plateSeason.textContent = `${season.numeral} · ${season.name}`;
  dom.plateMonth.textContent = month.name;
  dom.channelCount.textContent = String(getKnownChannels(month));

  setDurationUI(state.duration);
  setArt(season);
  if (particleField) particleField.setSeason(season.id);

  if (state.view === 'player') setBackdrop(season.image);

  renderMonthRail(season);
  updateActiveUI();
  updateProgress(state.position, state.duration);
  updatePlayUI();
  updateStartPrompt();
  updateDocumentTitle();

  if (initial) {
    // Kept as a hook for first-paint concerns; there is nothing async here.
  }
}

function stopCurrentPlayback() {
  state.playToken += 1;
  state.preparing = false;
  hideLoading();

  if (audio.player && (state.playing || state.loadedIndex !== null || state.ending)) {
    try {
      audio.player.stop();
    } catch (error) {
      /* The worklet may not have a module loaded. */
    }
  }

  state.playing = false;
  state.ended = false;
  state.ending = false;
  state.loadedIndex = null;
  state.metaIndex = null;
  state.position = 0;

  updatePlayUI();
  updateStartPrompt();
  syncMini();
}

/* ------------------------------------------------------------------ */
/* audio engine                                                        */
/* ------------------------------------------------------------------ */

function ensureAudio() {
  if (audio.ready) return audio.ready;

  audio.ready = new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(audio.initTimer);
      reject(error);
    };

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('This browser does not support the Web Audio API.');
      }

      const context = new AudioContextClass({ latencyHint: 'interactive' });
      if (!context.audioWorklet) {
        context.close().catch(() => {});
        throw new Error('This browser does not support AudioWorklet.');
      }

      audio.context = context;

      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.76;
      audio.analyser = analyser;
      audio.frequencyData = new Uint8Array(analyser.frequencyBinCount);

      const player = new ChiptuneJsPlayer({
        context,
        repeatCount: 0,
        stereoSeparation: 100,
        interpolationFilter: 0,
      });

      audio.player = player;
      player.gain.gain.value = state.volume / 100;
      player.gain.connect(analyser);
      analyser.connect(context.destination);

      attachPlayerHandlers(player);

      player.onInitialized(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(audio.initTimer);
        startLevelLoop();
        resolve(player);
      });

      if (context.state === 'suspended') context.resume().catch(() => {});

      audio.initTimer = window.setTimeout(() => {
        fail(new Error('The audio engine took too long to start. Reload the page and try again.'));
      }, 20000);
    } catch (error) {
      fail(error);
    }
  });

  audio.ready.catch(() => {});
  return audio.ready;
}

function attachPlayerHandlers(player) {
  player.onMetadata((meta) => handleMetadata(meta));
  player.onProgress((message) => handleProgress(message));
  player.onEnded(() => handleEnded());
  player.onError((error) => handleAudioError(error));
}

async function startPlayback({ quiet = false, startAt = null } = {}) {
  const index = state.index;
  const month = MONTHS[index];
  const offset = Number.isFinite(startAt)
    ? clamp(startAt, 0, Math.max(0, getKnownDuration(month) - 0.05))
    : 0;

  const canResume = state.loadedIndex === index
    && !state.ended
    && !state.ending
    && offset === 0;

  if (canResume) {
    try {
      const player = await ensureAudio();
      if (index !== state.index) return;
      if (audio.context.state === 'suspended') await audio.context.resume().catch(() => {});
      if (index !== state.index) return;

      player.unpause();
      state.playing = true;
      state.hasStarted = true;
      state.preparing = false;
      setLoading(false);
      updatePlayUI();
      updateStartPrompt();
      syncMini();
      return;
    } catch (error) {
      handlePlaybackFailure(error);
      return;
    }
  }

  const request = ++state.playToken;
  state.preparing = true;
  state.playing = false;
  updatePlayUI();
  updateStartPrompt();

  if (!quiet) setLoading(true, `loading ${month.name.toLowerCase()}…`);
  else setLoading(false);

  let bufferPromise = null;

  try {
    bufferPromise = getBuffer(index);
    bufferPromise.catch(() => {});

    const player = await ensureAudio();
    if (request !== state.playToken) return;

    if (audio.context.state === 'suspended') {
      await audio.context.resume().catch(() => {});
    }
    if (request !== state.playToken) return;

    const buffer = await bufferPromise;
    if (request !== state.playToken) return;

    if (audio.context.state === 'suspended') {
      await audio.context.resume().catch(() => {});
    }
    if (request !== state.playToken) return;

    state.metaIndex = index;
    state.suppressEndUntil = performance.now() + 350;
    state.ending = false;
    state.ended = false;
    state.loadedIndex = index;
    state.preparing = false;

    player.setRepeatCount(0);
    player.play(buffer);

    state.playing = true;
    state.hasStarted = true;
    state.position = offset;
    state.duration = getKnownDuration(month);

    if (offset > 0) {
      player.setPos(offset);
    }

    setDurationUI(state.duration);
    updateProgress(state.position, state.duration);
    updatePlayUI();
    updateStartPrompt();
    syncMini();

    if (!quiet) {
      window.clearTimeout(loadingFallback);
      loadingFallback = window.setTimeout(() => {
        if (request === state.playToken && state.loading) setLoading(false);
      }, 1400);
    } else {
      setLoading(false);
    }
  } catch (error) {
    if (request !== state.playToken) return;
    state.preparing = false;
    state.playing = false;
    state.loadedIndex = null;
    state.ended = false;
    state.ending = false;
    setLoading(false);
    updatePlayUI();
    updateStartPrompt();
    syncMini();
    handlePlaybackFailure(error);
  }
}

function handleMetadata(meta) {
  const index = state.metaIndex;
  if (index === null || index !== state.index) return;
  if (!meta || !Number.isFinite(meta.dur) || meta.dur <= 0) return;

  const month = MONTHS[index];
  durationCache.set(month.slug, meta.dur);

  if (Number.isFinite(meta.channelCount) && meta.channelCount > 0) {
    channelCache.set(month.slug, meta.channelCount);
    dom.channelCount.textContent = String(meta.channelCount);
  }

  state.duration = meta.dur;
  setDurationUI(meta.dur);
  updateProgress(state.position, meta.dur);
  window.clearTimeout(loadingFallback);
  setLoading(false);
}

function handleProgress(message) {
  if (state.preparing || state.ending) return;
  if (state.metaIndex === null) return;

  const position = Number(message.pos);
  if (!Number.isFinite(position)) return;

  state.position = clamp(position, 0, state.duration);
  if (!dragState) updateProgress(state.position, state.duration);
}

function handleEnded() {
  if (state.ending) return;
  if (performance.now() < state.suppressEndUntil) return;
  if (state.preparing) return;

  state.ending = true;
  state.playing = false;
  state.ended = true;
  state.position = state.duration;

  // libopenmpt reports the end on every render quantum once a song is over.
  // Destroying the module here prevents that stream of messages.
  try {
    audio.player?.stop();
  } catch (error) {
    /* Nothing loaded. */
  }

  updateProgress(state.position, state.duration);
  updatePlayUI();
  updateStartPrompt();
  syncMini();

  if (state.repeat === 'one') {
    state.ending = false;
    void startPlayback({ quiet: true });
    return;
  }

  if (state.repeat === 'all') {
    const next = (state.index + 1) % MONTHS.length;
    selectMonth(next, {
      enter: false,
      autoplay: true,
      updateRoute: true,
      quiet: true,
    });
  }
}

function handleAudioError(error) {
  const type = error && error.type;

  state.playing = false;
  state.preparing = false;
  state.ending = true;
  state.loadedIndex = null;
  state.ended = false;
  setLoading(false);
  updatePlayUI();
  updateStartPrompt();
  syncMini();

  let message = 'Playback stopped unexpectedly.';
  if (type === 'dur') message = 'libopenmpt could not read that module.';
  else if (type === 'ptr') message = 'That file is not a valid XM module.';
  else if (type === 'Process') message = 'libopenmpt hit a problem while playing that module.';

  showToast(message, 6000);
  console.warn('whispers: audio error', error);
}

function handlePlaybackFailure(error) {
  console.error('whispers: playback failed', error);

  const detail = error && typeof error.message === 'string' ? error.message : '';
  let message = 'Could not start playback. Make sure the local server is running.';

  if (/AudioWorklet|Web Audio|audio engine/i.test(detail)) {
    message = detail;
  } else if (/module/i.test(detail)) {
    message = 'Could not load that XM module. Try reloading the page.';
  }

  showToast(message, 7000);
}

function getBuffer(index) {
  const month = getMonth(index);
  const cached = bufferCache.get(month.slug);
  if (cached) return cached;

  const request = fetch(month.file, { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${month.file}`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => {
      if (!buffer || buffer.byteLength < 64) {
        throw new Error(`Empty module: ${month.file}`);
      }

      const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 17));
      if (!header.startsWith('Extended Module:')) {
        throw new Error(`Not an XM module: ${month.file}`);
      }

      return buffer;
    })
    .catch((error) => {
      bufferCache.delete(month.slug);
      throw error;
    });

  bufferCache.set(month.slug, request);
  return request;
}

function schedulePreload() {
  const warm = () => {
    // Fetch every module in a pleasant order around today's month. The files
    // are small and local; having them ready makes page turns instant.
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
    offsets.forEach((offset) => {
      getBuffer(state.index + offset).catch(() => {});
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warm, { timeout: 2600 });
  } else {
    window.setTimeout(warm, 1800);
  }
}

/* ------------------------------------------------------------------ */
/* transport, progress and levels                                     */
/* ------------------------------------------------------------------ */

async function togglePlay() {
  if (state.preparing) return;

  if (state.playing) {
    if (audio.player) audio.player.pause();
    state.playing = false;
    updatePlayUI();
    updateStartPrompt();
    syncMini();
    return;
  }

  await startPlayback();
}

function setLoading(visible, text = '') {
  state.loading = visible;

  if (visible) {
    if (text) dom.loadingText.textContent = text;
    dom.loading.hidden = false;
  } else {
    dom.loading.hidden = true;
    window.clearTimeout(loadingFallback);
    loadingFallback = 0;
  }

  updateStartPrompt();
}

function hideLoading() {
  window.clearTimeout(loadingFallback);
  loadingFallback = 0;
  state.loading = false;
  dom.loading.hidden = true;
}

function setDurationUI(duration) {
  state.duration = duration;
  dom.timeTotal.textContent = formatTime(duration);
  dom.miniTotal.textContent = formatTime(duration);
  dom.progress.setAttribute('aria-valuemax', String(Math.max(1, Math.round(duration))));
}

function updateProgress(seconds, duration = state.duration) {
  const total = Math.max(0, Number(duration) || 0);
  const value = clamp(Number(seconds) || 0, 0, total);
  const fraction = total > 0 ? value / total : 0;
  const percent = fraction * 100;

  dom.progressFill.style.width = `${percent}%`;
  if (dom.progressHandle) dom.progressHandle.style.left = `${percent}%`;
  dom.timeNow.textContent = formatTime(value);
  dom.miniNow.textContent = formatTime(value);
  dom.miniFill.style.width = `${percent}%`;

  dom.progress.setAttribute('aria-valuenow', String(Math.round(value)));
  dom.progress.setAttribute('aria-valuemax', String(Math.max(1, Math.round(total))));
  dom.progress.setAttribute('aria-valuetext', `${formatTime(value)} of ${formatTime(total)}`);
}

function updatePlayUI() {
  const icon = state.playing ? '#i-pause' : '#i-play';
  setIcon(dom.playIcon, icon);
  setIcon(dom.miniPlayIcon, icon);

  dom.playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  dom.playBtn.title = state.playing ? 'Pause (Space)' : 'Play (Space)';
  dom.miniPlayBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');

  document.body.classList.toggle('is-playing', state.playing);
  updateStartPrompt();
}

function updateStartPrompt() {
  dom.startPrompt.hidden = state.hasStarted || state.loading || state.preparing;
}

function syncMini() {
  const visible = state.hasStarted && state.view === 'cover';
  dom.miniPlayer.hidden = !visible;

  if (!visible) {
    if (volumeAnchor === dom.miniSoundBtn) closeVolumePop();
    return;
  }

  const month = MONTHS[state.index];
  dom.miniSeason.textContent = SEASONS[month.season].name;
  dom.miniTitle.textContent = month.name;
  setIcon(dom.miniPlayIcon, state.playing ? '#i-pause' : '#i-play');
  dom.miniPlayBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
}

function setIcon(svg, href) {
  const use = svg && svg.querySelector('use');
  if (use) use.setAttribute('href', href);
}

function seekTo(seconds) {
  if (!state.hasStarted) return;
  if (state.preparing || !audio.player) return;

  const total = state.duration;
  const target = clamp(seconds, 0, Math.max(0, total - 0.03));

  if (state.ended || state.ending) {
    void startPlayback({ quiet: true, startAt: target });
    return;
  }

  audio.player.setPos(target);
  state.position = target;
  updateProgress(target, total);
}

function previewSeek(seconds) {
  const total = state.duration;
  const target = clamp(seconds, 0, total);
  updateProgress(target, total);
  return target;
}

function progressFraction(event) {
  const rect = dom.progress.getBoundingClientRect();
  if (!rect.width) return 0;
  return clamp((event.clientX - rect.left) / rect.width, 0, 1);
}

function startSeeking(event) {
  if (event.button !== undefined && event.button !== 0) return;
  if (state.preparing || !state.hasStarted) return;

  const fraction = progressFraction(event);
  const target = previewSeek(fraction * state.duration);

  dragState = { pointerId: event.pointerId, seconds: target };
  dom.progress.classList.add('is-dragging');
  dom.progress.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveSeeking(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const fraction = progressFraction(event);
  dragState.seconds = previewSeek(fraction * state.duration);
}

function endSeeking(event, commit) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;

  const target = dragState.seconds;
  dragState = null;
  dom.progress.classList.remove('is-dragging');

  try {
    dom.progress.releasePointerCapture?.(event.pointerId);
  } catch (error) {
    /* Pointer capture may already be gone. */
  }

  if (commit) {
    seekTo(target);
  } else {
    updateProgress(state.position, state.duration);
  }
}

function handleProgressKeys(event) {
  if (state.preparing || !state.hasStarted) return;

  let target = state.position;
  const step = event.shiftKey ? 15 : 5;

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      target -= step;
      break;
    case 'ArrowRight':
    case 'ArrowUp':
      target += step;
      break;
    case 'PageDown':
      target -= 30;
      break;
    case 'PageUp':
      target += 30;
      break;
    case 'Home':
      target = 0;
      break;
    case 'End':
      target = state.duration;
      break;
    default:
      return;
  }

  event.preventDefault();
  event.stopPropagation();
  seekTo(target);
}

function startLevelLoop() {
  if (!audio.analyser || audio.levelRaf) return;

  const bars = Array.from(dom.levels.children);
  const data = audio.frequencyData;

  const tick = () => {
    audio.levelRaf = window.requestAnimationFrame(tick);

    if (document.hidden || state.view !== 'player') {
      bars.forEach((bar) => { bar.style.height = '3px'; });
      return;
    }

    if (!state.playing) {
      bars.forEach((bar) => { bar.style.height = '3px'; });
      return;
    }

    audio.analyser.getByteFrequencyData(data);

    const bins = Math.min(data.length, 110);
    const bands = bars.length;

    bars.forEach((bar, index) => {
      const start = Math.floor(Math.pow(index / bands, 1.7) * bins);
      const end = Math.max(start + 1, Math.floor(Math.pow((index + 1) / bands, 1.7) * bins));
      let sum = 0;

      for (let bin = start; bin < end; bin += 1) sum += data[bin];

      const average = sum / (end - start) / 255;
      const height = 3 + Math.pow(Math.min(1, average * 1.65), 1.2) * 14;
      bar.style.height = `${height.toFixed(1)}px`;
    });
  };

  audio.levelRaf = window.requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ */
/* volume                                                              */
/* ------------------------------------------------------------------ */

function setVolume(value, { announce = false, message = '' } = {}) {
  const level = clamp(Math.round(Number(value) || 0), 0, 100);

  if (level > 0) state.preMuteVolume = level;
  state.volume = level;

  if (audio.player && audio.context) {
    const gain = level / 100;
    const now = audio.context.currentTime;
    try {
      audio.player.gain.gain.setTargetAtTime(gain, now, 0.015);
    } catch (error) {
      audio.player.gain.gain.value = gain;
    }
  }

  setVolumeUI();
  storeVolume(level);

  if (announce) {
    showToast(message || (level === 0 ? 'muted' : `volume ${level}%`));
  }
}

function setVolumeUI() {
  dom.volumeRange.value = String(state.volume);
  dom.volumeOut.textContent = String(state.volume);

  const icon = state.volume === 0
    ? '#i-volume-mute'
    : state.volume < 50
      ? '#i-volume-low'
      : '#i-volume';

  [dom.soundBtn, dom.miniSoundBtn, dom.volumeMuteBtn].forEach((button) => {
    setIcon(button, icon);
  });

  const description = state.volume === 0 ? 'Muted' : `Volume ${state.volume}%`;
  dom.soundBtn.setAttribute('aria-label', state.volume === 0 ? 'Unmute' : 'Volume');
  dom.miniSoundBtn.setAttribute('aria-label', state.volume === 0 ? 'Unmute' : 'Volume');
  dom.volumeMuteBtn.setAttribute('aria-label', state.volume === 0 ? 'Unmute' : 'Mute');
  dom.soundBtn.title = description;
  dom.miniSoundBtn.title = description;
  dom.volumeMuteBtn.title = state.volume === 0 ? 'Unmute' : 'Mute';
}

function toggleMute() {
  if (state.volume > 0) {
    state.preMuteVolume = state.volume;
    setVolume(0, { announce: true, message: 'muted' });
  } else {
    setVolume(state.preMuteVolume || 75, { announce: true, message: 'sound on' });
  }
}

function toggleVolumePop(anchor) {
  const open = !dom.volumePop.hidden && dom.volumePop.classList.contains('is-open');

  if (open && volumeAnchor === anchor) {
    closeVolumePop();
    return;
  }

  openVolumePop(anchor);
}

function openVolumePop(anchor) {
  window.clearTimeout(volumeTimer);
  volumeAnchor = anchor;
  setVolumeExpanded(anchor);

  if (dom.volumePop.hidden) {
    dom.volumePop.hidden = false;
    dom.volumePop.classList.remove('is-open');
  }

  positionVolumePop(anchor);
  window.requestAnimationFrame(() => {
    dom.volumePop.classList.add('is-open');
  });
}

function closeVolumePop() {
  if (dom.volumePop.hidden && !dom.volumePop.classList.contains('is-open')) return;

  dom.volumePop.classList.remove('is-open');
  setVolumeExpanded(null);
  volumeAnchor = null;
  window.clearTimeout(volumeTimer);

  volumeTimer = window.setTimeout(() => {
    if (!dom.volumePop.classList.contains('is-open')) dom.volumePop.hidden = true;
  }, 260);
}

function setVolumeExpanded(anchor) {
  [dom.soundBtn, dom.miniSoundBtn].forEach((button) => {
    button.setAttribute('aria-expanded', button === anchor ? 'true' : 'false');
  });
}

function positionVolumePop(anchor) {
  if (!anchor || dom.volumePop.hidden) return;

  const margin = 12;
  const gap = 10;
  const rect = anchor.getBoundingClientRect();
  const width = dom.volumePop.offsetWidth || 250;
  const height = dom.volumePop.offsetHeight || 46;

  let left = rect.left + rect.width / 2 - width / 2;
  left = clamp(left, margin, Math.max(margin, window.innerWidth - width - margin));

  let top = rect.top > height + margin * 2
    ? rect.top - height - gap
    : rect.bottom + gap;

  if (top + height > window.innerHeight - margin) {
    top = rect.top - height - gap;
  }
  top = clamp(top, margin, Math.max(margin, window.innerHeight - height - margin));

  dom.volumePop.style.left = `${Math.round(left)}px`;
  dom.volumePop.style.top = `${Math.round(top)}px`;
}

/* ------------------------------------------------------------------ */
/* repeat, fullscreen, dialog and toast                              */
/* ------------------------------------------------------------------ */

function setRepeatMode(mode, { announce = false } = {}) {
  if (!REPEAT_MODES.includes(mode)) return;

  state.repeat = mode;
  const badge = mode === 'all' ? '∞' : mode === 'one' ? '1' : '–';
  dom.repeatBtn.dataset.mode = mode;
  dom.repeatBadge.textContent = badge;
  dom.repeatBtn.setAttribute('aria-label', `Repeat: ${REPEAT_LABELS[mode]}`);
  dom.repeatBtn.title = `Repeat: ${REPEAT_LABELS[mode]} (R)`;

  if (announce) showToast(`repeat: ${REPEAT_LABELS[mode]}`);
}

function cycleRepeat() {
  const index = REPEAT_MODES.indexOf(state.repeat);
  setRepeatMode(REPEAT_MODES[(index + 1) % REPEAT_MODES.length], { announce: true });
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      if (!document.documentElement.requestFullscreen) {
        throw new Error('Fullscreen is not supported in this browser.');
      }
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    showToast('Fullscreen is not available in this browser.', 4200);
  }
}

function syncFullscreenUI() {
  const active = Boolean(document.fullscreenElement);
  setIcon(dom.fullscreenBtn, active ? '#i-compress' : '#i-fullscreen');
  dom.fullscreenBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  dom.fullscreenBtn.title = active ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
}

function openAbout() {
  if (!dom.aboutDialog.open) {
    if (typeof dom.aboutDialog.showModal === 'function') dom.aboutDialog.showModal();
    else dom.aboutDialog.setAttribute('open', '');
  }
}

function showToast(message, duration = 2800) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');

  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, duration);
}

/* ------------------------------------------------------------------ */
/* particles                                                           */
/* ------------------------------------------------------------------ */

function setupParticles() {
  if (!dom.particles) return;

  particleField = new ParticleField(dom.particles, {
    reducedMotion: motionQuery.matches,
  });
  particleField.setSeason(state.season);

  if (state.view === 'player') particleField.start();

  const onMotionPreference = (event) => {
    particleField.setReducedMotion(event.matches);
    if (!event.matches && state.view === 'player') particleField.start();
  };

  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', onMotionPreference);
  } else if (typeof motionQuery.addListener === 'function') {
    motionQuery.addListener(onMotionPreference);
  }
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  dom.enterCurrentBtn.addEventListener('click', () => {
    setView('player');
  });

  dom.seasonIndex.addEventListener('click', (event) => {
    const chip = event.target.closest('.track-chip');
    if (chip) {
      selectMonth(Number(chip.dataset.monthIndex), {
        enter: true,
        autoplay: true,
      });
      return;
    }

    const opener = event.target.closest('[data-open-season]');
    if (opener) {
      const month = monthForSeason(opener.dataset.openSeason);
      selectMonth(month.index, {
        enter: true,
        autoplay: state.hasStarted,
      });
    }
  });

  dom.seasonRail.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open-season]');
    if (!opener) return;

    const month = monthForSeason(opener.dataset.openSeason);
    selectMonth(month.index, {
      enter: true,
      autoplay: state.hasStarted,
    });
  });

  dom.monthRail.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-month-index]');
    if (!opener) return;

    selectMonth(Number(opener.dataset.monthIndex), {
      enter: true,
      autoplay: state.hasStarted,
    });
  });

  [dom.railCoverBtn, dom.railCoverBtn2, dom.homeBtn].forEach((button) => {
    button.addEventListener('click', () => setView('cover'));
  });

  dom.prevMonthBtn.addEventListener('click', () => stepMonth(-1));
  dom.nextMonthBtn.addEventListener('click', () => stepMonth(1));
  dom.prevBtn.addEventListener('click', () => stepMonth(-1));
  dom.nextBtn.addEventListener('click', () => stepMonth(1));

  dom.playBtn.addEventListener('click', () => { void togglePlay(); });
  dom.miniPlayBtn.addEventListener('click', () => { void togglePlay(); });
  dom.startPrompt.addEventListener('click', () => { void startPlayback(); });

  dom.repeatBtn.addEventListener('click', cycleRepeat);
  dom.fullscreenBtn.addEventListener('click', () => { void toggleFullscreen(); });

  dom.soundBtn.addEventListener('click', () => toggleVolumePop(dom.soundBtn));
  dom.miniSoundBtn.addEventListener('click', () => toggleVolumePop(dom.miniSoundBtn));

  dom.volumeMuteBtn.addEventListener('click', toggleMute);
  dom.volumeRange.addEventListener('input', () => {
    setVolume(Number(dom.volumeRange.value));
  });

  dom.miniOpenBtn.addEventListener('click', () => setView('player'));
  dom.miniOpenArrowBtn.addEventListener('click', () => setView('player'));

  dom.aboutBtn.addEventListener('click', openAbout);
  dom.aboutDialog.addEventListener('click', (event) => {
    if (event.target === dom.aboutDialog) dom.aboutDialog.close();
  });

  dom.secretDot.addEventListener('click', () => {
    const hidden = dom.secretText.hidden;
    dom.secretText.hidden = !hidden;
    dom.secretDot.setAttribute('aria-expanded', hidden ? 'true' : 'false');
  });

  dom.progress.addEventListener('pointerdown', startSeeking);
  dom.progress.addEventListener('pointermove', moveSeeking);
  dom.progress.addEventListener('pointerup', (event) => endSeeking(event, true));
  dom.progress.addEventListener('pointercancel', (event) => endSeeking(event, false));
  dom.progress.addEventListener('keydown', handleProgressKeys);

  dom.painting.addEventListener('pointermove', (event) => {
    if (!particleField || event.pointerType === 'touch') return;
    const rect = dom.painting.getBoundingClientRect();
    if (!rect.width) return;
    particleField.setWind((event.clientX - rect.left) / rect.width);
  });

  dom.painting.addEventListener('pointerleave', () => {
    if (particleField) particleField.setWind(0.5);
  });

  document.addEventListener('pointerdown', (event) => {
    if (dom.volumePop.hidden) return;
    if (event.target.closest('#volumePop, #soundBtn, #miniSoundBtn')) return;
    closeVolumePop();
  }, true);

  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('fullscreenchange', syncFullscreenUI);
  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('popstate', handleHashChange);

  window.addEventListener('resize', () => {
    if (!dom.volumePop.hidden) positionVolumePop(volumeAnchor);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (particleField) particleField.stop();
      return;
    }

    if (state.view === 'player' && particleField) particleField.start();
    if (state.playing && audio.context && audio.context.state === 'suspended') {
      audio.context.resume().catch(() => {});
    }
  });

  const warmAudio = () => {
    ensureAudio().catch(() => {});
  };
  document.addEventListener('pointerdown', warmAudio, { once: true, passive: true, capture: true });
  document.addEventListener('keydown', warmAudio, { once: true, capture: true });
}

function handleKeyDown(event) {
  if (dom.aboutDialog.open) return;

  const target = event.target;
  const isFormField = target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  const isInteractive = target instanceof Element
    && Boolean(target.closest('button, a, [role="button"], [role="slider"]'));

  if (event.key === 'Escape') {
    if (!dom.volumePop.hidden) {
      closeVolumePop();
      event.preventDefault();
      return;
    }

    if (document.fullscreenElement) return;

    if (state.view === 'player') {
      setView('cover');
      event.preventDefault();
    }
    return;
  }

  if (isFormField) return;

  if (event.key === ' ' || event.code === 'Space') {
    if (isInteractive) return;
    if (state.view !== 'player' && !state.hasStarted) return;
    event.preventDefault();
    void togglePlay();
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (state.view !== 'player') return;
    event.preventDefault();
    stepMonth(event.key === 'ArrowLeft' ? -1 : 1);
    return;
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    setVolume(state.volume + (event.key === 'ArrowUp' ? 5 : -5), { announce: true });
    return;
  }

  if (event.key === 'm' || event.key === 'M') {
    event.preventDefault();
    toggleMute();
    return;
  }

  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    cycleRepeat();
    return;
  }

  if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    void toggleFullscreen();
  }
}
