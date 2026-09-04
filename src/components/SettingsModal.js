import QRCode from 'qrcode';
import { storage } from '../store/storage.js';
import { tmdb } from '../api/tmdb.js';
import { getProviders, fetchProvidersFromUrl, refreshRelayProviders, getRelayPacks, uninstallPackDirect, isRelayAvailable, fetchPackCatalog, installPackDirect } from '../api/providers.js';
import { nav } from '../nav/spatialNav.js';
import { SetupTourModal } from './SetupTourModal.js';
import { icon } from '../ui/icons.js';

const RELAY_BASE = 'http://127.0.0.1:47993';

// Identifies a focused element across an innerHTML rebuild so updateView()
// can restore focus to the same logical button (e.g. the pack the user just
// installed) instead of always jumping to the first focusable element.
function buildFocusSelector(el) {
  if (!el) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset.manifestUrl) {
    const cls = el.classList.contains('install-pack-btn') ? '.install-pack-btn'
      : el.classList.contains('uninstall-pack-btn') ? '.uninstall-pack-btn'
      : null;
    if (cls) return `${cls}[data-manifest-url="${CSS.escape(el.dataset.manifestUrl)}"]`;
  }
  if (el.dataset.provider) return `.provider-btn[data-provider="${CSS.escape(el.dataset.provider)}"]`;
  return null;
}

export class SettingsModal {
  constructor({ onClose, onSettingsChanged }) {
    this.onClose = onClose;
    this.onSettingsChanged = onSettingsChanged;
    this.modalEl = null;
    this.keyInput = storage.getApiKey();
    this.keyVisible = false;
    this.providerRepoInput = ''; // "add a source" field — always starts empty, existing sources are listed separately
    this.selectedProvider = storage.getDefaultProvider();
    this.backHandler = this.close.bind(this);
    this.pairing = null; // { code, pairUrl, expiresAt, status: 'pending'|'done'|'expired'|'error', message }
    this.pairingPollTimer = null;
    this.catalog = null; // array once loaded, or { error } on failure
    this.catalogInstalling = null; // manifestUrl currently installing
    this.relayStatus = null; // null = checking, true/false after a live (uncached) check
  }

  render() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-overlay';

    this.updateView();

    document.body.appendChild(this.modalEl);
    nav.setScope(this.modalEl);
    nav.pushBackHandler(this.backHandler);
    this.checkRelay();

    return this.modalEl;
  }

  // A live, uncached health check — deliberately bypasses isRelayAvailable()'s
  // cache so "Recheck" always reflects the relay's current state instead of
  // a stale first-load result.
  async checkRelay() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`${RELAY_BASE}/health`, { signal: controller.signal });
      this.relayStatus = res.ok;
    } catch {
      this.relayStatus = false;
    } finally {
      clearTimeout(timer);
    }
    if (this.modalEl) this.updateView();
  }

  updateView() {
    const hasKey = storage.hasApiKey();
    const currentKey = storage.getApiKey();
    const activeKeyMasked = hasKey
      ? `Configured (${currentKey.length > 8 ? currentKey.slice(0, 4) + '••••••••' + currentKey.slice(-4) : '••••••••'})`
      : 'Not Configured (Required)';

    // Excludes catalogMode: 'native' providers — this picker sets the
    // default for TMDB-driven playback, meaningless for a native provider
    // (only ever resolved from the dedicated browse flow). See
    // docs/PROVIDER_PACKS.md's "Native catalogs" §0.7.
    const providers = getProviders().filter(p => p.catalogMode !== 'native');
    const hasProviders = providers.length > 0;
    if (hasProviders && (!this.selectedProvider || !providers.some(p => p.id === this.selectedProvider))) {
      this.selectedProvider = providers[0].id;
      storage.setDefaultProvider(this.selectedProvider);
    }

    const prevContainer = this.modalEl.querySelector('.modal-container');
    const scrollTop = prevContainer ? prevContainer.scrollTop : 0;
    // nav.setScope() always jumps focus to the first focusable element and
    // smooth-scrolls it into view — calling it on every re-render (install/
    // uninstall a pack, pick a default provider) fought the scrollTop
    // restore below, since scrollIntoView's animation keeps running after a
    // later synchronous scrollTop assignment. Re-focus the same element
    // instead so nothing scrolls at all.
    const focusSelector = buildFocusSelector(this.modalEl.querySelector('.tflx-focused'));

    this.modalEl.innerHTML = `
      <div class="modal-container" style="padding: 40px; max-width: 920px; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <h2 style="font-size: 28px; font-weight: 800; color: #fff;">TFlix Settings</h2>
          <button class="btn btn-secondary focusable" id="settings-close-btn" style="padding: 6px 16px; font-size: 14px;">${icon('x')} Close</button>
        </div>

        <!-- TMDB Key Section -->
        <div class="settings-section">
          <div class="settings-label">Personal TMDB API Configuration</div>
          <p class="settings-desc">
            TFlix requires your personal TMDB API Key to browse media and episode catalogs.
            <br>
            <span style="color: #a1a1aa; font-size: 13px;">Get your free API key at <strong style="color: #e50914;">themoviedb.org/settings/api</strong></span>
          </p>

          <div style="background: #1a1a24; padding: 14px 20px; border-radius: 8px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 11px; color: #71717a; text-transform: uppercase; font-weight: 700;">API Key Status</div>
              <div style="font-size: 15px; font-weight: 600; color: ${hasKey ? '#4ade80' : '#ef4444'};">${activeKeyMasked}</div>
            </div>
            ${hasKey ? `
              <button class="btn btn-secondary focusable" id="btn-remove-key" style="padding: 6px 14px; font-size: 13px; color: #ef4444;">
                Remove API Key
              </button>
            ` : ''}
          </div>

          <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 10px;">
            <div style="position: relative; flex: 1;">
              <input
                type="${this.keyVisible ? 'text' : 'password'}"
                id="tmdb-api-input"
                class="focusable primary-focus"
                placeholder="Paste or type your TMDB API Key..."
                value="${this.keyInput}"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                style="width: 100%; box-sizing: border-box; background: #16161f; border: 2px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 14px 46px 14px 18px; color: #fff; font-size: 16px; font-family: monospace; outline: none; transition: border-color 0.2s;"
              />
              <button class="focusable" id="btn-toggle-key-visibility" title="${this.keyVisible ? 'Hide key' : 'Show key'}" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #a1a1aa; cursor: pointer; padding: 6px; display: flex; border-radius: 6px;">
                ${icon(this.keyVisible ? 'eye-off' : 'eye', { size: 18 })}
              </button>
            </div>
            <button class="btn btn-primary focusable" id="btn-save-key" style="padding: 14px 24px; white-space: nowrap;">
              Test & Save Key
            </button>
          </div>
          <div id="key-feedback" style="font-size: 14px; min-height: 22px;"></div>
        </div>

        <!-- Stream Providers & Extensions Section -->
        <div class="settings-section">
          <div class="settings-label">Streaming Providers & Extensions</div>
          <p class="settings-desc">
            TFlix is a clean open-source player and does not bundle media stream sources. Point it at a provider repository URL you trust (see the schema in <code>providers.example.json</code>), or browse native HLS provider packs below.
          </p>

          <div style="background: #1a1a24; padding: 14px 20px; border-radius: 8px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
            <div>
              <div style="font-size: 11px; color: #71717a; text-transform: uppercase; font-weight: 700;">Provider Status</div>
              <div style="font-size: 15px; font-weight: 600; color: ${hasProviders ? '#4ade80' : '#ef4444'};">
                ${hasProviders ? `${icon('check', { size: 14 })} ${providers.length} Providers Active` : 'No Providers Configured'}
              </div>
            </div>
          </div>

          <div style="margin-bottom: 14px;">
            <div style="font-size: 12px; color: #a1a1aa; margin-bottom: 6px; font-weight: 600;">Add Provider Repository:</div>
            <div style="display: flex; gap: 12px; align-items: center;">
              <input
                type="text"
                id="provider-repo-input"
                class="focusable"
                placeholder="https://.../providers.json"
                value="${this.providerRepoInput}"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
                style="flex: 1; background: #16161f; border: 2px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 12px 16px; color: #fff; font-size: 14px; font-family: monospace; outline: none; transition: border-color 0.2s;"
              />
              <button class="btn btn-secondary focusable" id="btn-fetch-custom-repo" style="padding: 12px 20px; white-space: nowrap;">
                ${icon('plus', { size: 14 })} Add
              </button>
            </div>
            <div id="provider-feedback" style="font-size: 14px; min-height: 22px; margin-top: 6px;"></div>
          </div>

          ${this.renderEmbedSources()}

          ${hasProviders ? `
            <div style="margin-top: 16px;">
              <div style="font-size: 13px; color: #d4d4d8; font-weight: 700; margin-bottom: 10px;">Choose Default Server:</div>
              <div class="provider-options">
                ${(() => {
                  // .provider-options is a 2-column grid — only the bottom row's
                  // buttons should force Down to the relay Recheck button; any
                  // other row needs plain overlap-based nav to reach the row
                  // below it inside this same grid.
                  const lastRowStart = Math.floor((providers.length - 1) / 2) * 2;
                  return providers.map((p, i) => `
                    <button class="provider-btn focusable ${p.id === this.selectedProvider ? 'active' : ''}" data-provider="${p.id}"${i >= lastRowStart ? ' data-nav-down="#btn-recheck-relay"' : ''}>
                      <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="name">${p.name} ${p.id === this.selectedProvider ? icon('check', { size: 14 }) : ''}</div>
                        <span class="hud-badge-tag" style="font-size: 9px; background: ${p.type === 'direct' ? '#16a34a' : '#3f3f46'}; display:inline-flex; align-items:center; gap:3px;">
                          ${p.type === 'direct' ? `${icon('zap', { size: 10 })} NATIVE HLS` : `${icon('tv', { size: 10 })} EMBED`}
                        </span>
                      </div>
                      <div class="desc">${p.description || 'Streaming provider'}</div>
                    </button>
                  `).join('');
                })()}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Provider Pack Pairing Section -->
        <div class="settings-section">
          <div class="settings-label">Add a Provider Pack (Advanced)</div>
          <p class="settings-desc">
            Direct HLS providers are resolved by a local relay running on this TV, outside the browser. A "provider pack" adds more sources to it. Only add a pack from someone you trust — it runs code on this device.
          </p>

          <div style="background: rgba(59, 130, 246, 0.08); border-left: 3px solid #3b82f6; padding: 12px 18px 12px 15px; border-radius: 8px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="color: #60a5fa; display: flex;">${icon('wifi', { size: 20 })}</div>
              <div>
                <div style="font-size: 11px; color: #93c5fd; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">System &middot; Local Relay</div>
                <div style="font-size: 14px; font-weight: 600; color: ${this.relayStatus ? '#4ade80' : this.relayStatus === false ? '#ef4444' : '#a1a1aa'};">
                  ${this.relayStatus === null ? 'Checking…' : this.relayStatus ? `${icon('check', { size: 14 })} Reachable (${RELAY_BASE})` : `${icon('triangle-alert', { size: 14 })} Not reachable`}
                </div>
              </div>
            </div>
            <button class="btn btn-secondary focusable" id="btn-recheck-relay" style="padding: 6px 14px; font-size: 13px;">${icon('refresh-cw', { size: 14 })} Recheck</button>
          </div>

          ${this.renderPackStatus()}
          ${this.renderCatalogUi()}
          <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);">
            <div style="font-size: 12px; color: #71717a; margin-bottom: 10px;">Have a pack from somewhere else? Add it via your phone:</div>
            ${this.renderPairingUi()}
          </div>
        </div>

        <!-- Data Management Section -->
        <div class="settings-section">
          <div class="settings-label">Storage & History</div>
          <p class="settings-desc">Manage local watch history, watchlist, and resume progress stored on this TV.</p>
          <div style="display: flex; gap: 14px;">
            <button class="btn btn-secondary focusable" id="btn-clear-history">
              Clear Watch History
            </button>
            <button class="btn btn-secondary focusable" id="btn-replay-tour">
              ${icon('rotate-ccw')} Replay Setup Tour
            </button>
            <button class="btn btn-secondary focusable" id="btn-clear-all" style="color: #ef4444;">
              Reset All App Data
            </button>
          </div>
          <div id="storage-feedback" style="margin-top: 10px; font-size: 14px; color: #4ade80;"></div>
        </div>

        <div style="text-align: center; font-size: 11px; color: #52525b; margin-top: 8px;">TFlix v${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'}</div>
      </div>
    `;

    // Close button
    this.modalEl.querySelector('#settings-close-btn').addEventListener('click', () => this.close());

    // Input listeners
    const inputEl = this.modalEl.querySelector('#tmdb-api-input');
    inputEl.addEventListener('input', (e) => {
      this.keyInput = e.target.value;
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.saveKey();
      }
    });

    const toggleVisBtn = this.modalEl.querySelector('#btn-toggle-key-visibility');
    if (toggleVisBtn) {
      toggleVisBtn.addEventListener('click', () => {
        this.keyVisible = !this.keyVisible;
        this.updateView();
        const refocusInput = this.modalEl.querySelector('#tmdb-api-input');
        if (refocusInput) nav.setFocus(refocusInput);
      });
    }

    // Save TMDB Key button
    this.modalEl.querySelector('#btn-save-key').addEventListener('click', () => this.saveKey());

    // Remove TMDB Key button
    const removeKeyBtn = this.modalEl.querySelector('#btn-remove-key');
    if (removeKeyBtn) {
      removeKeyBtn.addEventListener('click', () => {
        storage.setApiKey('');
        tmdb.clearCache();
        this.keyInput = '';
        this.updateView();
        if (this.onSettingsChanged) this.onSettingsChanged();
      });
    }

    // Provider Repo Input & Buttons
    const repoInputEl = this.modalEl.querySelector('#provider-repo-input');
    if (repoInputEl) {
      repoInputEl.addEventListener('input', (e) => {
        this.providerRepoInput = e.target.value;
      });
    }

    const fetchCustomBtn = this.modalEl.querySelector('#btn-fetch-custom-repo');
    if (fetchCustomBtn) {
      fetchCustomBtn.addEventListener('click', async () => {
        await this.loadProvidersFromUrl(this.providerRepoInput);
      });
    }

    this.modalEl.querySelectorAll('.remove-source-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        storage.removeProviderSource(e.currentTarget.dataset.sourceUrl);
        this.selectedProvider = storage.getDefaultProvider();
        this.updateView();
      });
    });

    this.modalEl.querySelectorAll('.uninstall-pack-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const manifestUrl = button.dataset.manifestUrl;
        button.disabled = true;
        try {
          await uninstallPackDirect(manifestUrl);
          this.selectedProvider = storage.getDefaultProvider();
        } catch (err) {
          console.warn('[SettingsModal] Pack uninstall failed:', err);
        }
        this.updateView();
      });
    });

    const recheckRelayBtn = this.modalEl.querySelector('#btn-recheck-relay');
    if (recheckRelayBtn) {
      recheckRelayBtn.addEventListener('click', () => {
        this.relayStatus = null;
        this.updateView();
        this.checkRelay();
      });
    }

    // Provider pack catalog browsing
    const browsePacksBtn = this.modalEl.querySelector('#btn-browse-packs');
    if (browsePacksBtn) {
      browsePacksBtn.addEventListener('click', () => this.loadCatalog());
    }
    this.modalEl.querySelectorAll('.install-pack-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.installFromCatalog(e.currentTarget.dataset.manifestUrl);
      });
    });

    // Provider pack pairing
    const startPairBtn = this.modalEl.querySelector('#btn-start-pairing');
    if (startPairBtn) {
      startPairBtn.addEventListener('click', () => this.startPairing());
    }
    const cancelPairBtn = this.modalEl.querySelector('#btn-cancel-pairing');
    if (cancelPairBtn) {
      cancelPairBtn.addEventListener('click', () => {
        this.stopPairing();
        this.updateView();
      });
    }
    if (this.pairing && this.pairing.status === 'pending') {
      this.renderQrCode();
    }

    // Provider select buttons
    const providerBtns = this.modalEl.querySelectorAll('.provider-btn');
    providerBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const providerId = e.currentTarget.dataset.provider;
        this.selectedProvider = providerId;
        storage.setDefaultProvider(providerId);
        this.updateView();
      });
    });

    // History and Storage management
    const clearHistBtn = this.modalEl.querySelector('#btn-clear-history');
    if (clearHistBtn) {
      clearHistBtn.addEventListener('click', () => {
        storage.clearHistory();
        const fb = this.modalEl.querySelector('#storage-feedback');
        if (fb) fb.textContent = 'Watch history cleared successfully.';
        if (this.onSettingsChanged) this.onSettingsChanged();
      });
    }

    const replayTourBtn = this.modalEl.querySelector('#btn-replay-tour');
    if (replayTourBtn) {
      replayTourBtn.addEventListener('click', () => {
        this.close();
        const tour = new SetupTourModal({
          onComplete: () => { if (this.onSettingsChanged) this.onSettingsChanged(); }
        });
        tour.render();
      });
    }

    const clearAllBtn = this.modalEl.querySelector('#btn-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        storage.clearAllData();
        tmdb.clearCache();
        const fb = this.modalEl.querySelector('#storage-feedback');
        if (fb) fb.textContent = 'All app data reset. Reloading...';
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      });
    }

    const restoreTarget = focusSelector ? this.modalEl.querySelector(focusSelector) : null;
    if (restoreTarget) {
      nav.focusElement(restoreTarget, false);
    } else {
      nav.setScope(this.modalEl);
    }

    const container = this.modalEl.querySelector('.modal-container');
    if (container) container.scrollTop = scrollTop;
  }

  async loadProvidersFromUrl(url) {
    const feedback = this.modalEl.querySelector('#provider-feedback');
    if (feedback) {
      feedback.style.color = '#fbbf24';
      feedback.textContent = 'Fetching and verifying provider list...';
    }

    try {
      const providers = await fetchProvidersFromUrl(url);
      this.providerRepoInput = ''; // added — clear the field for the next one
      if (!this.selectedProvider && providers[0]) {
        this.selectedProvider = providers[0].id;
        storage.setDefaultProvider(this.selectedProvider);
      }
      this.updateView();

      const fb = this.modalEl.querySelector('#provider-feedback');
      if (fb) {
        fb.style.color = '#4ade80';
        fb.textContent = `Added ${providers.length} provider(s) from this source!`;
      }
    } catch (err) {
      if (feedback) {
        feedback.style.color = '#ef4444';
        feedback.textContent = `Error: ${err.message}`;
      }
    }
  }

  async saveKey() {
    const feedback = this.modalEl.querySelector('#key-feedback');
    const trimmed = this.keyInput.trim();

    if (!trimmed) {
      if (feedback) {
        feedback.style.color = '#ef4444';
        feedback.textContent = 'Please type or paste an API Key first.';
      }
      return;
    }

    if (feedback) {
      feedback.style.color = '#fbbf24';
      feedback.textContent = 'Validating key with TMDB...';
    }

    const result = await tmdb.testApiKey(trimmed);
    if (result.success) {
      storage.setApiKey(trimmed);
      tmdb.clearCache();
      this.updateView();
      const fb = this.modalEl.querySelector('#key-feedback');
      if (fb) {
        fb.style.color = '#4ade80';
        fb.textContent = 'TMDB API Key verified and saved successfully!';
      }
      if (this.onSettingsChanged) this.onSettingsChanged();
    } else {
      if (feedback) {
        feedback.style.color = '#ef4444';
        feedback.textContent = `Invalid TMDB key: ${result.error}`;
      }
    }
  }

  // Embed-type provider sources (see storage.js#getProviderSources) — each
  // one its own group, since fetching a new repository URL adds to the list
  // rather than replacing whatever was there before.
  renderEmbedSources() {
    const sources = storage.getProviderSources();
    if (sources.length === 0) return '';
    return `
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
        ${sources.map(source => `
          <div style="background: #1a1a24; padding: 12px 18px; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
              <div style="min-width: 0;">
                <div style="font-size: 12px; font-weight: 700; color: #fff; font-family: monospace; word-break: break-all;">${source.url}</div>
                <div style="font-size: 12px; color: #71717a; margin-top: 2px;">${source.providers.length} provider(s): ${source.providers.map(p => p.name).join(', ')}</div>
              </div>
              <button class="btn btn-secondary focusable remove-source-btn" data-source-url="${source.url}" style="padding: 6px 12px; font-size: 12px; color: #ef4444; white-space: nowrap;">
                ${icon('trash-2', { size: 13 })} Remove
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Direct provider packs, resolved by the local relay — each installed
  // pack listed and removable independently (see hlsRelay.js's per-pack
  // subdirectories, which make installing one pack no longer wipe another).
  renderPackStatus() {
    const packs = getRelayPacks();
    if (packs.length === 0) {
      return `<div style="font-size: 13px; color: #71717a; margin-bottom: 12px;">No provider packs installed yet.</div>`;
    }
    return `
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px;">
        ${packs.map(pack => `
          <div style="background: #1a1a24; padding: 12px 18px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
            <div style="min-width: 0;">
              <div style="font-size: 14px; font-weight: 600; color: #4ade80;">${pack.name}</div>
              <div style="font-size: 12px; color: #71717a; margin-top: 2px;">${pack.providerIds.length} provider(s) &middot; installed ${new Date(pack.installedAt).toLocaleString()}</div>
            </div>
            <button class="btn btn-secondary focusable uninstall-pack-btn" data-manifest-url="${pack.manifestUrl}" style="padding: 6px 12px; font-size: 12px; color: #ef4444; white-space: nowrap;">
              ${icon('trash-2', { size: 13 })} Uninstall
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderCatalogUi() {
    if (!this.catalog) {
      return `<button class="btn btn-primary focusable" id="btn-browse-packs" style="padding: 10px 18px; font-size: 14px;">${icon('search')} Browse Provider Packs</button>`;
    }
    if (this.catalog.error) {
      return `<div style="color: #ef4444; font-size: 14px; margin-bottom: 8px;">${this.catalog.error}</div>
        <button class="btn btn-secondary focusable" id="btn-browse-packs" style="padding: 8px 16px; font-size: 13px;">Retry</button>`;
    }
    const installedManifestUrls = new Set(getRelayPacks().map(p => p.manifestUrl));
    const browsable = this.catalog.filter(pack => !installedManifestUrls.has(pack.manifestUrl));
    if (browsable.length === 0) {
      return `<div style="font-size: 13px; color: #71717a;">All available packs are already installed.</div>`;
    }
    return `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${browsable.map(pack => {
          const installing = this.catalogInstalling === pack.manifestUrl;
          return `
            <div style="background: #1a1a24; padding: 14px 18px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; gap: 16px;">
              <div>
                <div style="font-size: 14px; font-weight: 700; color: #fff;">${pack.name}</div>
                <div style="font-size: 12px; color: #a1a1aa; margin-top: 2px;">${pack.description || ''}</div>
              </div>
              <button class="btn ${installing ? 'btn-secondary' : 'btn-primary'} focusable install-pack-btn" data-manifest-url="${pack.manifestUrl}" style="padding: 8px 16px; font-size: 13px; white-space: nowrap;" ${installing ? 'disabled' : ''}>
                ${installing ? 'Installing…' : `${icon('download', { size: 14 })} Install`}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  async loadCatalog() {
    try {
      this.catalog = await fetchPackCatalog();
    } catch (e) {
      this.catalog = { error: `Could not load pack catalog: ${e.message}` };
    }
    this.updateView();
  }

  async installFromCatalog(manifestUrl) {
    this.catalogInstalling = manifestUrl;
    this.updateView();
    try {
      const result = await installPackDirect(manifestUrl);
      this.selectedProvider = storage.getDefaultProvider();
      this.catalogInstalling = null;
      this.updateView();
      if (this.onSettingsChanged) this.onSettingsChanged();
      console.log(`[Settings] Installed pack: ${result.name} -> ${result.installed.join(', ')}`);
    } catch (e) {
      this.catalogInstalling = null;
      this.catalog = { error: `Install failed: ${e.message}` };
      this.updateView();
    }
  }

  renderPairingUi() {
    if (!this.pairing) {
      return `<button class="btn btn-secondary focusable" id="btn-start-pairing" style="padding: 10px 18px; font-size: 14px;">${icon('smartphone', { size: 14 })} Add Pack via Phone (QR Code)</button>`;
    }
    if (this.pairing.status === 'pending') {
      return `
        <div style="display: flex; gap: 20px; align-items: center; background: #1a1a24; padding: 18px; border-radius: 10px;">
          <canvas id="pairing-qr-canvas" width="180" height="180" style="border-radius: 8px; background: #fff;"></canvas>
          <div>
            <div style="font-size: 14px; color: #d4d4d8; margin-bottom: 6px;">Scan with your phone, or visit:</div>
            <div style="font-family: monospace; font-size: 13px; color: #4ade80; word-break: break-all;">${this.pairing.pairUrl}</div>
            ${this.pairing.ssid ? `<div style="font-size: 12px; color: #4ade80; margin-top: 8px;">${icon('wifi', { size: 14 })} TV Wi-Fi: ${this.pairing.ssid} — make sure your phone matches.</div>` : ''}
            <div style="font-size: 13px; color: #a1a1aa; margin-top: 10px;">Waiting for pack to be submitted&hellip;</div>
            <button class="btn btn-secondary focusable" id="btn-cancel-pairing" style="margin-top: 12px; padding: 6px 14px; font-size: 13px;">Cancel</button>
          </div>
        </div>
      `;
    }
    if (this.pairing.status === 'done') {
      return `<div style="color: #4ade80; font-size: 14px;">${icon('check', { size: 14 })} ${this.pairing.message}</div>
        <button class="btn btn-secondary focusable" id="btn-start-pairing" style="margin-top: 10px; padding: 10px 18px; font-size: 14px;">${icon('smartphone', { size: 14 })} Add Another Pack</button>`;
    }
    return `<div style="color: #ef4444; font-size: 14px;">${this.pairing.message}</div>
      <button class="btn btn-secondary focusable" id="btn-start-pairing" style="margin-top: 10px; padding: 10px 18px; font-size: 14px;">${icon('smartphone', { size: 14 })} Try Again</button>`;
  }

  async startPairing() {
    const available = await isRelayAvailable();
    if (!available) {
      this.pairing = { status: 'error', message: 'Local relay is not running — provider packs require TizenBrew serviceFile support.' };
      this.updateView();
      return;
    }
    try {
      const res = await fetch(`${RELAY_BASE}/pair/start`);
      const data = await res.json();
      this.pairing = { code: data.code, pairUrl: data.pairUrl, expiresAt: data.expiresAt, ssid: data.ssid || null, status: 'pending' };
      this.updateView();
      this.pollPairingStatus();
    } catch (e) {
      this.pairing = { status: 'error', message: `Could not start pairing: ${e.message}` };
      this.updateView();
    }
  }

  renderQrCode() {
    const canvas = this.modalEl.querySelector('#pairing-qr-canvas');
    if (!canvas || !this.pairing) return;
    QRCode.toCanvas(canvas, this.pairing.pairUrl, { width: 180, margin: 1 }, (err) => {
      if (err) console.warn('[SettingsModal] QR render failed:', err);
    });
  }

  pollPairingStatus() {
    clearTimeout(this.pairingPollTimer);
    if (!this.pairing || this.pairing.status !== 'pending') return;

    if (Date.now() > this.pairing.expiresAt) {
      this.startPairing(); // silently mint a fresh code so the QR stays scannable
      return;
    }

    this.pairingPollTimer = setTimeout(async () => {
      try {
        const res = await fetch(`${RELAY_BASE}/pair/status?code=${this.pairing.code}`);
        const data = await res.json();
        if (data.state === 'done') {
          const result = data.result || {};
          if (result.error) {
            this.pairing = { status: 'error', message: result.error };
          } else {
            await refreshRelayProviders();
            const installed = (result.installed || []).length;
            const failed = (result.errors || []).length;
            this.pairing = {
              status: 'done',
              message: `Installed "${result.name}" — ${installed} provider(s) added${failed ? `, ${failed} failed` : ''}.`
            };
            this.selectedProvider = storage.getDefaultProvider();
          }
          this.updateView();
          return;
        }
        if (data.state === 'expired') {
          this.startPairing(); // silently mint a fresh code so the QR stays scannable
          return;
        }
        this.pollPairingStatus();
      } catch {
        this.pollPairingStatus();
      }
    }, 2000);
  }

  stopPairing() {
    clearTimeout(this.pairingPollTimer);
    this.pairing = null;
  }

  close() {
    clearTimeout(this.pairingPollTimer);
    nav.popBackHandler(this.backHandler);
    nav.clearScope(this.modalEl);
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
    if (this.onClose) this.onClose();
  }
}
