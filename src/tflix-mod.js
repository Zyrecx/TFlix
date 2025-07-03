/**
 * TFlix TizenBrew Module
 * Enhances the streaming service for Samsung TV remote control navigation
 */

(function() {
    'use strict';

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTFlixTVControls);
    } else {
        initTFlixTVControls();
    }

    function initTFlixTVControls() {
        console.log('TFlix TV Controls initialized');
        
        // Initialize components
        setupKeyboardNavigation();
        setupVideoPlayerEnhancements();
        setupUIEnhancements();
        setupRemoteControlSupport();
        
        // Add CSS for TV interface
        injectTVStyles();
    }

    let currentFocusIndex = 0;
    let focusableElements = [];
    let isVideoPlaying = false;

    function setupKeyboardNavigation() {
        // Find all focusable elements
        updateFocusableElements();
        
        // Set initial focus to first nav or card
        if (focusableElements.length > 0) {
            setFocus(0);
        }

        // Update focusable elements when DOM changes
        const observer = new MutationObserver(() => {
            updateFocusableElements();
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Handle keyboard events
        document.addEventListener('keydown', handleKeyPress);
    }

    function updateFocusableElements() {
        // Get all interactive elements, including nav bar
        const selectors = [
            'nav a', // navigation bar links
            '.nav a',
            '.nav-item',
            'a[href]',
            'button',
            '[data-play="true"]',
            '.movie-card',
            '.tv-card',
            '[href*="/movie/"]',
            '[href*="/tv/"]',
            'input[type="text"]',
            'input[type="search"]',
            '[tabindex]:not([tabindex="-1"])',
            '.play-button',
            '.video-controls button'
        ];
        focusableElements = Array.from(document.querySelectorAll(selectors.join(', ')))
            .filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && 
                       window.getComputedStyle(el).visibility !== 'hidden' &&
                       window.getComputedStyle(el).display !== 'none';
            });
        
        // Sort elements by their position (top to bottom, left to right)
        focusableElements.sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            
            if (Math.abs(rectA.top - rectB.top) < 10) {
                return rectA.left - rectB.left;
            }
            return rectA.top - rectB.top;
        });
    }

    function setFocus(index) {
        // Remove previous focus
        focusableElements.forEach(el => el.classList.remove('tv-focused'));
        
        if (index >= 0 && index < focusableElements.length) {
            currentFocusIndex = index;
            const element = focusableElements[index];
            element.classList.add('tv-focused');
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Add visual feedback
            element.style.outline = '3px solid #ff6b6b';
            element.style.outlineOffset = '2px';
        }
    }

    function handleKeyPress(event) {
        const key = event.key;
        
        // Prevent default browser behavior for arrow keys
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(key)) {
            event.preventDefault();
        }

        switch (key) {
            case "ArrowDown":
                navigateDown();
                break;
            case "ArrowUp":
                navigateUp();
                break;
            case "ArrowLeft":
                navigateLeft();
                break;
            case "ArrowRight":
                navigateRight();
                break;
            case "Enter":
                activateCurrentElement();
                break;
            case "Escape":
            case "Return":
                handleBack();
                break;
            case "MediaPlay":
            case "MediaPause":
                togglePlayPause();
                break;
            case "MediaStop":
                stopVideo();
                break;
            case "MediaRewind":
                rewindVideo();
                break;
            case "MediaFastForward":
                fastForwardVideo();
                break;
            default:
                // No number key navigation
                break;
        }
    }

    function navigateDown() {
        const currentRect = focusableElements[currentFocusIndex]?.getBoundingClientRect();
        if (!currentRect) return;
        
        // Find next element below
        let bestMatch = -1;
        let bestDistance = Infinity;
        
        for (let i = 0; i < focusableElements.length; i++) {
            if (i === currentFocusIndex) continue;
            
            const rect = focusableElements[i].getBoundingClientRect();
            if (rect.top > currentRect.bottom) {
                const distance = Math.abs(rect.left - currentRect.left) + (rect.top - currentRect.bottom);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestMatch = i;
                }
            }
        }
        
        if (bestMatch !== -1) {
            setFocus(bestMatch);
        } else if (currentFocusIndex < focusableElements.length - 1) {
            setFocus(currentFocusIndex + 1);
        }
    }

    function navigateUp() {
        const currentRect = focusableElements[currentFocusIndex]?.getBoundingClientRect();
        if (!currentRect) return;
        
        // Find next element above
        let bestMatch = -1;
        let bestDistance = Infinity;
        
        for (let i = 0; i < focusableElements.length; i++) {
            if (i === currentFocusIndex) continue;
            
            const rect = focusableElements[i].getBoundingClientRect();
            if (rect.bottom < currentRect.top) {
                const distance = Math.abs(rect.left - currentRect.left) + (currentRect.top - rect.bottom);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestMatch = i;
                }
            }
        }
        
        if (bestMatch !== -1) {
            setFocus(bestMatch);
        } else if (currentFocusIndex > 0) {
            setFocus(currentFocusIndex - 1);
        }
    }

    function navigateLeft() {
        const currentRect = focusableElements[currentFocusIndex]?.getBoundingClientRect();
        if (!currentRect) return;
        
        // Find next element to the left
        let bestMatch = -1;
        let bestDistance = Infinity;
        
        for (let i = 0; i < focusableElements.length; i++) {
            if (i === currentFocusIndex) continue;
            
            const rect = focusableElements[i].getBoundingClientRect();
            if (rect.right < currentRect.left && Math.abs(rect.top - currentRect.top) < 100) {
                const distance = currentRect.left - rect.right + Math.abs(rect.top - currentRect.top);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestMatch = i;
                }
            }
        }
        
        if (bestMatch !== -1) {
            setFocus(bestMatch);
        }
    }

    function navigateRight() {
        const currentRect = focusableElements[currentFocusIndex]?.getBoundingClientRect();
        if (!currentRect) return;
        
        // Find next element to the right
        let bestMatch = -1;
        let bestDistance = Infinity;
        
        for (let i = 0; i < focusableElements.length; i++) {
            if (i === currentFocusIndex) continue;
            
            const rect = focusableElements[i].getBoundingClientRect();
            if (rect.left > currentRect.right && Math.abs(rect.top - currentRect.top) < 100) {
                const distance = rect.left - currentRect.right + Math.abs(rect.top - currentRect.top);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestMatch = i;
                }
            }
        }
        
        if (bestMatch !== -1) {
            setFocus(bestMatch);
        }
    }

    function activateCurrentElement() {
        const element = focusableElements[currentFocusIndex];
        if (!element) return;
        
        // Handle different element types
        if (element.tagName === 'A') {
            element.click();
        } else if (element.tagName === 'BUTTON') {
            element.click();
        } else if (element.hasAttribute('data-play')) {
            element.click();
        } else {
            // Trigger click event
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
    }

    function handleBack() {
        // Try to find and click back button or go back in history
        const backButton = document.querySelector('.back-button, [aria-label*="back"], [title*="back"]');
        if (backButton) {
            backButton.click();
        } else {
            window.history.back();
        }
    }

    function setupVideoPlayerEnhancements() {
        // Monitor for video elements
        const videoObserver = new MutationObserver(() => {
            const videos = document.querySelectorAll('video');
            videos.forEach(enhanceVideoPlayer);
        });
        
        videoObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Enhance existing videos
        document.querySelectorAll('video').forEach(enhanceVideoPlayer);
    }

    function enhanceVideoPlayer(video) {
        if (video.dataset.enhanced) return;
        video.dataset.enhanced = 'true';
        
        // Add event listeners for video control
        video.addEventListener('play', () => {
            isVideoPlaying = true;
        });
        
        video.addEventListener('pause', () => {
            isVideoPlaying = false;
        });
        
        // Add keyboard shortcuts when video is focused
        video.addEventListener('keydown', (event) => {
            handleVideoKeyPress(event, video);
        });
    }

    function handleVideoKeyPress(event, video) {
        switch (event.key) {
            case ' ':
            case 'MediaPlay':
            case 'MediaPause':
                event.preventDefault();
                togglePlayPause(video);
                break;
            case 'ArrowLeft':
                if (event.ctrlKey) {
                    event.preventDefault();
                    rewindVideo(video);
                }
                break;
            case 'ArrowRight':
                if (event.ctrlKey) {
                    event.preventDefault();
                    fastForwardVideo(video);
                }
                break;
            case 'ArrowUp':
                if (event.ctrlKey) {
                    event.preventDefault();
                    adjustVolume(video, 0.1);
                }
                break;
            case 'ArrowDown':
                if (event.ctrlKey) {
                    event.preventDefault();
                    adjustVolume(video, -0.1);
                }
                break;
        }
    }

    function togglePlayPause(video) {
        video = video || document.querySelector('video');
        if (!video) return;
        
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    }

    function stopVideo(video) {
        video = video || document.querySelector('video');
        if (!video) return;
        
        video.pause();
        video.currentTime = 0;
    }

    function rewindVideo(video) {
        video = video || document.querySelector('video');
        if (!video) return;
        
        video.currentTime = Math.max(0, video.currentTime - 10);
    }

    function fastForwardVideo(video) {
        video = video || document.querySelector('video');
        if (!video) return;
        
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
    }

    function adjustVolume(video, delta) {
        video = video || document.querySelector('video');
        if (!video) return;
        
        video.volume = Math.max(0, Math.min(1, video.volume + delta));
    }

    function setupUIEnhancements() {
        // Add TV-friendly cursor
        document.body.style.cursor = 'none';
        
        // Hide mouse cursor after inactivity
        let mouseTimer;
        document.addEventListener('mousemove', () => {
            document.body.style.cursor = 'default';
            clearTimeout(mouseTimer);
            mouseTimer = setTimeout(() => {
                document.body.style.cursor = 'none';
            }, 3000);
        });
        
        // Enhance movie/show cards for TV
        enhanceMediaCards();
    }

    function enhanceMediaCards() {
        const cards = document.querySelectorAll('.movie-card, .tv-card, [href*="/movie/"], [href*="/tv/"]');
        
        cards.forEach(card => {
            card.addEventListener('mouseenter', () => {
                if (!card.classList.contains('tv-focused')) {
                    const index = focusableElements.indexOf(card);
                    if (index !== -1) {
                        setFocus(index);
                    }
                }
            });
        });
    }

    function setupRemoteControlSupport() {
        // Register TV input device keys if available (Tizen API)
        const extraKeys = [
            'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward',
            'VolumeUp', 'VolumeDown', 'VolumeMute'
        ];
        if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
            try {
                tizen.tvinputdevice.registerKeyBatch(
                    extraKeys,
                    () => console.log('TV remote control keys registered'),
                    err => console.log('TV input device registration failed:', err)
                );
            } catch (error) {
                console.log('TV input device registration failed:', error);
            }
        }
    }

    function injectTVStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* TV-friendly styles for TFlix */
            .tv-focused {
                transform: scale(1.05) !important;
                transition: all 0.2s ease !important;
                z-index: 1000 !important;
                position: relative !important;
                box-shadow: 0 0 20px rgba(255, 107, 107, 0.6) !important;
            }
            
            /* Enhanced focus for links and buttons */
            a.tv-focused, button.tv-focused {
                background-color: rgba(255, 107, 107, 0.2) !important;
                border-radius: 8px !important;
                padding: 8px !important;
            }
            
            /* Movie/TV card enhancements */
            [href*="/movie/"].tv-focused,
            [href*="/tv/"].tv-focused {
                transform: scale(1.1) !important;
                box-shadow: 0 0 30px rgba(255, 107, 107, 0.8) !important;
            }
            
            /* Video player enhancements */
            video {
                outline: none !important;
            }
            
            video:focus {
                box-shadow: 0 0 20px rgba(255, 255, 255, 0.5) !important;
            }
            
            /* Hide scrollbars for cleaner TV interface */
            ::-webkit-scrollbar {
                width: 8px;
            }
            
            ::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.1);
            }
            
            ::-webkit-scrollbar-thumb {
                background: rgba(255, 107, 107, 0.6);
                border-radius: 4px;
            }
            
            /* TV-friendly button styles */
            button, .btn {
                min-height: 44px !important;
                min-width: 44px !important;
                font-size: 16px !important;
            }
            
            /* Enhanced hover states for TV */
            .tv-focused img {
                filter: brightness(1.2) !important;
            }
            
            /* Status indicator for focus */
            .tv-focused::before {
                content: '';
                position: absolute;
                top: -5px;
                right: -5px;
                width: 10px;
                height: 10px;
                background: #ff6b6b;
                border-radius: 50%;
                z-index: 1001;
            }
            
            /* Ensure proper visibility */
            .tv-focused {
                visibility: visible !important;
                opacity: 1 !important;
            }
        `;
        
        document.head.appendChild(style);
    }

    // Expose some functions globally for debugging
    window.TFlixTVControls = {
        updateFocus: updateFocusableElements,
        setFocus: setFocus,
        getCurrentFocus: () => focusableElements[currentFocusIndex],
        getFocusableElements: () => focusableElements
    };

})();
