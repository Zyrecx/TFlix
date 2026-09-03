import { getProviders, getProviderById, getPrioritizedProviders, getNextFallbackProvider, getEmbedUrl, isDirectProvider } from '../api/providers.js';
import { resolveDirectStream } from '../api/streamScraper.js';
import { storage } from '../store/storage.js';
import { nav, TIZEN_KEYS } from '../nav/spatialNav.js';
import { VideoPlayer } from './VideoPlayer.js';
import { EpisodeDrawer } from './EpisodeDrawer.js';
import { icon } from '../ui/icons.js';
import { openServerMenu } from '../ui/serverMenu.js';

export class PlayerModal {
  constructor({ media, onClose, onNextEpisode }) {
    this.media = media; // { id, media_type, title, season, episode, poster_path, backdrop_path, vote_average, imdb_id }
    this.onClose = onClose;
    this.onNextEpisode = onNextEpisode;
    this.currentProviderId = storage.getDefaultProvider();
    this.activePlayerInstance = null;
    this.activeDrawer = null;
    this.playerEl = null;
    this.hudEl = null;
    this.hudTimer = null;
    this.embedTimeoutTimer = null;
    this.postMessageListener = null;
    this.attemptedProviders = new Set();
    this.hasPlaybackStarted = false;

    this.backHandler = this.close.bind(this);
    this.mediaKeyHandler = this.handleMediaKey.bind(this);
    this.activityHandler = this.wakeHud.bind(this);
  }

  render() {
    const providers = getPrioritizedProviders(this.currentProviderId);
    if (providers.length === 0) {
      this.playerEl = document.createElement('div');
      this.playerEl.className = 'player-screen';
      this.renderNoProvidersView();
      return this.playerEl;
    }

    if (!this.currentProviderId || !providers.some(p => p.id === this.currentProviderId)) {
      this.currentProviderId = providers[0].id;
    }

    // If selected provider is a direct stream source, launch the Native Video Player
    if (isDirectProvider(this.currentProviderId)) {
      this.renderNativePlayer();
      return this.activePlayerInstance ? this.activePlayerInstance.containerEl : null;
    }

    // Otherwise render Embed Iframe Player
    this.playerEl = document.createElement('div');
    this.playerEl.className = 'player-screen';
    this.renderActiveEmbedPlayer();
    return this.playerEl;
  }

  async renderNativePlayer(directStreamUrl, forceConfirm = false) {
    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    const season = this.media.season || 1;
    const episode = this.media.episode || 1;
    const providerName = this.getProviderName(this.currentProviderId);

    this.attemptedProviders.add(this.currentProviderId);
    this.recordInitialHistory();

    // Show connecting loading screen
    this.renderLoadingView(`Connecting to ${providerName}...`, 'Resolving verified direct HLS master playlist');

    try {
      let resolvedStreamUrl = directStreamUrl;
      let subtitles = [];

      if (!resolvedStreamUrl) {
        const resolved = await resolveDirectStream(this.currentProviderId, this.media, season, episode, null, forceConfirm);

        if (resolved && resolved.needsConfirmation) {
          this.renderConfirmMatchView(resolved.candidates, resolved.providerName);
          return;
        }

        if (resolved && resolved.embedUrl) {
          if (this.playerEl && this.playerEl.parentNode) {
            nav.clearScope(this.playerEl);
            this.playerEl.parentNode.removeChild(this.playerEl);
            this.playerEl = null;
          }
          this.playerEl = document.createElement('div');
          this.playerEl.className = 'player-screen';
          this.renderActiveEmbedPlayer('', resolved.embedUrl);
          return;
        }

        if (resolved && resolved.streamUrl) {
          resolvedStreamUrl = resolved.streamUrl;
          subtitles = resolved.subtitles || [];
        } else {
          throw new Error('No stream URL returned by direct resolver');
        }
      }

      if (this.playerEl && this.playerEl.parentNode) {
        nav.clearScope(this.playerEl);
        this.playerEl.parentNode.removeChild(this.playerEl);
        this.playerEl = null;
      }

      this.activePlayerInstance = new VideoPlayer({
        media: this.media,
        streamUrl: resolvedStreamUrl,
        providerId: this.currentProviderId,
        subtitles,
        onNextEpisode: (nextMedia) => {
          if (this.onNextEpisode) {
            this.onNextEpisode(nextMedia);
          }
        },
        onClose: () => {
          if (this.onClose) this.onClose();
        },
        onSwitchToEmbed: (providerId) => {
          this.handleFallback(this.currentProviderId, 'Stream error');
        },
        onSwitchProvider: (newProviderId) => {
          this.switchServer(newProviderId);
        },
        onFallback: (failedId, reason) => {
          this.handleFallback(failedId, reason);
        },
        onWrongMatch: () => {
          this.reconfirmMatch();
        }
      });

      this.activePlayerInstance.render();
    } catch (err) {
      console.warn(`[PlayerModal] Native stream resolution error on ${this.currentProviderId}:`, err);
      this.handleFallback(this.currentProviderId, err.message || 'Stream resolution failed');
    }
  }

  renderLoadingView(title = 'Connecting to Stream...', subtitle = 'Resolving media sources') {
    if (this.playerEl && this.playerEl.parentNode) {
      this.playerEl.parentNode.removeChild(this.playerEl);
    }
    this.playerEl = document.createElement('div');
    this.playerEl.className = 'player-screen';
    this.playerEl.innerHTML = `
      <div class="player-hud" style="opacity: 1; pointer-events: all; transform: none; background: rgba(10,10,15,0.96); position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1000;">
        <div style="max-width: 580px; text-align: center; padding: 40px; background: #181824; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.9);">
          <div style="margin-bottom: 16px; color: #e50914; display: flex; justify-content: center;">${icon('zap', { size: 48 })}</div>
          <h2 style="color: #fff; font-size: 22px; font-weight: 800; margin-bottom: 8px;">${title}</h2>
          <p style="color: #a1a1aa; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">${subtitle}</p>
          <div style="display: flex; gap: 14px; justify-content: center;">
            <button class="btn btn-secondary focusable primary-focus" id="btn-cancel-connecting" style="padding: 10px 24px; font-size: 14px;">
              ${icon('x')} Cancel
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.playerEl);
    nav.setScope(this.playerEl);
    nav.pushBackHandler(this.backHandler);

    const cancelBtn = this.playerEl.querySelector('#btn-cancel-connecting');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.close());
    }
  }

  // Shown when a "direct" provider's resolve() can't confidently match the
  // title (see docs/PROVIDER_PACKS.md — the `needsConfirmation` outcome).
  // The choice is cached via storage.setConfirmedShowId, keyed by provider +
  // TMDB id, so this only ever fires once per show — not per episode.
  renderConfirmMatchView(candidates = [], providerName = '') {
    if (this.playerEl && this.playerEl.parentNode) {
      this.playerEl.parentNode.removeChild(this.playerEl);
    }

    this.playerEl = document.createElement('div');
    this.playerEl.className = 'player-screen';

    const items = candidates.slice(0, 8).map((c, i) => `
      <button class="btn btn-secondary focusable${i === 0 ? ' primary-focus' : ''}" data-candidate-id="${c.id}"
        style="display:block; width:100%; text-align:right; padding:14px 18px; font-size:15px; margin-bottom:10px;">
        ${c.label || c.title || c.id}${c.year ? ` <span style="color:#a1a1aa;">(${c.year})</span>` : ''}
      </button>
    `).join('');

    this.playerEl.innerHTML = `
      <div class="player-hud" style="opacity: 1; pointer-events: all; transform: none; background: rgba(10,10,15,0.97); position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1000;">
        <div style="max-width: 560px; width: 90%; text-align: center; padding: 40px; background: #181824; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.9);">
          <h2 style="color: #fff; font-size: 20px; font-weight: 800; margin-bottom: 8px;">Confirm the match on ${providerName || 'this server'}</h2>
          <p style="color: #a1a1aa; font-size: 14px; line-height: 1.5; margin-bottom: 20px;">
            Couldn't confidently match this title automatically. Pick the right one below — you'll only be asked once for this show.
          </p>
          <div style="text-align: right; margin-bottom: 8px;">
            ${items || '<p style="color:#a1a1aa;">No matches found.</p>'}
          </div>
          <button class="btn btn-secondary focusable" id="btn-confirm-skip" style="padding: 10px 24px; font-size: 14px; margin-top: 8px;">
            ${icon('x')} None of these — try next server
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.playerEl);
    nav.setScope(this.playerEl);
    nav.pushBackHandler(this.backHandler);

    this.playerEl.querySelectorAll('[data-candidate-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const showId = btn.getAttribute('data-candidate-id');
        const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
        storage.setConfirmedShowId(this.currentProviderId, String(this.media.id), showId, isTv ? (this.media.season || 1) : null);
        this.renderNativePlayer();
      });
    });

    const skipBtn = this.playerEl.querySelector('#btn-confirm-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => this.handleFallback(this.currentProviderId, 'No confirmed match'));
    }
  }

  handleFallback(failedProviderId, reason = 'Offline or timeout') {
    this.attemptedProviders.add(failedProviderId);
    console.warn(`[PlayerModal] Provider ${failedProviderId} failed (${reason}). Finding fallback...`);

    const nextProvider = getNextFallbackProvider(failedProviderId, this.attemptedProviders);
    if (!nextProvider) {
      console.error('[PlayerModal] All configured providers have failed.');
      if (this.activePlayerInstance) {
        this.activePlayerInstance.close();
        this.activePlayerInstance = null;
      }
      this.renderAllServersFailedView(reason);
      return;
    }

    console.log(`[PlayerModal] Auto-falling back to next provider: ${nextProvider.name} (${nextProvider.id})`);

    // Clean up current active player
    if (this.activePlayerInstance) {
      this.activePlayerInstance.close();
      this.activePlayerInstance = null;
    }
    if (this.playerEl && this.playerEl.parentNode) {
      nav.clearScope(this.playerEl);
      this.playerEl.parentNode.removeChild(this.playerEl);
      this.playerEl = null;
    }

    this.currentProviderId = nextProvider.id;

    if (isDirectProvider(nextProvider.id)) {
      this.renderNativePlayer();
    } else {
      this.playerEl = document.createElement('div');
      this.playerEl.className = 'player-screen';
      this.renderActiveEmbedPlayer(reason);
    }
  }

  skipToNextServer() {
    clearTimeout(this.embedTimeoutTimer);
    const providers = getProviders();
    const currentIndex = providers.findIndex(p => p.id === this.currentProviderId);
    const nextIndex = (currentIndex + 1) % providers.length;
    const nextProvider = providers[nextIndex];
    if (nextProvider) {
      this.switchServer(nextProvider.id);
    }
  }

  renderAllServersFailedView(reason = '') {
    if (this.playerEl && this.playerEl.parentNode) {
      this.playerEl.parentNode.removeChild(this.playerEl);
    }

    this.playerEl = document.createElement('div');
    this.playerEl.className = 'player-screen';
    this.playerEl.innerHTML = `
      <div class="player-hud" style="opacity: 1; pointer-events: all; transform: none; background: rgba(10,10,15,0.97); position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1000;">
        <div style="max-width: 600px; text-align: center; padding: 40px; background: #181824; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.9);">
          <div style="margin-bottom: 16px; color: #ef4444; display: flex; justify-content: center;">${icon('triangle-alert', { size: 50 })}</div>
          <h2 style="color: #fff; font-size: 24px; font-weight: 800; margin-bottom: 12px;">All Stream Servers Unavailable</h2>
          <p style="color: #a1a1aa; font-size: 15px; line-height: 1.5; margin-bottom: 8px;">
            TFlix attempted all configured stream providers (${this.attemptedProviders.size} servers), but none responded successfully.
          </p>
          ${reason ? `<div style="color: #f87171; font-size: 13px; font-family: monospace; margin-bottom: 24px;">Last error: ${reason}</div>` : '<div style="margin-bottom: 24px;"></div>'}
          <div style="display: flex; gap: 14px; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary focusable primary-focus" id="btn-retry-all-providers" style="padding: 12px 24px; font-size: 15px;">
              ${icon('rotate-ccw')} Retry All Servers
            </button>
            <button class="btn btn-secondary focusable" id="btn-player-failed-exit" style="padding: 12px 20px; font-size: 15px;">
              ${icon('x')} Exit Player
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.playerEl);
    nav.setScope(this.playerEl);
    nav.pushBackHandler(this.backHandler);

    const retryBtn = this.playerEl.querySelector('#btn-retry-all-providers');
    const exitBtn = this.playerEl.querySelector('#btn-player-failed-exit');

    retryBtn.addEventListener('click', () => {
      this.attemptedProviders.clear();
      const providers = getPrioritizedProviders();
      if (providers.length > 0) {
        this.currentProviderId = providers[0].id;
        nav.clearScope(this.playerEl);
        if (this.playerEl.parentNode) {
          this.playerEl.parentNode.removeChild(this.playerEl);
          this.playerEl = null;
        }
        this.render();
      }
    });

    exitBtn.addEventListener('click', () => this.close());
  }

  renderNoProvidersView() {
    this.playerEl.innerHTML = `
      <div class="player-hud" style="opacity: 1; pointer-events: all; transform: none; background: rgba(10,10,15,0.96); position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1000;">
        <div style="max-width: 580px; text-align: center; padding: 40px; background: #181824; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px;">
          <div style="margin-bottom: 16px; color: #a1a1aa; display: flex; justify-content: center;">${icon('plug-zap', { size: 48 })}</div>
          <h2 style="color: #fff; font-size: 24px; font-weight: 800; margin-bottom: 12px;">Connect Stream Provider</h2>
          <p style="color: #a1a1aa; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
            TFlix is a clean open-source player with no bundled sources. Add a native HLS provider pack or your own
            embed repository URL from <strong style="color: #e50914;">Settings → Streaming Providers</strong>.
          </p>
          <div style="display: flex; gap: 14px; justify-content: center;">
            <button class="btn btn-secondary focusable primary-focus" id="btn-player-cancel" style="padding: 12px 20px; font-size: 15px;">
              ${icon('x')} Close
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.playerEl);
    nav.setScope(this.playerEl);
    nav.pushBackHandler(this.backHandler);

    const cancelBtn = this.playerEl.querySelector('#btn-player-cancel');
    cancelBtn.addEventListener('click', () => this.close());
  }

  recordInitialHistory() {
    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    const season = this.media.season || 1;
    const episode = this.media.episode || 1;
    const title = this.media.title || this.media.name || 'Playing Media';

    storage.saveHistory({
      id: this.media.id,
      media_type: isTv ? 'tv' : 'movie',
      mediaType: isTv ? 'tv' : 'movie',
      title,
      name: this.media.name || this.media.title,
      poster_path: this.media.poster_path,
      backdrop_path: this.media.backdrop_path,
      vote_average: this.media.vote_average,
      release_date: this.media.release_date || this.media.first_air_date,
      first_air_date: this.media.first_air_date || this.media.release_date,
      season,
      episode
    });
  }

  renderActiveEmbedPlayer(fallbackReason = '', overrideUrl = null) {
    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    const season = this.media.season || 1;
    const episode = this.media.episode || 1;
    const title = this.media.title || this.media.name || 'Playing Media';

    this.attemptedProviders.add(this.currentProviderId);
    this.recordInitialHistory();

    const providers = getProviders();
    if (!this.currentProviderId || !providers.some(p => p.id === this.currentProviderId)) {
      this.currentProviderId = storage.getDefaultProvider() || (providers[0] ? providers[0].id : '');
    }

    // Check saved progress to resume via startAt parameter if supported
    const saved = storage.getProgress(this.media.id, season, episode);
    const startAt = saved && saved.currentTime > 15 ? saved.currentTime : 0;

    // overrideUrl: a "direct" provider that resolved to { embedUrl } instead
    // of a raw stream — the URL is already final, skip the {id} templating
    // that getEmbedUrl() does for classic embed-type providers.
    const embedUrl = overrideUrl || getEmbedUrl(this.currentProviderId, isTv ? 'tv' : 'movie', this.media.id, season, episode, startAt);

    this.hasPlaybackStarted = false;
    clearTimeout(this.embedTimeoutTimer);

    this.playerEl.innerHTML = `
      <div class="player-hud" id="player-hud">
        <div class="player-info">
          <h2 id="current-player-title">${title}</h2>
          <p id="current-player-meta">
            ${isTv ? `Season ${season} • Episode ${episode}` : 'Movie'} 
            | Server: <span id="current-server-name">${this.getProviderName(this.currentProviderId)}</span>
            ${fallbackReason ? `<span class="player-fallback-tag">Auto-switched: ${fallbackReason}</span>` : ''}
            ${startAt > 0 ? `<span style="color:#fbbf24; margin-left:8px;">(Resumed at ${this.formatTime(startAt)})</span>` : ''}
          </p>
        </div>
        <div class="player-controls">
          <button class="btn btn-secondary focusable primary-focus" id="player-skip-server-btn" style="padding: 8px 16px; font-size: 14px;" title="Skip to Next Working Server">
            ${icon('zap', { size: 16 })} Next Server
          </button>
          <button class="btn btn-secondary focusable" id="player-server-select" style="padding: 8px 16px; font-size: 14px;" title="Change Server">
            ${icon('server', { size: 16 })}
          </button>
          ${isTv ? `
            <button class="btn btn-secondary focusable" id="player-episodes-drawer-btn" style="padding: 8px 18px; font-size: 14px;" title="Browse Episodes">
              ${icon('list-video', { size: 16 })}
            </button>
            <button class="btn btn-secondary focusable" id="player-next-ep-btn" style="padding: 8px 18px; font-size: 14px;" title="Next Episode">
              ${icon('skip-forward', { size: 16 })}
            </button>
          ` : ''}
          <button class="btn btn-secondary focusable" id="player-close-btn" style="padding: 8px 18px; font-size: 14px;" title="Exit Player">
            ${icon('x', { size: 16 })}
          </button>
        </div>
      </div>
      <iframe 
        id="player-iframe"
        class="player-iframe"
        src="${embedUrl}"
        tabindex="-1"
        allowfullscreen="true"
        webkitallowfullscreen="true"
        mozallowfullscreen="true"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      ></iframe>
    `;

    if (!this.playerEl.parentNode) {
      document.body.appendChild(this.playerEl);
    }
    this.hudEl = this.playerEl.querySelector('#player-hud');

    const iframe = this.playerEl.querySelector('#player-iframe');
    if (iframe) {
      iframe.addEventListener('error', () => {
        console.warn(`[PlayerModal] Iframe failed to load on server: ${this.currentProviderId}`);
        this.handleFallback(this.currentProviderId, 'Iframe connection error');
      });
    }

    // Attach HUD listeners
    const skipBtn = this.playerEl.querySelector('#player-skip-server-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.skipToNextServer();
      });
    }

    const serverBtn = this.playerEl.querySelector('#player-server-select');
    if (serverBtn) {
      serverBtn.addEventListener('click', () => {
        openServerMenu({
          providers,
          currentId: this.currentProviderId,
          onSelect: (selectedId) => {
            this.switchServer(selectedId);
            if (this.playerEl) nav.setScope(this.playerEl);
          }
        });
      });
    }

    const drawerBtn = this.playerEl.querySelector('#player-episodes-drawer-btn');
    if (drawerBtn) {
      drawerBtn.addEventListener('click', () => {
        this.openEpisodeDrawer();
      });
    }

    const nextBtn = this.playerEl.querySelector('#player-next-ep-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (this.onNextEpisode) {
          this.close();
          this.onNextEpisode({
            ...this.media,
            episode: (this.media.episode || 1) + 1
          });
        }
      });
    }

    this.playerEl.querySelector('#player-close-btn').addEventListener('click', () => this.close());

    // Listen to inbound postMessage from supported embed providers (e.g. vidlink.pro)
    this.setupPostMessageListener();

    // Spatial navigation & Key handling
    nav.setScope(this.playerEl);
    nav.pushBackHandler(this.backHandler);
    nav.pushMediaKeyHandler(this.mediaKeyHandler);

    window.addEventListener('keydown', this.activityHandler, { capture: true });
    window.addEventListener('mousemove', this.activityHandler);

    this.resetHudTimer();
  }

  openEpisodeDrawer() {
    if (this.activeDrawer) return;

    this.activeDrawer = new EpisodeDrawer({
      media: this.media,
      currentSeason: this.media.season || 1,
      currentEpisode: this.media.episode || 1,
      onSelectEpisode: (newMedia) => {
        this.activeDrawer = null;
        this.media = {
          ...this.media,
          season: newMedia.season,
          episode: newMedia.episode,
          title: newMedia.title
        };
        this.switchEpisode(newMedia.season, newMedia.episode);
      },
      onClose: () => {
        this.activeDrawer = null;
        if (this.playerEl) {
          nav.setScope(this.playerEl);
        }
      }
    });

    this.activeDrawer.render();
  }

  switchEpisode(season, episode) {
    this.media.season = season;
    this.media.episode = episode;
    this.recordInitialHistory();

    const title = this.media.name || this.media.title || 'Playing Media';
    const metaEl = this.playerEl ? this.playerEl.querySelector('#current-player-meta') : null;
    if (metaEl) {
      metaEl.innerHTML = `Season ${season} • Episode ${episode} | Server: <span>${this.getProviderName(this.currentProviderId)}</span>`;
    }

    const embedUrl = getEmbedUrl(this.currentProviderId, 'tv', this.media.id, season, episode);
    const iframe = this.playerEl ? this.playerEl.querySelector('#player-iframe') : null;
    if (iframe) {
      iframe.src = embedUrl;
    }

    this.wakeHud();
  }

  setupPostMessageListener() {
    this.postMessageListener = (event) => {
      try {
        const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
        const season = this.media.season || 1;
        const episode = this.media.episode || 1;

        // VidLink postMessage event handler
        if (event.origin && event.origin.includes('vidlink.pro')) {
          const data = event.data;
          if (data) {
            this.hasPlaybackStarted = true;
            clearTimeout(this.embedTimeoutTimer);

            // Track playback time update
            if (data.type === 'PLAYER_EVENT' || data.event === 'timeupdate' || typeof data.currentTime === 'number') {
              const cur = data.currentTime || (data.data && data.data.currentTime);
              const dur = data.duration || (data.data && data.data.duration);
              if (typeof cur === 'number' && cur > 5) {
                storage.updateProgress(this.media.id, season, episode, cur, dur);
              }
            }
            // Auto advance next episode on ended
            if (data.event === 'ended' && isTv && this.onNextEpisode) {
              this.close();
              this.onNextEpisode({
                ...this.media,
                episode: episode + 1
              });
            }
          }
        }
      } catch (e) {
        // Ignore cross-origin parsing errors
      }
    };

    window.addEventListener('message', this.postMessageListener);
  }

  getProviderName(providerId) {
    const provider = getProviderById(providerId);
    return provider ? provider.name : (providerId || 'None');
  }

  switchServer(providerId) {
    clearTimeout(this.embedTimeoutTimer);
    this.currentProviderId = providerId;
    this.attemptedProviders.add(providerId);
    
    // Clean up current active native player if any
    if (this.activePlayerInstance) {
      this.activePlayerInstance.close();
      this.activePlayerInstance = null;
    }

    if (this.playerEl && this.playerEl.parentNode) {
      nav.clearScope(this.playerEl);
      this.playerEl.parentNode.removeChild(this.playerEl);
      this.playerEl = null;
    }

    // If user switched to a direct provider, transition to Native Video Player
    if (isDirectProvider(providerId)) {
      this.renderNativePlayer();
      return;
    }

    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    const season = this.media.season || 1;
    const episode = this.media.episode || 1;
    
    this.playerEl = document.createElement('div');
    this.playerEl.className = 'player-screen';
    this.renderActiveEmbedPlayer();
  }

  // Lets the user correct (or explicitly ratify) a `fuzzyMatch` provider's
  // auto-accepted single-candidate match after the fact — see the
  // forceConfirm note on resolveDirectStream. Re-running with forceConfirm
  // always surfaces renderConfirmMatchView, even for one candidate, so
  // picking it there is what actually caches it via setConfirmedShowId
  // (auto-accepted matches are deliberately never cached on their own —
  // see docs/PROVIDER_PACKS.md's "Optional capabilities").
  reconfirmMatch() {
    if (this.activePlayerInstance) {
      this.activePlayerInstance.close();
      this.activePlayerInstance = null;
    }
    if (this.playerEl && this.playerEl.parentNode) {
      nav.clearScope(this.playerEl);
      this.playerEl.parentNode.removeChild(this.playerEl);
      this.playerEl = null;
    }
    this.renderNativePlayer(null, true);
  }

  wakeHud() {
    if (!this.hudEl || !this.playerEl || !document.body.contains(this.playerEl)) return;
    // An overlay spawned by the player (episode drawer, server menu) is
    // appended to document.body and owns nav's scope while open — stealing
    // focus back here would break navigation inside it on the next keypress.
    if (nav.activeScope && nav.activeScope !== this.playerEl) return;
    const wasHidden = this.hudEl.classList.contains('hidden');
    this.hudEl.classList.remove('hidden');
    this.resetHudTimer();

    if (wasHidden || !nav.currentFocusedElement || !this.playerEl.contains(nav.currentFocusedElement)) {
      nav.focusFirstAvailable();
    }
  }

  resetHudTimer() {
    clearTimeout(this.hudTimer);
    this.hudTimer = setTimeout(() => {
      if (this.activeDrawer) return;
      if (this.hudEl && this.playerEl && document.body.contains(this.playerEl)) {
        this.hudEl.classList.add('hidden');
        if (this.playerEl.contains(document.activeElement)) {
          document.activeElement.blur();
        }
      }
    }, 4500);
  }

  handleMediaKey(keyCode, key) {
    this.wakeHud();

    if (keyCode === TIZEN_KEYS.MEDIA_STOP) {
      this.close();
      return;
    }

    const isTv = this.media.media_type === 'tv' || this.media.mediaType === 'tv';
    if (keyCode === TIZEN_KEYS.MEDIA_TRACK_NEXT && isTv) {
      const episode = this.media.episode || 1;
      if (this.onNextEpisode) {
        this.close();
        this.onNextEpisode({
          ...this.media,
          episode: episode + 1
        });
      }
      return;
    }

    // Forward media commands to iframe if supported
    const iframe = this.playerEl ? this.playerEl.querySelector('#player-iframe') : null;
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: 'tizen:mediaKey', keyCode, key }, '*');
      } catch (e) {}
    }
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const totalSecs = Math.floor(seconds);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (hrs > 0) return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    return `${pad(mins)}:${pad(secs)}`;
  }

  close() {
    clearTimeout(this.hudTimer);
    clearTimeout(this.embedTimeoutTimer);
    if (this.activeDrawer) {
      this.activeDrawer.close();
      this.activeDrawer = null;
    }
    if (this.postMessageListener) {
      window.removeEventListener('message', this.postMessageListener);
      this.postMessageListener = null;
    }
    window.removeEventListener('keydown', this.activityHandler, { capture: true });
    window.removeEventListener('mousemove', this.activityHandler);
    nav.popBackHandler(this.backHandler);
    nav.popMediaKeyHandler(this.mediaKeyHandler);

    if (this.activePlayerInstance) {
      this.activePlayerInstance.close();
      this.activePlayerInstance = null;
    }

    if (this.playerEl) {
      nav.clearScope(this.playerEl);
      if (this.playerEl.parentNode) {
        this.playerEl.parentNode.removeChild(this.playerEl);
      }
      this.playerEl = null;
    }
    if (this.onClose) this.onClose();
  }
}
