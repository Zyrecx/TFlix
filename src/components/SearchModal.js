import { tmdb } from '../api/tmdb.js';
import { storage } from '../store/storage.js';
import { nav } from '../nav/spatialNav.js';
import { icon } from '../ui/icons.js';

export class SearchModal {
  constructor({ onSelectMedia, onClose }) {
    this.onSelectMedia = onSelectMedia;
    this.onClose = onClose;
    this.query = '';
    this.results = [];
    this.searchTimer = null;
    this.modalEl = null;
    this.backHandler = this.close.bind(this);
  }

  render() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-overlay';

    this.modalEl.innerHTML = `
      <div class="modal-container search-container" style="max-width: 1050px; max-height: 90vh;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <h2 style="font-size: 26px; font-weight: 800; color: #fff;">Search Catalog</h2>
            <p style="font-size: 13px; color: #71717a;">Type using Samsung TV keyboard or phone via SmartThings</p>
          </div>
          <button class="btn btn-secondary focusable" id="search-close-btn" style="padding: 6px 16px; font-size: 14px;">${icon('x')} Close</button>
        </div>

        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 24px;">
          <input 
            type="text" 
            id="search-input" 
            class="focusable primary-focus" 
            placeholder="Search movies, TV series, titles..." 
            value="${this.query}" 
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            style="flex: 1; background: #16161f; border: 2px solid rgba(255,255,255,0.15); border-radius: 10px; padding: 16px 20px; color: #fff; font-size: 20px; font-weight: 600; outline: none; transition: border-color 0.2s;"
          />
          <button class="btn btn-secondary focusable" id="search-clear-btn" style="padding: 16px 20px; font-size: 15px;">
            Clear
          </button>
        </div>

        <div>
          <h3 id="results-count" style="font-size: 17px; font-weight: 700; margin-bottom: 14px; color: #d4d4d8;">Search Results</h3>
          <div class="search-results-grid" id="search-results-grid" style="max-height: 55vh;">
            <div style="color: #71717a; padding: 30px 10px; text-align: center;">
              Select the search box above to start searching.
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);

    // Input listeners
    const searchInput = this.modalEl.querySelector('#search-input');
    searchInput.addEventListener('input', (e) => {
      this.query = e.target.value;
      this.triggerSearch();
    });

    // Clear button
    this.modalEl.querySelector('#search-clear-btn').addEventListener('click', () => {
      this.query = '';
      searchInput.value = '';
      searchInput.focus();
      this.triggerSearch();
    });

    this.modalEl.querySelector('#search-close-btn').addEventListener('click', () => this.close());

    nav.setScope(this.modalEl);
    nav.pushBackHandler(this.backHandler);

    return this.modalEl;
  }

  triggerSearch() {
    clearTimeout(this.searchTimer);
    const grid = this.modalEl.querySelector('#search-results-grid');
    const countEl = this.modalEl.querySelector('#results-count');

    if (!this.query.trim()) {
      if (grid) grid.innerHTML = '<div style="color: #71717a; padding: 30px 10px; text-align: center;">Select the search box above to start searching.</div>';
      if (countEl) countEl.textContent = 'Search Results';
      return;
    }

    if (!storage.hasApiKey()) {
      if (grid) grid.innerHTML = '<div style="color: #ef4444; padding: 30px 10px; text-align: center;">TMDB API Key required. Please enter your API key in Settings.</div>';
      if (countEl) countEl.textContent = 'Key Required';
      return;
    }

    if (grid) grid.innerHTML = '<div style="color: #71717a; padding: 30px 10px; text-align: center;">Searching TMDB catalog...</div>';

    this.searchTimer = setTimeout(async () => {
      try {
        this.results = await tmdb.searchMulti(this.query);
        if (countEl) countEl.textContent = `Found ${this.results.length} results for "${this.query}"`;
        
        if (this.results.length === 0) {
          if (grid) grid.innerHTML = '<div style="color: #71717a; padding: 30px 10px; text-align: center;">No movies or TV shows matched your search.</div>';
          return;
        }

        if (grid) {
          grid.innerHTML = '';
          this.results.forEach(item => {
            const card = document.createElement('div');
            card.className = 'media-card focusable';
            card.setAttribute('tabindex', '0');

            const itemTitle = item.title || item.name || 'Untitled';
            const posterUrl = tmdb.getImageUrl(item.poster_path, 'w500');
            const year = (item.release_date || item.first_air_date || '').substring(0, 4);
            const type = item.media_type === 'tv' ? 'TV' : 'Movie';

            card.innerHTML = `
              <img src="${posterUrl}" alt="${itemTitle}" loading="lazy" />
              <div class="media-card-info">
                <div class="media-card-title">${itemTitle}</div>
                <div class="media-card-sub">
                  <span>${year}</span>
                  <span style="color:#e50914; font-weight:700;">${type}</span>
                </div>
              </div>
            `;

            card.addEventListener('click', () => {
              this.onSelectMedia(item);
            });

            grid.appendChild(card);
          });
        }
      } catch (err) {
        console.error('Search error:', err);
        if (grid) grid.innerHTML = `<div style="color: #e50914; padding: 30px 10px; text-align: center;">Search failed: ${err.message}</div>`;
      }
    }, 250);
  }

  close() {
    clearTimeout(this.searchTimer);
    nav.popBackHandler(this.backHandler);
    nav.clearScope(this.modalEl);
    if (this.modalEl && this.modalEl.parentNode) {
      this.modalEl.parentNode.removeChild(this.modalEl);
    }
    if (this.onClose) this.onClose();
  }
}
