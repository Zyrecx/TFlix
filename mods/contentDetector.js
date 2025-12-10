/**
 * Cineby.gd Content Detector and Enhancer
 * This module detects and enhances specific elements on Cineby.gd
 */

/**
 * Detect and enhance content cards/items
 */
function enhanceContentItems() {
  const selectors = [
    // Common movie/show card selectors - update these after inspecting the actual site
    '.movie-card', 
    '.content-item', 
    '.film-item',
    '.show-card',
    // Typical class names for grid items
    '.grid-item', 
    '.card',
    // Image containers
    '.poster-container',
    '.thumbnail',
    // Any anchors with images (likely to be content items)
    'a:has(img)'
  ];
  
  // Find all content items using the selectors
  const allSelectors = selectors.join(', ');
  const contentItems = document.querySelectorAll(allSelectors);
  
  // Make each item focusable and add navigation attributes
  contentItems.forEach((item, index) => {
    // Ensure the item is focusable
    if (!item.getAttribute('tabindex')) {
      item.setAttribute('tabindex', '0');
    }
    
    // Add data attribute for easier selection
    item.setAttribute('data-tflix-item', index);
    
    // Special handling for Cineby.gd
    if (window.location.hostname.includes('cineby.gd')) {
      const anchor = item.tagName === 'A' ? item : item.querySelector('a');
      if (anchor && anchor.href && anchor.href.includes('/movie/')) {
        // Add a special click handler for Cineby movie links
        item.addEventListener('click', (e) => {
          // Make sure the link loads correctly without going to a black screen
          e.preventDefault();
          
          // Show loading toast
          showVideoInfoToast('Loading movie info...');
          
          // Navigate to the movie page
          window.location.href = anchor.href;
        });
      } else if (item.tagName !== 'A' && !item.onclick) {
        // Standard handling for non-anchor items
        item.addEventListener('click', () => {
          // If there's an anchor inside, click it
          const anchor = item.querySelector('a');
          if (anchor) {
            anchor.click();
          }
        });
      }
    } else {
      // Standard handling for non-Cineby sites
      if (item.tagName !== 'A' && !item.onclick) {
        item.addEventListener('click', () => {
          // If there's an anchor inside, click it
          const anchor = item.querySelector('a');
          if (anchor) {
            anchor.click();
          }
        });
      }
    }
    
    // Add focus and blur event listeners
    item.addEventListener('focus', () => {
      item.classList.add('tflix-focused');
    });
    
    item.addEventListener('blur', () => {
      item.classList.remove('tflix-focused');
    });
  });
  
  // For Cineby.gd, detect and enhance play buttons specifically
  if (window.location.hostname.includes('cineby.gd')) {
    enhanceCinebyPlayButtons();
  }
}

/**
 * Enhance navigation menus for better remote control navigation
 */
function enhanceNavigationMenus() {
  const navSelectors = [
    'nav',
    'header nav',
    '.main-nav',
    '.navigation',
    '.menu',
    '.sidebar'
  ];
  
  // Find all navigation containers
  const navContainers = document.querySelectorAll(navSelectors.join(', '));
  
  navContainers.forEach(nav => {
    // Find all navigation items/links
    const navItems = nav.querySelectorAll('a, button');
    
    navItems.forEach((item, index) => {
      // Ensure the item is focusable
      if (!item.getAttribute('tabindex')) {
        item.setAttribute('tabindex', '0');
      }
      
      // Add data attribute for easier selection
      item.setAttribute('data-tflix-nav-item', index);
      
      // Add focus and blur event listeners
      item.addEventListener('focus', () => {
        item.classList.add('tflix-focused');
      });
      
      item.addEventListener('blur', () => {
        item.classList.remove('tflix-focused');
      });
    });
  });
}

/**
 * Enhance video player controls and interaction
 */
function enhanceVideoPlayer() {
  const videoPlayer = document.querySelector('video');
  if (!videoPlayer) return;
  
  // Add focus capability to native controls if they exist
  const controls = document.querySelectorAll('.video-controls button, .player-controls button');
  controls.forEach((control, index) => {
    // Ensure the control is focusable
    if (!control.getAttribute('tabindex')) {
      control.setAttribute('tabindex', '0');
    }
    
    // Add data attribute for easier selection
    control.setAttribute('data-tflix-control', index);
    
    // Add focus and blur event listeners
    control.addEventListener('focus', () => {
      control.classList.add('tflix-focused');
    });
    
    control.addEventListener('blur', () => {
      control.classList.remove('tflix-focused');
    });
  });
}

/**
 * Enhance search functionality
 */
function enhanceSearchFunctionality() {
  // Look for search icon, button or input
  const searchSelectors = [
    // Common search elements
    'input[type="search"]',
    'input[placeholder*="search" i]',
    'input[placeholder*="find" i]',
    'button[aria-label*="search" i]',
    '.search-button',
    '.search-icon',
    'a[href*="search"]',
    // Icon based search
    'svg[class*="search" i]',
    'i[class*="search" i]',
    // Parent containers
    '.search-container',
    'form[action*="search"]'
  ];
  
  const searchElements = document.querySelectorAll(searchSelectors.join(', '));
  
  searchElements.forEach(element => {
    // Make the search element more prominent and focusable
    element.setAttribute('tabindex', '0');
    element.setAttribute('data-tflix-search', 'true');
    
    // Add specific styling to make it stand out
    element.classList.add('tflix-search-element');
    
    // Make parent element focusable too
    if (element.parentElement && !element.parentElement.getAttribute('tabindex')) {
      element.parentElement.setAttribute('tabindex', '0');
      element.parentElement.setAttribute('data-tflix-search-parent', 'true');
    }
    
    // Ensure clicking activates search
    element.addEventListener('click', () => {
      activateSearch(element);
    });
    
    // On focus, show a toast to inform user they can press OK to search
    element.addEventListener('focus', () => {
      showSearchToast();
    });
  });
  
  // Add specific handler for the navigation/header area
  addSearchNavigationHandler();
}

/**
 * Add specific handler for navigation/header search
 */
function addSearchNavigationHandler() {
  // Try to find a header or navigation
  const headerElements = document.querySelectorAll('header, nav, .header, .navigation, .top-bar');
  
  headerElements.forEach(header => {
    // Look for potential search elements in the header
    const searchLink = Array.from(header.querySelectorAll('a')).find(a => 
      a.textContent.toLowerCase().includes('search') || 
      a.href.includes('search') ||
      a.getAttribute('aria-label')?.toLowerCase().includes('search')
    );
    
    if (searchLink) {
      searchLink.setAttribute('tabindex', '0');
      searchLink.setAttribute('data-tflix-search-nav', 'true');
      
      // Add clear styling
      searchLink.classList.add('tflix-search-element');
      
      // Ensure Enter key activates search
      searchLink.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.location.href = searchLink.href;
        }
      });
    }
  });
  
  // If the site is cineby.gd, specifically look for the search link
  if (window.location.hostname.includes('cineby.gd')) {
    // Make search more accessible without requiring keyboard shortcuts
    const searchLinks = document.querySelectorAll('a[href*="search"]');
    searchLinks.forEach(link => {
      link.setAttribute('tabindex', '0');
      link.classList.add('tflix-search-element');
    });
  }
}

/**
 * Check if element is an input field
 * @param {Element} element - Element to check
 * @returns {boolean} - True if it's an input element
 */
function isInputElement(element) {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || 
         element.isContentEditable || 
         element.getAttribute('role') === 'textbox';
}

/**
 * Activate search functionality
 * @param {Element} element - The search element
 */
function activateSearch(element) {
  // If it's an input, focus it
  if (element.tagName.toLowerCase() === 'input') {
    element.focus();
    return;
  }
  
  // If it's a link to search page, navigate to it
  if (element.tagName.toLowerCase() === 'a' && 
      (element.href.includes('search') || element.getAttribute('href')?.includes('search'))) {
    window.location.href = element.href;
    return;
  }
  
  // If it's a button inside a form, submit the form
  const form = element.closest('form');
  if (form) {
    form.submit();
    return;
  }
  
  // For cineby.gd specifically, navigate to the search page
  if (window.location.hostname.includes('cineby.gd')) {
    window.location.href = 'https://www.cineby.gd/search';
    return;
  }
}

/**
 * Show toast informing about search functionality
 */
function showSearchToast() {
  const toast = document.createElement('div');
  toast.className = 'tflix-toast';
  toast.textContent = 'Press OK to access search';
  document.body.appendChild(toast);
  
  // Show the toast
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Hide after 2 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2000);
}

/**
 * Enhance video player with better controls specifically for Cineby.gd
 */
function enhanceCinebyVideoPlayer() {
  // Only run on movie pages
  if (!window.location.pathname.includes('/movie/')) return;
  
  // Try to find the video player
  const videoPlayers = document.querySelectorAll('video');
  if (!videoPlayers.length) {
    // If no video player is found immediately, set up an observer to catch it when it appears
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          for (const node of mutation.addedNodes) {
            if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
              const video = node.nodeName === 'VIDEO' ? node : node.querySelector('video');
              setupVideoPlayerControls(video);
              observer.disconnect();
              return;
            }
          }
        }
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    // If video is already present, set up controls immediately
    videoPlayers.forEach(setupVideoPlayerControls);
  }
}

/**
 * Setup video player controls for Cineby.gd
 * @param {HTMLElement} video - The video element
 */
function setupVideoPlayerControls(video) {
  if (!video) return;
  
  // Store reference to the video
  window.tflixVideoElement = video;
  
  // Make sure the video is visible and styled properly
  video.style.display = 'block';
  video.style.opacity = '1';
  video.style.visibility = 'visible';
  
  // Enable native controls as a fallback
  video.controls = true;
  
  // Add our own key event listeners to control playback
  document.addEventListener('keydown', handleVideoKeyEvents);
  
  // Set initial volume
  if (video.volume > 0.8) {
    video.volume = 0.8; // Default to 80% volume
  }
  
  // Add time display
  addVideoTimeDisplay(video);
}

/**
 * Handle key events for video playback
 * @param {Event} e - The keydown event
 */
function handleVideoKeyEvents(e) {
  const video = window.tflixVideoElement;
  if (!video) return;
  
  // Check if we're on a video page
  if (!window.location.pathname.includes('/movie/')) return;
  
  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      video.volume = Math.min(1, video.volume + 0.1);
      showVideoInfoToast(`Volume: ${Math.round(video.volume * 100)}%`);
      break;
    case 'ArrowDown':
      e.preventDefault();
      video.volume = Math.max(0, video.volume - 0.1);
      showVideoInfoToast(`Volume: ${Math.round(video.volume * 100)}%`);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 10);
      showVideoInfoToast(`- 10 seconds`);
      break;
    case 'ArrowRight':
      e.preventDefault();
      video.currentTime = Math.min(video.duration, video.currentTime + 10);
      showVideoInfoToast(`+ 10 seconds`);
      break;
  }
}

/**
 * Add time display to the video
 * @param {HTMLElement} video - The video element
 */
function addVideoTimeDisplay(video) {
  if (!video) return;
  
  // Create time display element
  const timeDisplay = document.createElement('div');
  timeDisplay.className = 'tflix-video-time';
  
  // Add to the video container
  const videoContainer = video.parentElement;
  if (videoContainer) {
    videoContainer.appendChild(timeDisplay);
  }
  
  // Update time display
  function updateTimeDisplay() {
    if (!video.paused) {
      const current = formatTime(video.currentTime);
      const total = formatTime(video.duration);
      timeDisplay.textContent = `${current} / ${total}`;
      timeDisplay.style.display = 'block';
      
      // Hide after 3 seconds if video is playing
      setTimeout(() => {
        if (!video.paused) {
          timeDisplay.style.display = 'none';
        }
      }, 3000);
    }
  }
  
  // Format time in MM:SS
  function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  // Update time on timeupdate event
  video.addEventListener('timeupdate', updateTimeDisplay);
  video.addEventListener('play', updateTimeDisplay);
  video.addEventListener('pause', updateTimeDisplay);
  video.addEventListener('seeking', updateTimeDisplay);
}

/**
 * Show a toast with video information
 * @param {string} message - The message to display
 */
function showVideoInfoToast(message) {
  let toast = document.querySelector('.tflix-video-toast');
  
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'tflix-video-toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.classList.add('show');
  
  // Hide after 1.5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 1500);
}

/**
 * Enhance play buttons specifically for Cineby.gd
 */
function enhanceCinebyPlayButtons() {
  // Only run on movie info pages
  if (!window.location.pathname.includes('/movie/')) return;
  
  // Common selectors for play buttons
  const playButtonSelectors = [
    'button:contains("Play")',
    'button:contains("Watch")',
    'a:contains("Play")',
    'a:contains("Watch")',
    '.play-button',
    '.watch-button',
    '.play-icon',
    'button[aria-label*="play" i]',
    'button[aria-label*="watch" i]',
    // Any element that might be a play button
    '[class*="play" i]',
    '[class*="watch" i]',
    '[id*="play" i]',
    '[id*="watch" i]',
    // Find button elements by their icon content
    'button svg',
    'a svg'
  ];
  
  // Look for potential play buttons
  const allButtons = document.querySelectorAll('button, a, div[role="button"]');
  
  allButtons.forEach(button => {
    // Check if it's likely a play button
    const isPlayButton = 
      button.textContent?.toLowerCase().includes('play') ||
      button.textContent?.toLowerCase().includes('watch') ||
      button.getAttribute('aria-label')?.toLowerCase().includes('play') ||
      button.getAttribute('aria-label')?.toLowerCase().includes('watch') ||
      button.classList.contains('play-button') ||
      button.classList.contains('watch-button') ||
      button.id?.toLowerCase().includes('play') ||
      button.id?.toLowerCase().includes('watch') ||
      button.querySelector('svg') || // Might be an icon button
      button.querySelector('i[class*="play" i]');
    
    if (isPlayButton) {
      // Make sure it's focusable
      button.setAttribute('tabindex', '0');
      button.setAttribute('data-tflix-play-button', 'true');
      
      // Add clear visual styling
      button.classList.add('tflix-play-button');
      
      // Special handling for play button clicks
      button.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Show loading toast
        showVideoInfoToast('Starting playback...');
        
        // We need to let the original click go through, but prepare
        // for the video to appear and be enhanced
        setupCinebyVideoMonitor();
        
        // Allow the default click to continue after a tiny delay
        setTimeout(() => {
          if (button.tagName === 'A' && button.href) {
            window.location.href = button.href;
          } else {
            // Trigger the original click handler
            const originalClick = button.onclick;
            if (originalClick) {
              originalClick.call(button);
            }
          }
        }, 50);
      });
      
      // Add focus effect
      button.addEventListener('focus', () => {
        button.classList.add('tflix-focused');
      });
      
      button.addEventListener('blur', () => {
        button.classList.remove('tflix-focused');
      });
    }
  });
}

/**
 * Set up a video monitor specifically for Cineby.gd
 * to ensure video plays correctly after clicking play
 */
function setupCinebyVideoMonitor() {
  // Keep track of the current movie page URL
  window.tflixLastMovieUrl = window.location.href;
  
  // Create a more aggressive observer to catch when the video player appears
  const videoObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        for (const node of mutation.addedNodes) {
          // Look for video elements or containers
          if (node.nodeName === 'VIDEO' || 
              (node.querySelector && node.querySelector('video')) ||
              (node.classList && 
                (node.classList.contains('player') || 
                 node.classList.contains('video-player') ||
                 node.classList.contains('player-container')))) {
                   
            // Found a potential video player
            const video = node.nodeName === 'VIDEO' ? 
              node : node.querySelector('video');
            
            if (video) {
              // Apply enhanced video controls
              setupVideoPlayerControls(video);
              
              // Ensure it plays
              setTimeout(() => {
                if (video.paused) {
                  video.play().catch(() => {
                    // Silent error handling
                    showVideoInfoToast('Press Enter to play');
                  });
                }
              }, 1000);
            }
          }
        }
      }
    }
  });
  
  // Start observing
  videoObserver.observe(document.body, { 
    childList: true, 
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'] 
  });
  
  // Set a timeout to disconnect the observer after 10 seconds
  setTimeout(() => {
    videoObserver.disconnect();
  }, 10000);
}

/**
 * Initialize content enhancements
 */
function initializeContentEnhancements() {
  // First run
  detectAndEnhanceContent();
  
  // Set up observer to continue detecting as the DOM changes
  const observer = new MutationObserver(() => {
    detectAndEnhanceContent();
  });
  
  // Start observing document body for DOM changes
  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
}

/**
 * Detect and enhance content based on current DOM
 */
function detectAndEnhanceContent() {
  enhanceContentItems();
  enhanceNavigationMenus();
  enhanceVideoPlayer();
  enhanceSearchFunctionality();
  enhanceCinebyVideoPlayer();
  
  // Special handling for Cineby.gd on movie info pages
  if (window.location.hostname.includes('cineby.gd') && 
      window.location.pathname.includes('/movie/')) {
    enhanceCinebyPlayButtons();
  }
}

// Initialize when the page is loaded
const interval = setInterval(() => {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initializeContentEnhancements();
    clearInterval(interval);
  }
}, 250);

export {
  detectAndEnhanceContent
};
