import QRCode from 'qrcode';
import { storage } from '../store/storage.js';
import { tmdb } from '../api/tmdb.js';
import { isRelayAvailable, fetchPackCatalog, installPackDirect } from '../api/providers.js';
import { nav } from '../nav/spatialNav.js';
import { icon } from '../ui/icons.js';

const RELAY_BASE = 'http://127.0.0.1:47993';
const STEPS = ['welcome', 'tmdb-key', 'providers', 'done'];

/**
 * First-run setup tour. Walks a new user through the two things TFlix can't
 * function without (a TMDB key) or is much better with (a streaming
 * provider), using the same phone-pairing relay as the provider-pack QR flow
 * in SettingsModal (see service/hlsRelay.js) but with kind=tmdb_key so the
 * phone page collects a key string instead of a manifest URL.
 */
export class SetupTourModal {
  constructor({ onComplete }) {
    this.onComplete = onComplete;
    this.modalEl = null;
    this.step = 0;
    this.keyInput = '';
    this.pairing = null; // { code, pairUrl, ssid, expiresAt, status: 'pending'|'done'|'error', message }
    this.pairingPollTimer = null;
    this.catalog = null; // array once loaded, or { error } on failure
    this.catalogInstalling = null; // manifestUrl currently installing
    this.backHandler = this.handleBack.bind(this);
  }

  render() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-overlay';
    this.updateView();
    document.body.appendChild(this.modalEl);
    nav.setScope(this.modalEl);
    nav.pushBackHandler(this.backHandler);
    return this.modalEl;
  }

  handleBack() {
    if (this.step > 0) {
      this.prevStep();
    }
  }

  updateView() {
    this.modalEl.innerHTML = `
      <div class="modal-container" style="padding: 44px; max-width: 760px; max-height: 90vh; overflow-y: auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="display:flex; gap:8px;">
            ${STEPS.map((_, i) => `
              <span style="width:8px; height:8px; border-radius:50%; background:${i === this.step ? '#e50914' : 'rgba(255,255,255,0.2)'}; transition: background 0.2s;"></span>
            `).join('')}
          </div>
          <button class="focusable" id="tour-skip-btn" style="background:none; border:none; color:#71717a; font-size:13px; cursor:pointer;">Skip Tour ›</button>
        </div>
        <div id="tour-step-body" style="min-height: 320px; padding-top: 18px;">
          ${this.renderStep()}
        </div>
      </div>
    `;

    this.modalEl.querySelector('#tour-skip-btn').addEventListener('click', () => this.finish());
    this.bindStepEvents();
    nav.setScope(this.modalEl);

    if (this.pairing && this.pairing.status === 'pending') {
      this.renderQrCode();
    }
  }

  renderStep() {
    switch (STEPS[this.step]) {
      case 'welcome': return this.renderWelcome();
      case 'tmdb-key': return this.renderTmdbKeyStep();
      case 'providers': return this.renderProvidersStep();
      case 'done': return this.renderDoneStep();
      default: return '';
    }
  }

  renderWelcome() {
    return `
      <div style="text-align:center; padding: 30px 10px;">
        <div style="margin-bottom: 18px; color: #e50914; display: flex; justify-content: center;">${icon('tv', { size: 56 })}</div>
        <h2 style="font-size: 30px; font-weight: 800; color: #fff; margin-bottom: 14px;">Welcome to TFlix</h2>
        <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; max-width: 480px; margin: 0 auto 32px;">
          Quick setup — two steps, about a minute. You'll connect your free TMDB catalog key and (optionally) pick a streaming provider.
        </p>
        <button class="btn btn-primary focusable primary-focus" id="tour-next-btn" style="padding: 14px 36px; font-size: 16px;">
          Get Started
        </button>
      </div>
    `;
  }

  renderTmdbKeyStep() {
    const hasKey = storage.hasApiKey();
    return `
      <h2 style="font-size: 24px; font-weight: 800; color: #fff; margin-bottom: 8px;">1. Connect Your TMDB Key</h2>
      <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin-bottom: 22px;">
        TFlix needs a free personal TMDB API key to browse the catalog. Get one at
        <strong style="color: #e50914;">themoviedb.org/settings/api</strong> — then enter it below or scan the QR code with your phone.
      </p>

      ${hasKey ? `
        <div style="background: #142a1c; border: 1px solid rgba(74,222,128,0.3); padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; color: #4ade80; font-size: 14px; font-weight: 600;">
          ${icon('check', { size: 14 })} TMDB key configured — you're good to go.
        </div>
      ` : `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 12px;">
          <div style="background: #1a1a24; border-radius: 10px; padding: 18px;">
            <div style="font-size: 13px; font-weight: 700; color: #d4d4d8; margin-bottom: 10px;">${icon('keyboard', { size: 14 })} Type on this TV</div>
            <input
              type="text" id="tour-key-input" class="focusable"
              placeholder="Paste or type your TMDB API Key..."
              value="${this.keyInput}"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
              style="width: 100%; box-sizing: border-box; background: #16161f; border: 2px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 12px 14px; color: #fff; font-size: 14px; font-family: monospace; outline: none; margin-bottom: 10px;"
            />
            <button class="btn btn-primary focusable" id="tour-save-key-btn" style="width: 100%; padding: 10px; font-size: 14px;">Test & Save Key</button>
            <div id="tour-key-feedback" style="font-size: 13px; min-height: 20px; margin-top: 8px;"></div>
          </div>
          <div style="background: #1a1a24; border-radius: 10px; padding: 18px; display: flex; flex-direction: column; align-items: center; text-align: center;">
            <div style="font-size: 13px; font-weight: 700; color: #d4d4d8; margin-bottom: 10px; align-self: flex-start;">${icon('smartphone', { size: 14 })} Or scan with your phone</div>
            ${this.renderKeyPairingUi()}
          </div>
        </div>
      `}
    `;
  }

  renderKeyPairingUi() {
    if (!this.pairing) {
      return `<button class="btn btn-secondary focusable" id="tour-start-pairing-btn" style="padding: 10px 18px; font-size: 14px; margin-top: auto;">Generate QR Code</button>`;
    }
    if (this.pairing.status === 'pending') {
      return `
        <canvas id="tour-pairing-qr-canvas" width="150" height="150" style="border-radius: 8px; background: #fff; margin-bottom: 10px;"></canvas>
        ${this.pairing.ssid ? `<div style="font-size: 11px; color: #4ade80; margin-bottom: 6px;">${icon('wifi', { size: 12 })} TV Wi-Fi: ${this.pairing.ssid}</div>` : ''}
        <div style="font-size: 12px; color: #a1a1aa;">Scan, then paste your key on your phone.</div>
        <div style="font-size: 12px; color: #71717a; margin-top: 6px;">Waiting&hellip;</div>
        <button class="btn btn-secondary focusable" id="tour-cancel-pairing-btn" style="margin-top: 10px; padding: 6px 14px; font-size: 12px;">Cancel</button>
      `;
    }
    if (this.pairing.status === 'done') {
      return `<div style="color: #4ade80; font-size: 14px;">${icon('check', { size: 14 })} ${this.pairing.message}</div>`;
    }
    return `
      <div style="color: #ef4444; font-size: 13px; margin-bottom: 10px;">${this.pairing.message}</div>
      <button class="btn btn-secondary focusable" id="tour-start-pairing-btn" style="padding: 8px 16px; font-size: 13px;">Try Again</button>
    `;
  }

  renderProvidersStep() {
    return `
      <h2 style="font-size: 24px; font-weight: 800; color: #fff; margin-bottom: 8px;">2. Add a Streaming Provider</h2>
      <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin-bottom: 22px;">
        TFlix is a clean open-source player with no bundled sources. Browse native HLS provider packs below,
        or skip this and configure a provider (including your own embed repository URL) later in Settings.
      </p>
      <div style="background: #1a1a24; padding: 16px; border-radius: 10px;">
        ${this.renderCatalogUi()}
      </div>
    `;
  }

  renderCatalogUi() {
    if (!this.catalog) {
      return `<button class="btn btn-secondary focusable" id="tour-browse-packs-btn" style="padding: 8px 16px; font-size: 13px;">${icon('search', { size: 14 })} Browse Provider Packs</button>`;
    }
    if (this.catalog.error) {
      return `<div style="color: #ef4444; font-size: 13px; margin-bottom: 8px;">${this.catalog.error}</div>
        <button class="btn btn-secondary focusable" id="tour-browse-packs-btn" style="padding: 8px 16px; font-size: 13px;">Retry</button>`;
    }
    return `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${this.catalog.map(pack => {
          const installing = this.catalogInstalling === pack.manifestUrl;
          return `
            <div style="background: #1a1a24; padding: 12px 16px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; gap: 14px;">
              <div style="text-align: left;">
                <div style="font-size: 13px; font-weight: 700; color: #fff;">${pack.name}</div>
                <div style="font-size: 11px; color: #a1a1aa; margin-top: 2px;">${pack.description || ''}</div>
              </div>
              <button class="btn ${installing ? 'btn-secondary' : 'btn-primary'} focusable install-pack-btn" data-manifest-url="${pack.manifestUrl}" style="padding: 7px 14px; font-size: 12px; white-space: nowrap;" ${installing ? 'disabled' : ''}>
                ${installing ? 'Installing…' : '⬇ Install'}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  renderDoneStep() {
    const hasKey = storage.hasApiKey();
    return `
      <div style="text-align:center; padding: 30px 10px;">
        <div style="margin-bottom: 18px; color: ${hasKey ? '#e50914' : '#fbbf24'}; display: flex; justify-content: center;">${icon(hasKey ? 'film' : 'triangle-alert', { size: 56 })}</div>
        <h2 style="font-size: 28px; font-weight: 800; color: #fff; margin-bottom: 14px;">
          ${hasKey ? "You're all set!" : 'Almost there'}
        </h2>
        <p style="color: #a1a1aa; font-size: 15px; line-height: 1.6; max-width: 460px; margin: 0 auto 32px;">
          ${hasKey
            ? 'TFlix is configured and ready to browse. You can always change your key or providers later in Settings.'
            : "You haven't added a TMDB key yet — you can still explore, but browsing the catalog will ask for one. Add it any time from Settings."}
        </p>
        <button class="btn btn-primary focusable primary-focus" id="tour-finish-btn" style="padding: 14px 36px; font-size: 16px;">
          Enter TFlix
        </button>
      </div>
    `;
  }

  bindStepEvents() {
    const nextBtn = this.modalEl.querySelector('#tour-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextStep());

    const finishBtn = this.modalEl.querySelector('#tour-finish-btn');
    if (finishBtn) finishBtn.addEventListener('click', () => this.finish());

    // TMDB key step
    const keyInputEl = this.modalEl.querySelector('#tour-key-input');
    if (keyInputEl) {
      keyInputEl.addEventListener('input', (e) => { this.keyInput = e.target.value; });
      keyInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.saveKey(); });
    }
    const saveKeyBtn = this.modalEl.querySelector('#tour-save-key-btn');
    if (saveKeyBtn) saveKeyBtn.addEventListener('click', () => this.saveKey());

    const startPairBtn = this.modalEl.querySelector('#tour-start-pairing-btn');
    if (startPairBtn) startPairBtn.addEventListener('click', () => this.startKeyPairing());
    const cancelPairBtn = this.modalEl.querySelector('#tour-cancel-pairing-btn');
    if (cancelPairBtn) cancelPairBtn.addEventListener('click', () => { this.stopKeyPairing(); this.updateView(); });

    if (STEPS[this.step] === 'tmdb-key' && storage.hasApiKey()) {
      this.attachStepNav(true);
    } else if (STEPS[this.step] === 'tmdb-key') {
      this.attachStepNav(false, true);
    }

    // Providers step
    const browsePacksBtn = this.modalEl.querySelector('#tour-browse-packs-btn');
    if (browsePacksBtn) browsePacksBtn.addEventListener('click', () => this.loadCatalog());
    this.modalEl.querySelectorAll('.install-pack-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => this.installFromCatalog(e.currentTarget.dataset.manifestUrl));
    });
    if (STEPS[this.step] === 'providers') {
      this.attachStepNav(true, true);
    }
  }

  // Appends a Back/Skip/Next row under the step body. `canAdvance` gates the
  // primary button; `allowSkip` shows a secondary "Skip" that advances anyway.
  attachStepNav(canAdvance, allowSkip = false) {
    const body = this.modalEl.querySelector('#tour-step-body');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-top:28px;';
    row.innerHTML = `
      <button class="btn btn-secondary focusable" id="tour-back-btn" style="padding: 10px 22px; font-size: 14px;">${icon('chevron-left', { size: 16 })} Back</button>
      <div style="display:flex; gap:12px;">
        ${allowSkip ? `<button class="btn btn-secondary focusable" id="tour-skip-step-btn" style="padding: 10px 22px; font-size: 14px;">Skip</button>` : ''}
        <button class="btn btn-primary focusable" id="tour-advance-btn" style="padding: 10px 26px; font-size: 14px;" ${canAdvance ? '' : 'disabled'}>Next ${icon('chevron-right', { size: 16 })}</button>
      </div>
    `;
    body.appendChild(row);
    row.querySelector('#tour-back-btn').addEventListener('click', () => this.prevStep());
    const skipStepBtn = row.querySelector('#tour-skip-step-btn');
    if (skipStepBtn) skipStepBtn.addEventListener('click', () => this.nextStep());
    const advanceBtn = row.querySelector('#tour-advance-btn');
    if (canAdvance) advanceBtn.addEventListener('click', () => this.nextStep());
  }

  async saveKey() {
    const feedback = this.modalEl.querySelector('#tour-key-feedback');
    const trimmed = this.keyInput.trim();
    if (!trimmed) {
      if (feedback) { feedback.style.color = '#ef4444'; feedback.textContent = 'Please type or paste an API Key first.'; }
      return;
    }
    if (feedback) { feedback.style.color = '#fbbf24'; feedback.textContent = 'Validating key with TMDB...'; }

    const result = await tmdb.testApiKey(trimmed);
    if (result.success) {
      storage.setApiKey(trimmed);
      tmdb.clearCache();
      this.stopKeyPairing();
      this.updateView();
    } else if (feedback) {
      feedback.style.color = '#ef4444';
      feedback.textContent = `Invalid TMDB key: ${result.error}`;
    }
  }

  async startKeyPairing() {
    const available = await isRelayAvailable();
    if (!available) {
      this.pairing = { status: 'error', message: 'Phone pairing needs the local TizenBrew service — enter the key on the TV instead.' };
      this.updateView();
      return;
    }
    try {
      const res = await fetch(`${RELAY_BASE}/pair/start?kind=tmdb_key`);
      const data = await res.json();
      this.pairing = { code: data.code, pairUrl: data.pairUrl, expiresAt: data.expiresAt, ssid: data.ssid || null, status: 'pending' };
      this.updateView();
      this.pollKeyPairing();
    } catch (e) {
      this.pairing = { status: 'error', message: `Could not start pairing: ${e.message}` };
      this.updateView();
    }
  }

  renderQrCode() {
    const canvas = this.modalEl.querySelector('#tour-pairing-qr-canvas');
    if (!canvas || !this.pairing) return;
    QRCode.toCanvas(canvas, this.pairing.pairUrl, { width: 150, margin: 1 }, (err) => {
      if (err) console.warn('[SetupTourModal] QR render failed:', err);
    });
  }

  pollKeyPairing() {
    clearTimeout(this.pairingPollTimer);
    if (!this.pairing || this.pairing.status !== 'pending') return;

    if (Date.now() > this.pairing.expiresAt) {
      this.startKeyPairing(); // silently mint a fresh code so the QR stays scannable
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
          } else if (result.apiKey) {
            const testResult = await tmdb.testApiKey(result.apiKey);
            if (testResult.success) {
              storage.setApiKey(result.apiKey);
              tmdb.clearCache();
              this.pairing = { status: 'done', message: 'Key received from your phone and saved!' };
            } else {
              this.pairing = { status: 'error', message: `Received a key but TMDB rejected it: ${testResult.error}` };
            }
          } else {
            this.pairing = { status: 'error', message: 'No key was received.' };
          }
          this.updateView();
          return;
        }
        if (data.state === 'expired') {
          this.startKeyPairing(); // silently mint a fresh code so the QR stays scannable
          return;
        }
        this.pollKeyPairing();
      } catch {
        this.pollKeyPairing();
      }
    }, 2000);
  }

  stopKeyPairing() {
    clearTimeout(this.pairingPollTimer);
    this.pairing = null;
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
      await installPackDirect(manifestUrl);
      this.catalogInstalling = null;
      this.updateView();
    } catch (e) {
      this.catalogInstalling = null;
      this.catalog = { error: `Install failed: ${e.message}` };
      this.updateView();
    }
  }

  nextStep() {
    this.stopKeyPairing();
    if (this.step < STEPS.length - 1) {
      this.step += 1;
      this.updateView();
    }
  }

  prevStep() {
    this.stopKeyPairing();
    if (this.step > 0) {
      this.step -= 1;
      this.updateView();
    }
  }

  finish() {
    this.stopKeyPairing();
    storage.setSetupTourSeen();
    nav.popBackHandler(this.backHandler);
    nav.clearScope(this.modalEl);
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
    if (this.onComplete) this.onComplete();
  }
}
