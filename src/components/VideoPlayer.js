/**
 * TFlix 10-Foot TV Native Video Player Component
 * Powered by Hls.js and HTML5 Video.
 * Designed specifically for Samsung Tizen TV remote controls and spatial navigation.
 */

import Hls from 'hls.js';
import { nav, TIZEN_KEYS } from '../nav/spatialNav.js';
import { storage } from '../store/storage.js';
import { EpisodeDrawer } from './EpisodeDrawer.js';
import { getProviders, isDirectProvider } from '../api/providers.js';
import { icon } from '../ui/icons.js';
import { openServerMenu } from '../ui/serverMenu.js';

export class VideoPlayer {
  constructor({ media, streamUrl, providerId, subtitles = [], nativeMode = false, onNextEpisode, onClose, onSwitchToEmbed, onSwitchProvider, onFallback, onWrongMatch }) {
    this.media = media; // { id, media_type, title, season, episode, ... }
    this.streamUrl = streamUrl;
    this.providerId = providerId || '';
    this.subtitles = subtitles; // array of { label, lang, src }
    // See PlayerModal.js's nativeMode doc comment — hides every TMDB-anchored
    // in-player control (server switch, wrong-match, episode drawer,
    // auto-next-episode) that has no meaning for a single confirmed native item.
    this.nativeMode = nativeMode;
    this.onNextEpisode = onNextEpisode;
    this.onClose = onClose;
    this.onSwitchToEmbed = onSwitchToEmbed;
    this.onSwitchProvider = onSwitchProvider;
    this.onFallback = onFallback;
    this.onWrongMatch = onWrongMatch;
    // Excludes catalogMode: 'native' providers from the switch-server menu —
    // see docs/PROVIDER_PACKS.md's "Native catalogs" §0.7.
    this.providers = getProviders().filter(p => p.catalogMode !== 'native');

    this.containerEl = null;
    this.videoEl = null;
    this.hls = null;
    this.hudEl = null;
    this.hudTimer = null;
    this.activeDrawer = null;
    this.progressSaveInterval = null;
    this.nextEpCountdownTimer = null;
    this.streamTimeoutTimer = null;
    this.hasLoadedMetadata = false;
    this.isFallingBack = false;
    this.networkRetryCount = 0;
    this.mediaRetryCount = 0;
    this.isScrubbing = false;
    this.scrubTime = 0;

    this.backHandler = this.handleBack.bind(this);
    this.mediaKeyHandler = this.handleMediaKey.bind(this);
    this.activityHandler = this.wakeHud.bind(this);
    this.keyHandler = this.handleGeneralKey.bind(this);
  }

  render() {
    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    const season = this.media.season || 1;
    const episode = this.media.episode || 1;
    const title = this.media.title || this.media.name || 'Playing Media';

    this.containerEl = document.createElement('div');
    this.containerEl.className = 'native-player-screen';

    this.containerEl.innerHTML = `
      <video id="native-video-elem" class="native-video" playsinline preload="auto"></video>

      <!-- Center Feedback Badge (Play/Pause/Seek/Volume Icon) -->
      <div class="player-center-badge" id="player-center-badge">
        <div class="badge-icon" id="center-badge-icon">${icon('play', { size: 28 })}</div>
        <div class="badge-text" id="center-badge-text">Playing</div>
      </div>

      <!-- Toast Notification (Resume / Track Changed) -->
      <div class="player-toast" id="player-toast"></div>

      <!-- Full TV On-Screen Display (OSD HUD) -->
      <div class="native-player-hud" id="native-player-hud">
        
        <!-- Top Title Bar -->
        <div class="hud-top-bar">
          <div class="hud-title-info">
            <h2 class="hud-main-title">${title}</h2>
            <p class="hud-sub-title">
              ${isTv ? `Season ${season} • Episode ${episode}` : 'Movie'} 
              <span class="hud-badge-tag">NATIVE TV PLAYER</span>
            </p>
          </div>
          <div class="hud-top-actions">
            ${!this.nativeMode ? `
              <button class="btn btn-secondary btn-sm focusable" id="btn-native-server-select" title="Change Server">
                ${icon('server', { size: 16 })}
              </button>
            ` : ''}
            ${isTv && !this.nativeMode ? `
              <button class="btn btn-secondary btn-sm focusable" id="btn-tv-next-ep" title="Next Episode">
                ${icon('skip-forward', { size: 16 })}
              </button>
              <button class="btn btn-secondary btn-sm focusable" id="btn-tv-episodes-drawer" title="Browse Episodes">
                ${icon('list-video', { size: 16 })}
              </button>
            ` : ''}
            <button class="btn btn-secondary btn-sm focusable" id="btn-hud-close" title="Exit Player">
              ${icon('x', { size: 16 })}
            </button>
          </div>
        </div>

        <!-- Bottom Controls & Timeline Bar -->
        <div class="hud-bottom-bar">

          <!-- Timeline Scrubber -->
          <div class="timeline-wrapper">
            <span class="time-label" id="time-current">00:00:00</span>
            <div class="timeline-track focusable" id="player-timeline" tabindex="0" role="slider" aria-label="Seek Bar" data-lock-horizontal="1" data-manual-enter="1">
              <div class="timeline-buffered" id="timeline-buffered"></div>
              <div class="timeline-progress" id="timeline-progress"></div>
              <div class="timeline-thumb" id="timeline-thumb"></div>
            </div>
            <span class="time-label" id="time-duration">00:00:00</span>
          </div>

          <!-- Bottom Button Row -->
          <div class="hud-buttons-row">
            <div class="hud-button-group">
              <button class="btn btn-secondary focusable" id="btn-tv-rewind" title="Rewind 10 Seconds">
                <span>${icon('rewind', { size: 16 })}</span> -10s
              </button>
              <button class="btn btn-primary focusable primary-focus" id="btn-tv-playpause" title="Play / Pause">
                <span id="playpause-icon">${icon('pause', { size: 20 })}</span>
              </button>
              <button class="btn btn-secondary focusable" id="btn-tv-fastforward" title="Fast Forward 10 Seconds">
                <span>${icon('fast-forward', { size: 16 })}</span> +10s
              </button>
            </div>

            <div class="hud-button-group">
              <button class="btn btn-secondary focusable" id="btn-tv-subtitles" title="Subtitles & Audio">
                ${icon('captions', { size: 16 })} Subtitles
              </button>
              ${(!this.nativeMode && this.currentProviderSupportsFuzzyMatch()) ? `
                <button class="btn btn-secondary focusable" id="btn-wrong-match" title="Wrong show or movie? Fix it">
                  ${icon('flag', { size: 16 })}
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>

      <!-- TV Subtitles & Audio Modal -->
      <div class="player-modal-dialog hidden" id="subtitles-dialog">
        <div class="dialog-card">
          <div class="dialog-header">
            <h3>Subtitles & Audio</h3>
            <button class="btn btn-secondary btn-sm focusable" id="btn-close-subtitles-dialog">${icon('x', { size: 16 })}</button>
          </div>
          <div class="dialog-section">
            <div class="dialog-label">Subtitles Track</div>
            <div class="dialog-options-list" id="subtitles-track-list">
              <button class="dialog-opt-btn focusable active" data-track="-1">Off</button>
            </div>
          </div>
          <div class="dialog-section">
            <div class="dialog-label">Audio Track</div>
            <div class="dialog-options-list" id="audio-track-list">
              <button class="dialog-opt-btn focusable active" data-audio="-1">Default Audio</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Next Episode Auto-Countdown Card -->
      <div class="next-ep-card hidden" id="next-ep-countdown-card">
        <div class="next-ep-info">
          <div class="next-ep-tag">UP NEXT</div>
          <div class="next-ep-title" id="next-ep-title-text">Playing next episode...</div>
          <div class="next-ep-timer-text" id="next-ep-timer-text">Starting in 5 seconds</div>
        </div>
        <div class="next-ep-actions">
          <button class="btn btn-primary focusable" id="btn-next-ep-now">Play Now</button>
          <button class="btn btn-secondary focusable" id="btn-next-ep-cancel">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.containerEl);
    this.videoEl = this.containerEl.querySelector('#native-video-elem');
    this.hudEl = this.containerEl.querySelector('#native-player-hud');

    // Unmute & set initial default volume
    this.videoEl.volume = 1.0;
    this.videoEl.muted = false;

    // Attach listeners
    this.setupVideoEvents();
    this.setupHudButtons();
    this.setupTimelineScrubber();
    this.loadStreamSource(this.streamUrl);

    // Register with Spatial Navigation
    nav.setScope(this.containerEl);
    nav.pushBackHandler(this.backHandler);
    nav.pushMediaKeyHandler(this.mediaKeyHandler);

    window.addEventListener('keydown', this.activityHandler, { capture: true });
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('mousemove', this.activityHandler);

    // Focus default button (Play/Pause)
    const playPauseBtn = this.containerEl.querySelector('#btn-tv-playpause');
    if (playPauseBtn) {
      nav.setFocus(playPauseBtn);
    }

    // Start auto progress saver
    this.progressSaveInterval = setInterval(() => {
      this.saveCurrentProgress();
    }, 3000);

    // Fade out HUD automatically after 2.5s initial display
    this.resetHudTimer(2500);
    return this.containerEl;
  }

  getProviderName() {
    const p = (this.providers || []).find(x => x.id === this.providerId);
    return p ? p.name : this.providerId || 'Direct Stream';
  }

  // Only providers that have to guess an identity match (see
  // docs/PROVIDER_PACKS.md's "Optional capabilities" — fuzzyMatch) can ever
  // have a wrong one to fix; a tmdbId/imdbId-keyed direct provider has
  // nothing this control would do.
  currentProviderSupportsFuzzyMatch() {
    const p = (this.providers || []).find(x => x.id === this.providerId);
    return Boolean(p && p.fuzzyMatch);
  }

  triggerFallback(reason = 'Stream offline') {
    if (this.isFallingBack) return;
    this.isFallingBack = true;
    clearTimeout(this.streamTimeoutTimer);
    
    const providerName = this.getProviderName();
    console.warn(`[VideoPlayer] Triggering fallback for ${providerName}. Reason: ${reason}`);
    this.showToast(
      this.nativeMode
        ? `${providerName} unavailable (${reason}).`
        : `${providerName} unavailable (${reason}). Auto-switching server...`,
      3000
    );
    
    setTimeout(() => {
      if (this.onFallback) {
        this.onFallback(this.providerId, reason);
      } else if (this.onSwitchToEmbed) {
        this.onSwitchToEmbed();
      }
    }, 800);
  }

  loadStreamSource(url) {
    if (!url) return;

    this.hasLoadedMetadata = false;
    this.isFallingBack = false;
    this.networkRetryCount = 0;
    this.mediaRetryCount = 0;
    clearTimeout(this.streamTimeoutTimer);

    // Watchdog timer: if stream fails to start within 15 seconds, trigger auto-fallback
    const STREAM_TIMEOUT_MS = 15000;
    this.streamTimeoutTimer = setTimeout(() => {
      if (!this.hasLoadedMetadata && !this.isFallingBack) {
        console.warn(`[VideoPlayer] Direct stream took too long (>15s) on provider: ${this.providerId}`);
        this.triggerFallback('Timeout (Server slow/offline)');
      }
    }, STREAM_TIMEOUT_MS);

    // Attach external subtitles if provided
    if (this.videoEl && Array.isArray(this.subtitles) && this.subtitles.length > 0) {
      const oldTracks = this.videoEl.querySelectorAll('track');
      oldTracks.forEach(t => t.remove());

      this.subtitles.forEach((sub, idx) => {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = sub.label || `Subtitle ${idx + 1}`;
        track.srclang = sub.lang || 'en';
        track.src = sub.src;
        this.videoEl.appendChild(track);
      });
    }

    const isHls = url.includes('.m3u8') || url.includes('application/x-mpegURL') || url.includes('/pl/') || url.includes('master');

    if ((isHls || !url.includes('.')) && Hls.isSupported()) {
      if (this.hls) {
        this.hls.destroy();
      }
      this.hls = new Hls({
        capLevelToPlayerSize: true,
        autoStartLoad: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        }
      });

      this.hls.loadSource(url);
      this.hls.attachMedia(this.videoEl);

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hasLoadedMetadata = true;
        clearTimeout(this.streamTimeoutTimer);
        this.populateAudioAndSubtitlesTracks();
        this.checkAndResumeProgress();
        this.videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              this.networkRetryCount++;
              const isStatusError = data.response && (data.response.code >= 400 || data.response.code === 0);
              if (this.networkRetryCount > 1 || isStatusError) {
                console.error('Fatal unrecoverable network error:', data);
                this.triggerFallback(data.response?.code ? `HTTP ${data.response.code}` : 'Network error');
              } else {
                console.warn('Fatal network error encountered, attempting recovery once...', data);
                this.hls.startLoad();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.mediaRetryCount++;
              if (this.mediaRetryCount > 1) {
                this.triggerFallback('Media format decoding error');
              } else {
                console.warn('Fatal media error encountered, recovering...', data);
                this.hls.recoverMediaError();
              }
              break;
            default:
              console.error('Fatal unrecoverable HLS error:', data);
              this.triggerFallback(data.details || 'Player error');
              break;
          }
        }
      });
    } else {
      // Native HTML5 Video playback
      this.videoEl.src = url;
      this.videoEl.addEventListener('loadedmetadata', () => {
        this.hasLoadedMetadata = true;
        clearTimeout(this.streamTimeoutTimer);
        this.populateAudioAndSubtitlesTracks();
        this.checkAndResumeProgress();
        this.videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
      }, { once: true });
    }
  }

  setupVideoEvents() {
    this.videoEl.addEventListener('error', () => {
      if (!this.hasLoadedMetadata && !this.isFallingBack) {
        const code = this.videoEl.error ? this.videoEl.error.code : 'unknown';
        console.error('HTML5 video error encountered:', code);
        this.triggerFallback(`HTML5 Error (Code ${code})`);
      }
    });

    this.videoEl.addEventListener('playing', () => {
      this.hasLoadedMetadata = true;
      clearTimeout(this.streamTimeoutTimer);
    });

    this.videoEl.addEventListener('timeupdate', () => {
      if (!this.isScrubbing) {
        this.updateTimelineProgress(this.videoEl.currentTime, this.videoEl.duration);
      }
    });

    this.videoEl.addEventListener('progress', () => {
      this.updateBufferedBar();
    });

    this.videoEl.addEventListener('play', () => {
      this.updatePlayPauseButton(true);
    });

    this.videoEl.addEventListener('pause', () => {
      this.updatePlayPauseButton(false);
    });

    this.videoEl.addEventListener('ended', () => {
      this.handlePlaybackEnded();
    });
  }

  setupHudButtons() {
    const playPauseBtn = this.containerEl.querySelector('#btn-tv-playpause');
    playPauseBtn.addEventListener('click', () => this.togglePlayPause());

    const rewindBtn = this.containerEl.querySelector('#btn-tv-rewind');
    rewindBtn.addEventListener('click', () => this.seekBy(-10));

    const ffBtn = this.containerEl.querySelector('#btn-tv-fastforward');
    ffBtn.addEventListener('click', () => this.seekBy(10));

    const subBtn = this.containerEl.querySelector('#btn-tv-subtitles');
    subBtn.addEventListener('click', () => this.toggleSubtitlesDialog());

    const closeSubBtn = this.containerEl.querySelector('#btn-close-subtitles-dialog');
    if (closeSubBtn) {
      closeSubBtn.addEventListener('click', () => this.toggleSubtitlesDialog(false));
    }

    const drawerBtn = this.containerEl.querySelector('#btn-tv-episodes-drawer');
    if (drawerBtn) {
      drawerBtn.addEventListener('click', () => {
        this.openEpisodeDrawer();
      });
    }

    const nextEpBtn = this.containerEl.querySelector('#btn-tv-next-ep');
    if (nextEpBtn) {
      nextEpBtn.addEventListener('click', () => this.triggerNextEpisode());
    }

    const serverBtn = this.containerEl.querySelector('#btn-native-server-select');
    if (serverBtn) {
      serverBtn.addEventListener('click', () => {
        openServerMenu({
          providers: this.providers || [],
          currentId: this.providerId,
          onSelect: (selectedId) => {
            this.saveCurrentProgress();
            if (this.onSwitchProvider) {
              this.onSwitchProvider(selectedId);
            } else if (isDirectProvider(selectedId)) {
              this.showToast(`Switched to ${selectedId}`, 2500);
              this.loadStreamSource(this.streamUrl);
            } else if (this.onSwitchToEmbed) {
              this.onSwitchToEmbed(selectedId);
            }
            if (this.containerEl) nav.setScope(this.containerEl);
          }
        });
      });
    }

    const wrongMatchBtn = this.containerEl.querySelector('#btn-wrong-match');
    if (wrongMatchBtn) {
      wrongMatchBtn.addEventListener('click', () => {
        if (this.onWrongMatch) this.onWrongMatch();
      });
    }

    const closeBtn = this.containerEl.querySelector('#btn-hud-close');
    closeBtn.addEventListener('click', () => this.close());

    // Next Episode Card Buttons
    const nextNowBtn = this.containerEl.querySelector('#btn-next-ep-now');
    if (nextNowBtn) {
      nextNowBtn.addEventListener('click', () => this.triggerNextEpisode());
    }

    const nextCancelBtn = this.containerEl.querySelector('#btn-next-ep-cancel');
    if (nextCancelBtn) {
      nextCancelBtn.addEventListener('click', () => this.cancelNextEpCountdown());
    }
  }

  setupTimelineScrubber() {
    const timeline = this.containerEl.querySelector('#player-timeline');
    if (!timeline) return;

    timeline.addEventListener('keydown', (e) => {
      if (e.keyCode === TIZEN_KEYS.LEFT || e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        this.scrubBy(-10);
      } else if (e.keyCode === TIZEN_KEYS.RIGHT || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.scrubBy(10);
      } else if (e.keyCode === TIZEN_KEYS.ENTER || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.commitScrub();
      }
    });

    // Losing focus (HUD auto-hide, D-Pad navigating elsewhere) discards any
    // pending scrub rather than silently committing it.
    timeline.addEventListener('blur', () => this.cancelScrub());

    // Mouse / Touch scrub support — a pointer click is an intentional,
    // precise target, so it commits immediately (no separate confirm step).
    timeline.addEventListener('click', (e) => {
      const rect = timeline.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (this.videoEl && this.videoEl.duration) {
        this.isScrubbing = false;
        timeline.classList.remove('scrubbing-pending');
        this.videoEl.currentTime = pos * this.videoEl.duration;
      }
    });
  }

  /** Moves the pending (not-yet-committed) scrub position by deltaSeconds. */
  scrubBy(deltaSeconds) {
    if (!this.videoEl || isNaN(this.videoEl.duration)) return;
    if (!this.isScrubbing) {
      this.isScrubbing = true;
      this.scrubTime = this.videoEl.currentTime;
    }
    this.scrubTime = Math.max(0, Math.min(this.videoEl.duration, this.scrubTime + deltaSeconds));
    this.updateTimelineProgress(this.scrubTime, this.videoEl.duration);
    const timeline = this.containerEl.querySelector('#player-timeline');
    if (timeline) timeline.classList.add('scrubbing-pending');
    const timeCurrentEl = this.containerEl.querySelector('#time-current');
    if (timeCurrentEl) timeCurrentEl.classList.add('scrub-pending');
    this.wakeHud();
  }

  /** Commits the pending scrub (OK on the timeline); toggles play/pause if nothing was pending. */
  commitScrub() {
    if (!this.isScrubbing) {
      this.togglePlayPause();
      return;
    }
    this.videoEl.currentTime = this.scrubTime;
    this.isScrubbing = false;
    const timeline = this.containerEl.querySelector('#player-timeline');
    if (timeline) timeline.classList.remove('scrubbing-pending');
    const timeCurrentEl = this.containerEl.querySelector('#time-current');
    if (timeCurrentEl) timeCurrentEl.classList.remove('scrub-pending');
    this.wakeHud();
  }

  /** Discards a pending scrub without seeking. */
  cancelScrub() {
    if (!this.isScrubbing) return;
    this.isScrubbing = false;
    if (this.videoEl) this.updateTimelineProgress(this.videoEl.currentTime, this.videoEl.duration);
    const timeline = this.containerEl.querySelector('#player-timeline');
    if (timeline) timeline.classList.remove('scrubbing-pending');
    const timeCurrentEl = this.containerEl.querySelector('#time-current');
    if (timeCurrentEl) timeCurrentEl.classList.remove('scrub-pending');
  }

  handleGeneralKey() {
    // Reserved for future non-media general key handling. Volume is fixed
    // at max here — the TV's own hardware volume controls playback level.
  }

  updateTimelineProgress(current, duration) {
    const timeCurrentEl = this.containerEl.querySelector('#time-current');
    const timeDurationEl = this.containerEl.querySelector('#time-duration');
    const progressEl = this.containerEl.querySelector('#timeline-progress');
    const thumbEl = this.containerEl.querySelector('#timeline-thumb');

    if (!timeCurrentEl || !timeDurationEl || !progressEl || !thumbEl) return;

    const cur = typeof current === 'number' && !isNaN(current) ? current : 0;
    const dur = typeof duration === 'number' && !isNaN(duration) && duration > 0 ? duration : 0;

    timeCurrentEl.textContent = this.formatTime(cur);
    timeDurationEl.textContent = this.formatTime(dur);

    const percent = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    progressEl.style.width = `${percent}%`;
    thumbEl.style.left = `${percent}%`;
  }

  updateBufferedBar() {
    const bufferedEl = this.containerEl.querySelector('#timeline-buffered');
    if (!bufferedEl || !this.videoEl || !this.videoEl.duration) return;

    const duration = this.videoEl.duration;
    const buffered = this.videoEl.buffered;

    if (buffered.length > 0) {
      const bufferedEnd = buffered.end(buffered.length - 1);
      const percent = Math.min(100, (bufferedEnd / duration) * 100);
      bufferedEl.style.width = `${percent}%`;
    }
  }

  togglePlayPause() {
    if (!this.videoEl) return;
    if (this.videoEl.paused || this.videoEl.ended) {
      this.videoEl.play();
      this.showCenterBadge('play', 'Play');
    } else {
      this.videoEl.pause();
      this.showCenterBadge('pause', 'Pause');
    }
    this.wakeHud();
  }

  seekBy(deltaSeconds) {
    if (!this.videoEl || isNaN(this.videoEl.duration)) return;
    const newTime = Math.max(0, Math.min(this.videoEl.duration || Infinity, this.videoEl.currentTime + deltaSeconds));
    this.videoEl.currentTime = newTime;

    if (deltaSeconds > 0) {
      this.showCenterBadge('fast-forward', `+${deltaSeconds}s`);
    } else {
      this.showCenterBadge('rewind', `${deltaSeconds}s`);
    }
    this.wakeHud();
  }

  updatePlayPauseButton(isPlaying) {
    const iconEl = this.containerEl.querySelector('#playpause-icon');
    if (iconEl) {
      iconEl.innerHTML = icon(isPlaying ? 'pause' : 'play', { size: 20 });
    }
    const playPauseBtn = this.containerEl.querySelector('#btn-tv-playpause');
    if (playPauseBtn) playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
  }

  showCenterBadge(iconName, text) {
    const badge = this.containerEl.querySelector('#player-center-badge');
    const badgeIcon = this.containerEl.querySelector('#center-badge-icon');
    const badgeText = this.containerEl.querySelector('#center-badge-text');

    if (!badge || !badgeIcon || !badgeText) return;

    badgeIcon.innerHTML = icon(iconName, { size: 28 });
    badgeText.textContent = text;

    badge.classList.remove('active');
    void badge.offsetWidth; // Trigger reflow
    badge.classList.add('active');

    setTimeout(() => {
      badge.classList.remove('active');
    }, 900);
  }

  showToast(message, duration = 3000) {
    const toast = this.containerEl.querySelector('#player-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('active');

    setTimeout(() => {
      toast.classList.remove('active');
    }, duration);
  }

  // See PlayerModal.js's getStorageId() doc comment — a native TV item's
  // media.id is the episode's own id, not stable across episodes, so
  // storage keys on nativeShowId instead when present.
  getStorageId() {
    return (this.nativeMode && this.media.nativeShowId) ? this.media.nativeShowId : this.media.id;
  }

  checkAndResumeProgress() {
    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    const season = this.media.season || 1;
    const episode = this.media.episode || 1;

    const progress = storage.getProgress(this.media.source || 'tmdb', this.getStorageId(), season, episode);
    if (progress && progress.currentTime > 15 && (!progress.duration || progress.currentTime < progress.duration * 0.92)) {
      this.videoEl.currentTime = progress.currentTime;
      this.showToast(`Resumed playback at ${this.formatTime(progress.currentTime)}`, 3500);
    }
  }

  saveCurrentProgress() {
    if (!this.videoEl || !this.media || !this.media.id) return;
    const currentTime = this.videoEl.currentTime;
    const duration = this.videoEl.duration;
    if (currentTime > 5 && duration > 0) {
      const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
      const season = this.media.season || 1;
      const episode = this.media.episode || 1;
      storage.updateProgress(this.media.source || 'tmdb', this.getStorageId(), season, episode, currentTime, duration);
    }
  }

  handlePlaybackEnded() {
    this.saveCurrentProgress();
    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    // Skipped in nativeMode: incrementing `episode` blindly would guess at
    // the pack's own next-episode id, which isn't guaranteed sequential —
    // see PlayerModal.js's nativeMode doc comment.
    if (isTv && this.onNextEpisode && !this.nativeMode) {
      this.startNextEpCountdown();
    }
  }

  startNextEpCountdown() {
    const card = this.containerEl.querySelector('#next-ep-countdown-card');
    const timerText = this.containerEl.querySelector('#next-ep-timer-text');
    const titleText = this.containerEl.querySelector('#next-ep-title-text');

    if (!card || !timerText) return;

    const nextEpNum = (this.media.episode || 1) + 1;
    if (titleText) {
      titleText.textContent = `Season ${this.media.season || 1} • Episode ${nextEpNum}`;
    }

    card.classList.remove('hidden');
    nav.setScope(card);

    let secondsRemaining = 5;
    timerText.textContent = `Starting in ${secondsRemaining}s...`;

    clearInterval(this.nextEpCountdownTimer);
    this.nextEpCountdownTimer = setInterval(() => {
      secondsRemaining -= 1;
      if (secondsRemaining <= 0) {
        clearInterval(this.nextEpCountdownTimer);
        this.triggerNextEpisode();
      } else {
        timerText.textContent = `Starting in ${secondsRemaining}s...`;
      }
    }, 1000);
  }

  cancelNextEpCountdown() {
    clearInterval(this.nextEpCountdownTimer);
    const card = this.containerEl.querySelector('#next-ep-countdown-card');
    if (card) {
      card.classList.add('hidden');
    }
    nav.setScope(this.containerEl);
  }

  triggerNextEpisode() {
    clearInterval(this.nextEpCountdownTimer);
    if (this.onNextEpisode) {
      const nextMedia = {
        ...this.media,
        episode: (this.media.episode || 1) + 1
      };
      this.close();
      this.onNextEpisode(nextMedia);
    }
  }

  populateAudioAndSubtitlesTracks() {
    const subList = this.containerEl.querySelector('#subtitles-track-list');
    const audioList = this.containerEl.querySelector('#audio-track-list');

    if (subList) {
      subList.innerHTML = `<button class="dialog-opt-btn focusable active" data-track="-1">Off</button>`;

      const offBtn = subList.querySelector('button[data-track="-1"]');
      offBtn.addEventListener('click', () => {
        if (this.hls) this.hls.subtitleTrack = -1;
        if (this.videoEl && this.videoEl.textTracks) {
          for (let i = 0; i < this.videoEl.textTracks.length; i++) {
            this.videoEl.textTracks[i].mode = 'disabled';
          }
        }
        subList.querySelectorAll('.dialog-opt-btn').forEach(b => b.classList.remove('active'));
        offBtn.classList.add('active');
        this.showToast('Subtitles Off', 2000);
        this.toggleSubtitlesDialog(false);
      });

      // 1. In-manifest Hls.js subtitle tracks
      if (this.hls) {
        const subTracks = this.hls.subtitleTracks || [];
        subTracks.forEach((track, index) => {
          const btn = document.createElement('button');
          btn.className = 'dialog-opt-btn focusable';
          btn.dataset.track = String(index);
          btn.textContent = track.name || track.lang || `Track ${index + 1}`;
          btn.addEventListener('click', () => {
            this.hls.subtitleTrack = index;
            if (this.videoEl && this.videoEl.textTracks) {
              for (let i = 0; i < this.videoEl.textTracks.length; i++) {
                this.videoEl.textTracks[i].mode = 'disabled';
              }
            }
            subList.querySelectorAll('.dialog-opt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.showToast(`Subtitles: ${btn.textContent}`, 2000);
            this.toggleSubtitlesDialog(false);
          });
          subList.appendChild(btn);
        });
      }

      // 2. External WebVTT subtitle tracks (from resolver)
      if (Array.isArray(this.subtitles) && this.subtitles.length > 0) {
        this.subtitles.forEach((sub, index) => {
          const btn = document.createElement('button');
          btn.className = 'dialog-opt-btn focusable';
          btn.dataset.extTrack = String(index);
          btn.textContent = sub.label || `Subtitle ${index + 1}`;
          btn.addEventListener('click', () => {
            if (this.hls) this.hls.subtitleTrack = -1;
            if (this.videoEl && this.videoEl.textTracks) {
              for (let i = 0; i < this.videoEl.textTracks.length; i++) {
                this.videoEl.textTracks[i].mode = (i === index) ? 'showing' : 'disabled';
              }
            }
            subList.querySelectorAll('.dialog-opt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.showToast(`Subtitles: ${btn.textContent}`, 2000);
            this.toggleSubtitlesDialog(false);
          });
          subList.appendChild(btn);
        });
      }
    }

    if (this.hls && audioList) {
      const audioTracks = this.hls.audioTracks || [];
      if (audioTracks.length > 0) {
        audioList.innerHTML = '';
        audioTracks.forEach((track, index) => {
          const btn = document.createElement('button');
          btn.className = `dialog-opt-btn focusable ${this.hls.audioTrack === index ? 'active' : ''}`;
          btn.dataset.audio = String(index);
          btn.textContent = track.name || track.lang || `Audio Track ${index + 1}`;
          btn.addEventListener('click', () => {
            this.hls.audioTrack = index;
            audioList.querySelectorAll('.dialog-opt-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.showToast(`Audio: ${btn.textContent}`, 2000);
            this.toggleSubtitlesDialog(false);
          });
          audioList.appendChild(btn);
        });
      }
    }
  }

  toggleSubtitlesDialog(show) {
    const dialog = this.containerEl.querySelector('#subtitles-dialog');
    if (!dialog) return;

    const shouldShow = typeof show === 'boolean' ? show : dialog.classList.contains('hidden');
    if (shouldShow) {
      dialog.classList.remove('hidden');
      nav.setScope(dialog);
    } else {
      dialog.classList.add('hidden');
      nav.clearScope(dialog);
      nav.setScope(this.containerEl);
    }
  }

  wakeHud() {
    if (!this.hudEl || !this.containerEl || !document.body.contains(this.containerEl)) return;
    // An overlay spawned by the player (episode drawer, server menu) is
    // appended to document.body and owns nav's scope while open — refocusing
    // the play/pause button here would yank D-Pad focus out from under it on
    // the very next keypress.
    if (nav.activeScope && nav.activeScope !== this.containerEl) return;
    const wasHidden = this.hudEl.classList.contains('hidden');
    this.hudEl.classList.remove('hidden');
    this.resetHudTimer(4000);

    if (wasHidden || !nav.currentFocusedElement || !this.containerEl.contains(nav.currentFocusedElement)) {
      const playPauseBtn = this.containerEl.querySelector('#btn-tv-playpause');
      if (playPauseBtn) {
        nav.setFocus(playPauseBtn);
      } else {
        nav.focusFirstAvailable();
      }
    }
  }

  resetHudTimer(durationMs = 4000) {
    clearTimeout(this.hudTimer);
    this.hudTimer = setTimeout(() => {
      if (this.hudEl && this.containerEl && document.body.contains(this.containerEl)) {
        // Only hide if not paused and subtitles modal is closed
        const subDialog = this.containerEl.querySelector('#subtitles-dialog');
        const nextCard = this.containerEl.querySelector('#next-ep-countdown-card');
        const isDialogActive = (subDialog && !subDialog.classList.contains('hidden')) || (nextCard && !nextCard.classList.contains('hidden')) || this.isScrubbing;

        if (!this.videoEl.paused && !isDialogActive) {
          this.hudEl.classList.add('hidden');
          if (this.containerEl.contains(document.activeElement)) {
            document.activeElement.blur();
          }
        }
      }
    }, durationMs);
  }

  handleMediaKey(keyCode, key) {
    this.wakeHud();

    if (keyCode === TIZEN_KEYS.MEDIA_STOP) {
      this.close();
      return;
    }

    if (
      keyCode === TIZEN_KEYS.MEDIA_PLAY_PAUSE ||
      keyCode === TIZEN_KEYS.MEDIA_PLAY ||
      keyCode === TIZEN_KEYS.MEDIA_PAUSE ||
      key === 'MediaPlayPause'
    ) {
      this.togglePlayPause();
      return;
    }

    if (keyCode === TIZEN_KEYS.MEDIA_FAST_FORWARD) {
      this.seekBy(10);
      return;
    }

    if (keyCode === TIZEN_KEYS.MEDIA_REWIND) {
      this.seekBy(-10);
      return;
    }

    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    if (keyCode === TIZEN_KEYS.MEDIA_TRACK_NEXT && isTv && !this.nativeMode) {
      this.triggerNextEpisode();
      return;
    }
  }

  openEpisodeDrawer() {
    if (this.activeDrawer) return;

    this.activeDrawer = new EpisodeDrawer({
      media: this.media,
      providerId: this.providerId,
      currentSeason: this.media.season || 1,
      currentEpisode: this.media.episode || 1,
      onSelectEpisode: (newMedia) => {
        this.activeDrawer = null;
        this.switchEpisode(newMedia);
      },
      onClose: () => {
        this.activeDrawer = null;
        if (this.containerEl) {
          nav.setScope(this.containerEl);
        }
      }
    });

    this.activeDrawer.render();
  }

  // A picked episode needs its own resolved stream — reusing `this.streamUrl`
  // (as an earlier version did) just replayed whatever episode was resolved
  // when the player first opened. Route through `onNextEpisode`, same as
  // triggerNextEpisode, so PlayerModal re-resolves a fresh stream for the
  // chosen season/episode instead of guessing +1.
  switchEpisode(newMedia) {
    this.saveCurrentProgress();
    this.close();
    if (this.onNextEpisode) {
      this.onNextEpisode({
        ...this.media,
        season: newMedia.season,
        episode: newMedia.episode,
        title: newMedia.title
      });
    }
  }

  handleBack() {
    if (this.activeDrawer) {
      this.activeDrawer.close();
      this.activeDrawer = null;
      return true;
    }

    const dialog = this.containerEl ? this.containerEl.querySelector('#subtitles-dialog') : null;
    if (dialog && !dialog.classList.contains('hidden')) {
      this.toggleSubtitlesDialog(false);
      return true;
    }

    const nextCard = this.containerEl ? this.containerEl.querySelector('#next-ep-countdown-card') : null;
    if (nextCard && !nextCard.classList.contains('hidden')) {
      this.cancelNextEpCountdown();
      return true;
    }

    this.close();
    return true;
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    const pad = (n) => String(n).padStart(2, '0');
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  close() {
    this.saveCurrentProgress();
    clearTimeout(this.hudTimer);
    clearTimeout(this.streamTimeoutTimer);
    clearInterval(this.progressSaveInterval);
    clearInterval(this.nextEpCountdownTimer);

    if (this.activeDrawer) {
      this.activeDrawer.close();
      this.activeDrawer = null;
    }

    window.removeEventListener('keydown', this.activityHandler, { capture: true });
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('mousemove', this.activityHandler);

    nav.popBackHandler(this.backHandler);
    nav.popMediaKeyHandler(this.mediaKeyHandler);
    nav.clearScope(this.containerEl);

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
    }

    if (this.containerEl && this.containerEl.parentNode) {
      this.containerEl.parentNode.removeChild(this.containerEl);
    }

    if (this.onClose) this.onClose();
  }
}
