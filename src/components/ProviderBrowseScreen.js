/**
 * Per-provider native-catalog browse screen — the dedicated UI a
 * catalogMode: 'native' provider pack gets instead of appearing in TMDB-driven
 * browsing. See docs/PROVIDER_PACKS.md's "Native catalogs" section and
 * NATIVE_CATALOG_PLAN.md §3.3.
 *
 * Browsing, search, season/episode picking, and playback (via `onPlayNative`,
 * wired by the caller to `PlayerModal({ nativeMode: true })`, see
 * NATIVE_CATALOG_PLAN.md §5 phase 4) all work end to end.
 */

import { tmdb } from '../api/tmdb.js';
import { storage } from '../store/storage.js';
import { nav } from '../nav/spatialNav.js';
import { icon } from '../ui/icons.js';
import { createMediaRow } from './MediaRow.js';
import { openRangeMenu } from '../ui/rangeMenu.js';
import { browseNativeCatalog, searchNativeCatalog, getNativeSeasons, listNativeEpisodes } from '../api/providers.js';

// Same chunking as DetailsModal.js/EpisodeDrawer.js — a native catalog with a
// 1000+ episode season (e.g. long-running anime) renders/D-pads just as badly
// as a TMDB one without this.
const EP_CHUNK_SIZE = 25;

// Cap on a category row's accumulated items across repeated "Load more"
// clicks — see renderCategorySection's Load more handler.
const MAX_CATEGORY_ITEMS = 60;

// Normalizes a native catalog item ({ id, title, year, poster, type }) into
// the field names MediaRow.js/tmdb.getImageUrl() already expect, so the
// existing card renderer needs zero awareness the item isn't TMDB's.
function normalizeItem(item, providerId) {
  return {
    id: item.id,
    source: providerId,
    title: item.title,
    name: item.title,
    poster_path: item.poster || null,
    media_type: item.type === 'tv' ? 'tv' : 'movie',
    mediaType: item.type === 'tv' ? 'tv' : 'movie',
    release_date: item.year ? `${item.year}-01-01` : '',
    first_air_date: item.year ? `${item.year}-01-01` : '',
    _native: item
  };
}

export class ProviderBrowseScreen {
  constructor({ provider, onPlayNative }) {
    this.provider = provider; // { id, name, catalogCategories, catalogTypes, ... }
    this.onPlayNative = onPlayNative; // (media) => void — see docs above
    this.containerEl = null;
    this.detailsEl = null;
    this.detailsBackHandler = null;
    // The catalog item currently shown in the native-details overlay — kept
    // around so attachPlayHandler() can pull title/poster for the media
    // object it hands to onPlayNative without a second fetch.
    this.currentNativeItem = null;
    // { [categoryId]: { page, hasMore, loading } } — per-row paging state.
    this.categoryState = {};
    // Range-chunking state for the currently open season — see
    // loadEpisodesInto/computeRanges below.
    this.episodes = [];
    this.ranges = null;
    this.selectedRangeStart = 1;
  }

  render() {
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'provider-browse-screen';
    this.containerEl.style.padding = '100px 48px 48px';

    const header = document.createElement('div');
    header.style.marginBottom = '24px';
    header.innerHTML = `
      <h2 style="font-size: 28px; font-weight: 800; margin-bottom: 6px;">${this.provider.name}</h2>
      <p style="color: #a1a1aa; font-size: 14px; margin-bottom: 20px;">Native catalog — browsed and played independently of TMDB.</p>
      <div class="search-input-wrap" style="max-width: 480px; display: flex; gap: 10px;">
        <input type="text" id="native-search-input" class="focusable" placeholder="Search ${this.provider.name}..."
          style="flex: 1; padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: #181824; color: #fff; font-size: 14px;" />
        <button class="btn btn-primary focusable" id="native-search-btn" style="padding: 12px 20px;">${icon('search', { size: 16 })}</button>
      </div>
    `;
    this.containerEl.appendChild(header);

    const searchInput = header.querySelector('#native-search-input');
    const searchBtn = header.querySelector('#native-search-btn');
    const runSearch = () => {
      const q = searchInput.value.trim();
      if (q) this.renderSearchResults(q);
      else this.renderCategories();
    };
    searchBtn.addEventListener('click', runSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    this.rowsContainer = document.createElement('div');
    this.containerEl.appendChild(this.rowsContainer);

    this.renderCategories();

    return this.containerEl;
  }

  async renderSearchResults(query) {
    this.rowsContainer.innerHTML = `<div style="color:#a1a1aa; padding: 20px 0;">Searching...</div>`;
    try {
      const { items } = await searchNativeCatalog(this.provider.id, query);
      this.rowsContainer.innerHTML = '';
      const row = createMediaRow({
        title: `Results for "${query}"`,
        icon: 'search',
        items: items.map(i => normalizeItem(i, this.provider.id)),
        onItemSelect: (item) => this.openNativeDetails(item)
      });
      this.rowsContainer.appendChild(row);
      if (items.length === 0) {
        this.rowsContainer.innerHTML = `<div style="color:#a1a1aa; padding: 20px 0;">No results.</div>`;
      }
    } catch (err) {
      this.rowsContainer.innerHTML = `<div style="color:#ef4444; padding: 20px 0;">Search failed: ${err.message}</div>`;
    }
    setTimeout(() => nav.focusFirstAvailable(), 50);
  }

  renderCategories() {
    this.rowsContainer.innerHTML = '';
    const categories = this.provider.catalogCategories || [];
    if (categories.length === 0) {
      this.rowsContainer.innerHTML = `<div style="color:#a1a1aa; padding: 20px 0;">This provider has no browsable categories.</div>`;
      return;
    }
    categories.forEach(category => this.renderCategoryRow(category));
  }

  async renderCategoryRow(category) {
    const section = document.createElement('div');
    section.className = 'media-section';
    section.innerHTML = `<h2 class="section-title">${category.label}</h2><div style="color:#a1a1aa; padding: 8px 0;">Loading...</div>`;
    this.rowsContainer.appendChild(section);

    this.categoryState[category.id] = { page: 1, hasMore: false, items: [] };

    try {
      const { items, hasMore } = await browseNativeCatalog(this.provider.id, category.id, 1);
      this.categoryState[category.id] = { page: 1, hasMore, items };
      this.renderCategorySection(section, category);
    } catch (err) {
      section.innerHTML = `<h2 class="section-title">${category.label}</h2><div style="color:#ef4444; padding: 8px 0;">Failed to load: ${err.message}</div>`;
    }
  }

  renderCategorySection(section, category) {
    const state = this.categoryState[category.id];
    section.innerHTML = '';

    const titleEl = document.createElement('h2');
    titleEl.className = 'section-title';
    titleEl.textContent = category.label;
    section.appendChild(titleEl);

    if (state.items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#a1a1aa; padding: 8px 0;';
      empty.textContent = 'Nothing here yet.';
      section.appendChild(empty);
      return;
    }

    const row = createMediaRow({
      title: '',
      items: state.items.map(i => normalizeItem(i, this.provider.id)),
      onItemSelect: (item) => this.openNativeDetails(item)
    });
    // createMediaRow always renders its own title element (even if empty) —
    // drop it here since this section already has its own titleEl above.
    const innerTitle = row.querySelector('.section-title');
    if (innerTitle) innerTitle.remove();
    section.appendChild(row);

    if (state.hasMore) {
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.className = 'btn btn-secondary focusable';
      loadMoreBtn.style.marginTop = '10px';
      loadMoreBtn.textContent = state.loading ? 'Loading...' : 'Load more';
      loadMoreBtn.disabled = Boolean(state.loading);
      loadMoreBtn.addEventListener('click', async () => {
        if (state.loading) return;
        state.loading = true;
        loadMoreBtn.textContent = 'Loading...';
        loadMoreBtn.disabled = true;
        try {
          const next = await browseNativeCatalog(this.provider.id, category.id, state.page + 1);
          state.page += 1;
          state.hasMore = next.hasMore;
          // Cap accumulated items rather than concat-ing forever — an
          // unbounded row here means an unbounded focusable-element count on
          // this screen, which spatialNav.js has to re-check on every single
          // D-pad press for as long as this screen stays open. Dropping the
          // oldest items keeps "Load more" usable without that cost growing
          // without limit the longer a user browses one category.
          state.items = state.items.concat(next.items).slice(-MAX_CATEGORY_ITEMS);
          state.loading = false;
          this.renderCategorySection(section, category);
        } catch (err) {
          state.loading = false;
          loadMoreBtn.textContent = 'Retry';
          loadMoreBtn.disabled = false;
        }
      });
      section.appendChild(loadMoreBtn);
    }
  }

  // Lightweight native-details overlay — deliberately not a branch of
  // DetailsModal (see docs/PROVIDER_PACKS.md/§0.9): no TMDB id exists to
  // fetch details for, so this just uses the already-fetched catalog item.
  //
  // `resume` ({ season, episodeId, episodeNumber }), when passed by
  // resumeHistoryItem (app.js), adds a "Resume S{season} E{episodeNumber}"
  // primary button — same "show details, don't jump straight into
  // playback" behavior TMDB's Continue Watching gets from DetailsModal,
  // rather than the native path just calling openPlayer directly. The
  // season tabs/episode grid below it still work normally for picking a
  // different episode.
  async openNativeDetails(item, resume = null) {
    const native = item._native;
    const isTv = native.type === 'tv';
    this.currentNativeItem = native;

    this.detailsEl = document.createElement('div');
    this.detailsEl.className = 'modal-overlay';
    this.detailsEl.innerHTML = `
      <div class="modal-container" style="max-width: 600px; padding: 36px;">
        <div style="display:flex; gap:20px; margin-bottom: 20px;">
          <img src="${tmdb.getImageUrl(native.poster, 'w342')}" alt="${native.title}" style="width:120px; border-radius:8px; flex-shrink:0;" />
          <div>
            <h2 style="font-size: 22px; font-weight: 800; margin-bottom: 6px;">${native.title}</h2>
            <p style="color:#a1a1aa; font-size: 13px;">${native.year || ''} · ${isTv ? 'TV Series' : 'Movie'} · ${this.provider.name}</p>
          </div>
        </div>
        <div id="native-details-body">
          ${isTv ? '<div style="color:#a1a1aa;">Loading seasons...</div>' : ''}
        </div>
        <div style="display:flex; gap:10px; margin-top: 20px;">
          ${resume ? `
            <button class="btn btn-primary focusable primary-focus" id="native-details-resume">
              ${icon('play')} Resume S${resume.season} E${resume.episodeNumber}
            </button>
          ` : ''}
          <button class="btn btn-secondary focusable" id="native-details-watchlist">
            ${storage.isInWatchlist(this.provider.id, native.id) ? `${icon('bookmark-check')} In Watchlist` : `${icon('bookmark-plus')} Watchlist`}
          </button>
          <button class="btn btn-secondary focusable ${resume ? '' : 'primary-focus'}" id="native-details-close">
            ${icon('x')} Close
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(this.detailsEl);
    nav.setScope(this.detailsEl);
    this.detailsBackHandler = () => this.closeNativeDetails();
    nav.pushBackHandler(this.detailsBackHandler);

    this.detailsEl.querySelector('#native-details-close').addEventListener('click', () => this.closeNativeDetails());

    if (resume) {
      this.detailsEl.querySelector('#native-details-resume').addEventListener('click', () => {
        this.closeNativeDetails();
        if (!this.onPlayNative) return;
        this.onPlayNative({
          id: resume.episodeId,
          nativeShowId: native.id,
          source: this.provider.id,
          media_type: 'tv',
          mediaType: 'tv',
          title: native.title,
          name: native.title,
          poster_path: native.poster || null,
          backdrop_path: null,
          season: resume.season,
          episode: resume.episodeNumber
        });
      });
    }

    const watchlistBtn = this.detailsEl.querySelector('#native-details-watchlist');
    watchlistBtn.addEventListener('click', () => {
      if (storage.isInWatchlist(this.provider.id, native.id)) {
        storage.removeFromWatchlist(this.provider.id, native.id);
        watchlistBtn.innerHTML = `${icon('bookmark-plus')} Watchlist`;
      } else {
        storage.addToWatchlist({
          id: native.id,
          source: this.provider.id,
          title: native.title,
          name: native.title,
          poster_path: native.poster || null,
          media_type: isTv ? 'tv' : 'movie',
          mediaType: isTv ? 'tv' : 'movie',
          release_date: native.year ? `${native.year}-01-01` : '',
          first_air_date: native.year ? `${native.year}-01-01` : ''
        });
        watchlistBtn.innerHTML = `${icon('bookmark-check')} In Watchlist`;
      }
    });

    if (!isTv) {
      const body = this.detailsEl.querySelector('#native-details-body');
      body.innerHTML = this.renderPlayButton(native.id, false, 1, 1);
      this.attachPlayHandler(body, native.id, false, 1, 1);
      return;
    }

    try {
      const { seasons } = await getNativeSeasons(this.provider.id, native.id);
      if (seasons.length === 0) {
        await this.loadEpisodesInto(native.id, null);
      } else {
        this.renderSeasonPicker(native.id, seasons, resume);
      }
    } catch (err) {
      const body = this.detailsEl.querySelector('#native-details-body');
      if (body) body.innerHTML = `<div style="color:#ef4444;">Failed to load seasons: ${err.message}</div>`;
    }
  }

  renderSeasonPicker(nativeId, seasons, resume = null) {
    const body = this.detailsEl.querySelector('#native-details-body');
    if (!body) return;
    // Land on the season the Resume button points at, if any, rather than
    // always season 1 — matches the resume target shown above.
    const initialIdx = resume ? Math.max(0, Math.min(seasons.length - 1, resume.season - 1)) : 0;
    body.innerHTML = `
      <div style="margin-bottom: 12px; font-weight: 700;">Season</div>
      <div class="season-tabs">
        ${seasons.map((s, i) => `<button class="season-btn focusable ${i === initialIdx ? 'active' : ''}" data-season-id="${s.id}">${s.label}</button>`).join('')}
      </div>
      <div id="native-episodes-body" style="margin-top: 16px;"></div>
    `;
    // getSeasons only returns { id, label } — no explicit season number — so
    // the season number threaded to resolve()/storage is the season's
    // 1-based position in this list, matching TMDB's own season numbering
    // convention.
    body.querySelectorAll('.season-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        body.querySelectorAll('.season-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.loadEpisodesInto(nativeId, btn.dataset.seasonId, true, idx + 1);
      });
    });
    this.loadEpisodesInto(nativeId, seasons[initialIdx].id, true, initialIdx + 1);
  }

  async loadEpisodesInto(nativeId, seasonId, seasonPickerAlreadyRendered = false, seasonNumber = 1) {
    const targetSelector = seasonPickerAlreadyRendered ? '#native-episodes-body' : '#native-details-body';
    const target = this.detailsEl.querySelector(targetSelector);
    if (!target) return;
    target.innerHTML = '<div style="color:#a1a1aa;">Loading episodes...</div>';
    try {
      const { episodes } = await listNativeEpisodes(this.provider.id, nativeId, seasonId);
      if (episodes.length === 0) {
        target.innerHTML = '<div style="color:#a1a1aa;">No episodes found.</div>';
        return;
      }
      this.episodes = episodes;
      this.ranges = this.computeRanges(episodes);
      this.selectedRangeStart = episodes[0].number;

      target.innerHTML = `
        <button class="range-picker-btn focusable" id="native-range-btn" hidden></button>
        <div id="native-episodes-list"></div>
      `;
      const rangeBtn = target.querySelector('#native-range-btn');
      rangeBtn.addEventListener('click', () => this.openRangePicker(target, seasonNumber));
      this.updateRangeButton(target);
      this.renderEpisodeButtons(target, seasonNumber);
    } catch (err) {
      target.innerHTML = `<div style="color:#ef4444;">Failed to load episodes: ${err.message}</div>`;
    }
  }

  /**
   * Splits episodes into fixed-size ranges (e.g. "1-25", "26-50"), returning
   * null when the season is short enough that chunking would just be noise —
   * same behavior as DetailsModal.js/EpisodeDrawer.js.
   */
  computeRanges(episodes) {
    if (episodes.length <= EP_CHUNK_SIZE) return null;
    const nums = episodes.map(e => e.number);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const ranges = [];
    for (let start = min; start <= max; start += EP_CHUNK_SIZE) {
      ranges.push({ start, end: Math.min(start + EP_CHUNK_SIZE - 1, max) });
    }
    return ranges;
  }

  rangeContaining(episodeNumber) {
    if (!this.ranges) return null;
    return this.ranges.find(r => episodeNumber >= r.start && episodeNumber <= r.end) || this.ranges[0];
  }

  updateRangeButton(target) {
    const rangeBtn = target.querySelector('#native-range-btn');
    if (!rangeBtn) return;
    if (!this.ranges) {
      rangeBtn.hidden = true;
      return;
    }
    const current = this.rangeContaining(this.selectedRangeStart);
    rangeBtn.hidden = false;
    rangeBtn.innerHTML = `Episodes ${current.start}–${current.end} ${icon('chevron-down', { size: 14 })}`;
  }

  openRangePicker(target, seasonNumber) {
    if (!this.ranges) return;
    openRangeMenu({
      ranges: this.ranges,
      currentStart: this.selectedRangeStart,
      onSelect: (start) => {
        this.selectedRangeStart = start;
        this.updateRangeButton(target);
        this.renderEpisodeButtons(target, seasonNumber);
      }
    });
  }

  renderEpisodeButtons(target, seasonNumber) {
    const listEl = target.querySelector('#native-episodes-list');
    if (!listEl) return;
    const currentRange = this.rangeContaining(this.selectedRangeStart);
    const visibleEpisodes = currentRange
      ? this.episodes.filter(ep => ep.number >= currentRange.start && ep.number <= currentRange.end)
      : this.episodes;

    listEl.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${visibleEpisodes.map(ep => `
          <button class="btn btn-secondary focusable" data-episode-id="${ep.id}" data-episode-number="${ep.number}" style="padding: 8px 14px; font-size: 13px;" ${ep.title ? `title="${ep.title.replace(/"/g, '&quot;')}"` : ''}>
            Episode ${ep.number}
          </button>
        `).join('')}
      </div>
    `;
    listEl.querySelectorAll('[data-episode-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const epId = btn.dataset.episodeId;
        const epNum = Number(btn.dataset.episodeNumber) || 1;
        target.innerHTML = this.renderPlayButton(epId, true, seasonNumber, epNum);
        this.attachPlayHandler(target, epId, true, seasonNumber, epNum);
      });
    });
  }

  renderPlayButton(nativeId, isTv, season, episode) {
    return `
      <button class="btn btn-primary focusable primary-focus" id="native-play-btn" style="margin-top: 8px;">
        ${icon('play')} Play
      </button>
    `;
  }

  // Builds the { id, source, ... } media object PlayerModal(nativeMode: true)
  // expects — see NATIVE_CATALOG_PLAN.md §3.3/§5. `id` is the pack's own
  // native id (episode id for TV, item id for a movie) — what resolve()
  // needs, per docs/PROVIDER_PACKS.md's "Native catalogs" section. That's
  // NOT a stable per-show identity for a TV item (a new id per episode), so
  // `nativeShowId` (the catalog item's own id, constant across episodes)
  // rides along separately for storage/history keying — see PlayerModal.js's
  // getStorageId().
  attachPlayHandler(container, nativeId, isTv, season, episode) {
    const btn = container.querySelector('#native-play-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!this.onPlayNative) return;
      const item = this.currentNativeItem || {};
      const title = item.title || 'Playing Media';
      const media = {
        id: nativeId,
        nativeShowId: item.id,
        source: this.provider.id,
        media_type: isTv ? 'tv' : 'movie',
        mediaType: isTv ? 'tv' : 'movie',
        title,
        name: title,
        poster_path: item.poster || null,
        backdrop_path: null,
        season,
        episode
      };
      this.closeNativeDetails();
      this.onPlayNative(media);
    });
  }

  closeNativeDetails() {
    if (!this.detailsEl) return;
    if (this.detailsBackHandler) nav.popBackHandler(this.detailsBackHandler);
    nav.clearScope(this.detailsEl);
    if (this.detailsEl.parentNode) this.detailsEl.parentNode.removeChild(this.detailsEl);
    this.detailsEl = null;
    this.detailsBackHandler = null;
    this.currentNativeItem = null;
  }
}
