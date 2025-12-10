/*global navigate*/
import css from './ui.css';

let videoElement = null;
let playerControls = null;
let progressBar = null;
let progressFilled = null;
let hideControlsTimeout = null;

/**
 * Initialize UI enhancements when DOM is loaded
 */
function initializeUI() {
  // Add CSS to head
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  
  // Enable navigation mode
  document.body.classList.add('tflix-navigation-mode');
  
  // Initialize focus on a logical starting element
  initializeFocus();
  
  // Setup event listeners for media control keys
  setupMediaControlListeners();
  
  // Initialize video player enhancements when a video is played
  setupVideoPlayerObserver();
}

/**
 * Find and set initial focus on a logical starting element
 */
function initializeFocus() {
  // Start by focusing on the first navigable element (like a menu item or featured content)
  const initialElements = [
    // Main navigation elements
    document.querySelector('nav a'),
    document.querySelector('.navigation a'),
    document.querySelector('header a'),
    
    // Content cards/items
    document.querySelector('.movie-card'),
    document.querySelector('.content-item'),
    document.querySelector('.film-item'),
    
    // Fallback to any clickable element
    document.querySelector('a'),
    document.querySelector('button')
  ];
  
  // Find the first valid element from our priority list
  const firstElement = initialElements.find(el => el !== null);
  
  if (firstElement) {
    firstElement.classList.add('tflix-focused');
    firstElement.focus();
    ensureElementIsVisible(firstElement);
  }
}

/**
 * Ensure the element is visible in the viewport
 * @param {HTMLElement} element - element to make visible
 */
function ensureElementIsVisible(element) {
  if (!element) return;
  
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'nearest'
  });
}

/**
 * Setup media control key event listeners
 */
function setupMediaControlListeners() {
  document.addEventListener('keydown', function(e) {
    // Handle media control keys
    switch (e.key) {
      case 'MediaPlayPause':
        togglePlayPause();
        break;
      case 'MediaPlay':
        play();
        break;
      case 'MediaPause':
        pause();
        break;
      case 'MediaStop':
        stop();
        break;
      case 'MediaFastForward':
        fastForward();
        break;
      case 'MediaRewind':
        rewind();
        break;
      case 'MediaTrackNext':
        // Jump forward 10 seconds
        seekRelative(10);
        break;
      case 'MediaTrackPrevious':
        // Jump backward 10 seconds
        seekRelative(-10);
        break;
      case 'Back':
      case 'XF86Back':
        // Handle back button press
        handleBackButton(e);
        break;
    }
  });
}

/**
 * Handle back button press
 * @param {Event} e - The keydown event
 */
function handleBackButton(e) {
  e.preventDefault(); // Prevent default back behavior
  
  // Special handling for Cineby.gd
  if (window.location.hostname.includes('cineby.gd')) {
    // Check if we're in a video player mode
    if (videoElement && videoElement.parentElement && 
        (document.fullscreenElement || 
         videoElement.closest('.video-player-container') ||
         videoElement.style.position === 'fixed' ||
         videoElement.parentElement.style.position === 'fixed')) {
      
      // If in fullscreen, exit it
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
          // Silent error handling
        });
      }
      
      // Stop video playback
      videoElement.pause();
      
      // Try to find and click a close button
      const closeButton = document.querySelector('.close-button, .back-button, .exit-button');
      if (closeButton) {
        closeButton.click();
      } else {
        // If we have stored the last movie URL, go back to it instead of general history
        if (window.tflixLastMovieUrl && window.tflixLastMovieUrl.includes('/movie/')) {
          window.location.href = window.tflixLastMovieUrl;
        } else {
          // Try to navigate back to the movie page through history
          window.history.back();
        }
      }
      
      return;
    }
  }
  
  // Default handling for other cases
  if (videoElement && videoElement.parentElement && 
      (document.fullscreenElement || videoElement.closest('.video-player-container'))) {
    
    // If in fullscreen, exit it
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Silent error handling
      });
    }
    
    // Stop video playback
    videoElement.pause();
    
    // If there's a close button, click it
    const closeButton = document.querySelector('.close-button, .back-button, .exit-button');
    if (closeButton) {
      closeButton.click();
    } else {
      // Try to navigate back to the main content
      window.history.back();
    }
    
    return;
  }
  
  // Handle regular navigation back
  if (window.history.length > 1) {
    window.history.back();
  } else {
    // If no history, try to find a back button on the page
    const backButton = document.querySelector('.back-button, [aria-label="Back"], [aria-label="Go back"]');
    if (backButton) {
      backButton.click();
    }
  }
}

/**
 * Setup MutationObserver to detect when a video player is added to the DOM
 */
function setupVideoPlayerObserver() {
  // Create an observer instance
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes.length) {
        // Check if a video element was added
        const addedVideo = Array.from(mutation.addedNodes).find(node => 
          node.nodeName === 'VIDEO' || 
          (node.querySelector && node.querySelector('video'))
        );
        
        if (addedVideo) {
          videoElement = addedVideo.nodeName === 'VIDEO' ? 
            addedVideo : addedVideo.querySelector('video');
          
          if (videoElement) {
            enhanceVideoPlayer(videoElement);
          }
        }
      }
    });
  });
  
  // Start observing the document body for DOM changes
  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
  
  // Also check for existing video elements
  videoElement = document.querySelector('video');
  if (videoElement) {
    enhanceVideoPlayer(videoElement);
  }
}

/**
 * Enhance video player with custom controls and TV remote navigation
 * @param {HTMLElement} video - The video element to enhance
 */
function enhanceVideoPlayer(video) {
  videoElement = video;
  
  // Fix common video playback issues
  fixVideoPlaybackIssues(video);
  
  // Create custom player controls
  createPlayerControls();
  
  // Add event listeners for video element
  videoElement.addEventListener('play', updatePlayerState);
  videoElement.addEventListener('pause', updatePlayerState);
  videoElement.addEventListener('timeupdate', updateProgress);
  videoElement.addEventListener('ended', onVideoEnded);
  
  // Add error handling
  videoElement.addEventListener('error', handleVideoError);
  
  // Show controls when moving focus with the TV remote
  document.addEventListener('keydown', function(e) {
    if (Object.values(ARROW_KEY_CODE).includes(e.key)) {
      showControls();
    }
  });
}

/**
 * Fix common video playback issues
 * @param {HTMLElement} video - The video element to fix
 */
function fixVideoPlaybackIssues(video) {
  if (!video) return;
  
  // Ensure video is visible
  video.style.display = 'block';
  video.style.opacity = '1';
  video.style.visibility = 'visible';
  
  // Make sure the video container is visible
  const videoContainer = video.parentElement;
  if (videoContainer) {
    videoContainer.style.display = 'block';
    videoContainer.style.opacity = '1';
    videoContainer.style.visibility = 'visible';
    videoContainer.style.backgroundColor = '#000'; // Black background
    
    // Add a specific class to help identify it
    videoContainer.classList.add('tflix-video-container');
    
    // Fix position if it's absolute or fixed to make sure it's visible
    const containerStyle = window.getComputedStyle(videoContainer);
    if (containerStyle.position === 'absolute' || containerStyle.position === 'fixed') {
      videoContainer.style.top = '0';
      videoContainer.style.left = '0';
      videoContainer.style.width = '100%';
      videoContainer.style.height = '100%';
      videoContainer.style.zIndex = '9999';
    }
  }
  
  // Ensure video can be played
  video.autoplay = true;
  video.controls = true; // Enable native controls as fallback
  
  // Try to fix video size
  video.style.width = '100%';
  video.style.height = 'auto';
  video.style.maxHeight = '100vh';
  video.style.maxWidth = '100vw';
  video.style.objectFit = 'contain';
  
  // Ensure proper video rendering
  video.setAttribute('playsinline', '');
  
  // Check for CORS issues and add crossorigin if needed
  if (!video.hasAttribute('crossorigin')) {
    video.setAttribute('crossorigin', 'anonymous');
  }
  
  // If the TV has trouble with media codecs, try to help with hints
  if (!video.hasAttribute('preload')) {
    video.setAttribute('preload', 'auto');
  }
  
  // Special handling for Cineby.gd
  if (window.location.hostname.includes('cineby.gd')) {
    // Make sure we can manipulate the video
    video.setAttribute('controlsList', 'nodownload');
    
    // Store a reference for our Cineby-specific handlers
    window.tflixVideoElement = video;
    
    // Store the current movie page URL to use for back navigation
    window.tflixLastMovieUrl = window.location.href;
    
    // Add event listeners for TV remote navigation during playback
    document.addEventListener('keydown', handleCinebyVideoKeyEvents);
    
    // Force a play attempt with retry logic for Cineby
    let playAttempts = 0;
    const tryPlayVideo = () => {
      video.play().catch(() => {
        playAttempts++;
        if (playAttempts < 5) {
          // Try again with exponential backoff
          setTimeout(tryPlayVideo, playAttempts * 500);
        } else {
          // Show a toast after several failed attempts
          showToast('Press Enter to start playback');
        }
      });
    };
    
    // Start the first attempt after a delay
    setTimeout(tryPlayVideo, 1000);
  }
}

/**
 * Handle Cineby-specific video remote events
 * @param {Event} e - Remote control event
 */
function handleCinebyVideoKeyEvents(e) {
  const video = window.tflixVideoElement;
  if (!video) return;
  
  // Only process if we're on a video page and the video is visible
  if (!window.location.pathname.includes('/movie/') || 
      video.style.display === 'none' || 
      video.style.visibility === 'hidden') {
    return;
  }
  
  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      if (video.paused) {
        // Show attempt to play toast
        showToast('Starting playback...');
        video.play().catch(() => {
          // If it fails, show error
          showToast('Unable to play. Try pressing Back and selecting again.');
        });
      } else {
        video.pause();
        showToast('Paused');
      }
      break;
      
    case 'ArrowUp':
      e.preventDefault();
      video.volume = Math.min(1, video.volume + 0.1);
      showToast(`Volume: ${Math.round(video.volume * 100)}%`);
      break;
      
    case 'ArrowDown':
      e.preventDefault();
      video.volume = Math.max(0, video.volume - 0.1);
      showToast(`Volume: ${Math.round(video.volume * 100)}%`);
      break;
      
    case 'ArrowLeft':
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 10);
      showToast(`- 10 seconds`);
      break;
      
    case 'ArrowRight':
      e.preventDefault();
      video.currentTime = Math.min(video.duration, video.currentTime + 10);
      showToast(`+ 10 seconds`);
      break;
  }
}

/**
 * Handle video playback errors
 * @param {Event} e - Error event
 */
function handleVideoError(e) {
  const errorMessage = getVideoErrorMessage(videoElement.error ? videoElement.error.code : 0);
  showToast(`Video error: ${errorMessage}. Trying to recover...`);
  
  // Store the current video source and position
  const currentSrc = videoElement.src;
  const currentTime = videoElement.currentTime || 0;
  
  // Special handling for Cineby.gd
  if (window.location.hostname.includes('cineby.gd')) {
    // For Cineby, try a more aggressive recovery approach
    
    // First, check if it's just a missing source or corruption
    if (!currentSrc || currentSrc === 'undefined' || currentSrc === '') {
      // Try to find another video element that might have a valid source
      const otherVideos = Array.from(document.querySelectorAll('video')).filter(v => v !== videoElement);
      if (otherVideos.length > 0) {
        for (const video of otherVideos) {
          if (video.src && video.src !== '') {
            videoElement.src = video.src;
            videoElement.load();
            videoElement.currentTime = currentTime;
            videoElement.play().catch(() => {
              // If still fails, try reloading the page
              showToast('Still having trouble. Try using the back button and selecting again.');
            });
            return;
          }
        }
      }
    }
  }
  
  // Generic recovery approach
  setTimeout(() => {
    if (videoElement) {
      // Try reloading the video
      videoElement.src = '';
      setTimeout(() => {
        videoElement.src = currentSrc;
        videoElement.load();
        videoElement.currentTime = currentTime;
        videoElement.play().catch(() => {
          showToast('Could not play video. Try exiting and selecting again.');
        });
      }, 1000);
    }
  }, 2000);
}

/**
 * Get human-readable error message for video error code
 * @param {number} errorCode - The error code from video.error.code
 * @returns {string} Human-readable error message
 */
function getVideoErrorMessage(errorCode) {
  switch(errorCode) {
    case 1:
      return 'Fetching process aborted';
    case 2:
      return 'Network error';
    case 3:
      return 'Decoding error';
    case 4:
      return 'Video not supported';
    default:
      return 'Unknown error';
  }
}

/**
 * Create custom player controls
 */
function createPlayerControls() {
  // First check if we already have controls
  if (playerControls) return;
  
  // Create controls container
  playerControls = document.createElement('div');
  playerControls.className = 'tflix-player-controls';
  
  // Create play/pause button
  const playPauseBtn = document.createElement('button');
  playPauseBtn.className = 'tflix-control-button play-pause';
  playPauseBtn.innerHTML = '⏸️';
  playPauseBtn.addEventListener('click', togglePlayPause);
  
  // Create rewind button
  const rewindBtn = document.createElement('button');
  rewindBtn.className = 'tflix-control-button rewind';
  rewindBtn.innerHTML = '⏪';
  rewindBtn.addEventListener('click', () => seekRelative(-10));
  
  // Create fast-forward button
  const fastForwardBtn = document.createElement('button');
  fastForwardBtn.className = 'tflix-control-button fast-forward';
  fastForwardBtn.innerHTML = '⏩';
  fastForwardBtn.addEventListener('click', () => seekRelative(10));
  
  // Create progress bar
  progressBar = document.createElement('div');
  progressBar.className = 'tflix-progress-bar';
  
  progressFilled = document.createElement('div');
  progressFilled.className = 'tflix-progress-filled';
  progressBar.appendChild(progressFilled);
  
  // Add all elements to controls
  playerControls.appendChild(rewindBtn);
  playerControls.appendChild(playPauseBtn);
  playerControls.appendChild(progressBar);
  playerControls.appendChild(fastForwardBtn);
  
  // Find video container to append controls
  const videoContainer = videoElement.parentElement;
  if (videoContainer) {
    videoContainer.style.position = 'relative';
    videoContainer.appendChild(playerControls);
  } else {
    // If we can't find a parent, append to body
    document.body.appendChild(playerControls);
  }
}

/**
 * Show player controls with auto-hide
 */
function showControls() {
  if (!playerControls) return;
  
  playerControls.classList.add('show');
  
  // Clear any existing timeout
  if (hideControlsTimeout) {
    clearTimeout(hideControlsTimeout);
  }
  
  // Set timeout to hide controls after 3 seconds
  hideControlsTimeout = setTimeout(() => {
    playerControls.classList.remove('show');
  }, 3000);
}

/**
 * Update player UI based on video state
 */
function updatePlayerState() {
  if (!videoElement || !playerControls) return;
  
  const playPauseBtn = playerControls.querySelector('.play-pause');
  if (playPauseBtn) {
    playPauseBtn.innerHTML = videoElement.paused ? '▶️' : '⏸️';
  }
  
  showControls();
}

/**
 * Update progress bar
 */
function updateProgress() {
  if (!videoElement || !progressFilled) return;
  
  const percent = (videoElement.currentTime / videoElement.duration) * 100;
  progressFilled.style.width = `${percent}%`;
}

/**
 * Handle video ended event
 */
function onVideoEnded() {
  if (!playerControls) return;
  
  const playPauseBtn = playerControls.querySelector('.play-pause');
  if (playPauseBtn) {
    playPauseBtn.innerHTML = '▶️';
  }
  
  showControls();
}

// Media control functions
function togglePlayPause() {
  if (!videoElement) return;
  
  if (videoElement.paused) {
    videoElement.play();
  } else {
    videoElement.pause();
  }
  
  showToast(videoElement.paused ? 'Paused' : 'Playing');
}

function play() {
  if (!videoElement) return;
  videoElement.play();
  showToast('Playing');
}

function pause() {
  if (!videoElement) return;
  videoElement.pause();
  showToast('Paused');
}

function stop() {
  if (!videoElement) return;
  videoElement.pause();
  videoElement.currentTime = 0;
  showToast('Stopped');
}

function fastForward() {
  seekRelative(30);
}

function rewind() {
  seekRelative(-30);
}

function seekRelative(seconds) {
  if (!videoElement) return;
  
  videoElement.currentTime = Math.max(0, Math.min(
    videoElement.duration, 
    videoElement.currentTime + seconds
  ));
  
  showToast(`${seconds > 0 ? '+' : ''}${seconds} seconds`);
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 */
function showToast(message) {
  // Check if a toast already exists
  let toast = document.querySelector('.tflix-toast');
  
  // If not, create one
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'tflix-toast';
    document.body.appendChild(toast);
  }
  
  // Update message and show
  toast.textContent = message;
  toast.classList.add('show');
  
  // Hide after 2 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// Define arrow key codes globally for TV remote
const ARROW_KEY_CODE = {
  'ArrowLeft': 'left',
  'ArrowUp': 'up',
  'ArrowRight': 'right',
  'ArrowDown': 'down'
};

// Initialize UI when the page is loaded
const interval = setInterval(() => {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    try {
      initializeUI();
    } catch (error) {
      // Try again in case of error
      setTimeout(initializeUI, 1000);
    }
    clearInterval(interval);
  }
}, 250);

// Register for back button events at the system level if available
if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
  try {
    tizen.tvinputdevice.registerKey('Back');
  } catch (e) {
    // Silent error handling
  }
}

export default {
  showToast
};
