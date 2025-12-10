/**
 * TFlix Performance Optimizer
 * This module implements performance optimizations for smoother operation on Tizen TVs
 */

/**
 * Initialize performance optimizations
 */
function initializePerformanceOptimizations() {
  // Apply optimizations once DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyOptimizations);
  } else {
    applyOptimizations();
  }
}

/**
 * Apply various performance optimizations
 */
function applyOptimizations() {
  // Optimize images and lazy loading
  optimizeImages();
  
  // Reduce animation complexity
  reduceAnimations();
  
  // Optimize scrolling performance
  optimizeScrolling();
  
  // Debounce event handlers
  setupEventDebouncing();
  
  // Memory management
  setupMemoryManagement();
}

/**
 * Optimize images with lazy loading and size optimizations
 */
function optimizeImages() {
  // Find all images that don't have loading attribute
  const images = document.querySelectorAll('img:not([loading])');
  
  images.forEach(img => {
    // Add lazy loading
    img.setAttribute('loading', 'lazy');
    
    // Add decoding async for better performance
    img.setAttribute('decoding', 'async');
    
    // Set explicit width/height if missing to avoid layout shifts
    if (!img.hasAttribute('width') && !img.hasAttribute('height')) {
      const computedStyle = window.getComputedStyle(img);
      const width = computedStyle.width;
      const height = computedStyle.height;
      
      if (width && width !== 'auto' && height && height !== 'auto') {
        img.setAttribute('width', parseInt(width));
        img.setAttribute('height', parseInt(height));
      }
    }
  });
  
  // Set up intersection observer for better lazy loading
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            delete img.dataset.src;
          }
          observer.unobserve(img);
        }
      });
    });
    
    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }
}

/**
 * Reduce animation complexity for better performance
 */
function reduceAnimations() {
  // Create a style element to inject optimized animation rules
  const style = document.createElement('style');
  style.textContent = `
    /* Reduce CSS animation complexity */
    * {
      animation-duration: 0.001s !important;
      transition-duration: 0.001s !important;
    }
    
    /* Only keep essential animations */
    .tflix-focused {
      animation-duration: 0.2s !important;
      transition-duration: 0.2s !important;
    }
    
    /* Reduce motion for users who prefer it */
    @media (prefers-reduced-motion: reduce) {
      * {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
  
  document.head.appendChild(style);
}

/**
 * Optimize scrolling performance
 */
function optimizeScrolling() {
  // Disable smooth scrolling which can be performance heavy
  const scrollableElements = document.querySelectorAll('div, main, section');
  
  scrollableElements.forEach(el => {
    const style = window.getComputedStyle(el);
    const overflow = style.getPropertyValue('overflow');
    const overflowY = style.getPropertyValue('overflow-y');
    
    if (overflow === 'auto' || overflow === 'scroll' || 
        overflowY === 'auto' || overflowY === 'scroll') {
      // Add will-change for better rendering performance
      el.style.willChange = 'transform';
      
      // Use translate3d for hardware acceleration
      el.style.transform = 'translate3d(0,0,0)';
    }
  });
}

/**
 * Set up event debouncing for better performance
 */
function setupEventDebouncing() {
  // Debounce scroll and resize events
  let scrollTimeout;
  let resizeTimeout;
  
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'scroll') {
      const debouncedListener = function(e) {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          listener.call(this, e);
        }, 100);
      };
      
      return originalAddEventListener.call(this, type, debouncedListener, options);
    } else if (type === 'resize') {
      const debouncedListener = function(e) {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          listener.call(this, e);
        }, 100);
      };
      
      return originalAddEventListener.call(this, type, debouncedListener, options);
    }
    
    return originalAddEventListener.call(this, type, listener, options);
  };
}

/**
 * Set up memory management to prevent memory leaks
 */
function setupMemoryManagement() {
  // Clear unused objects periodically
  setInterval(() => {
    // Force garbage collection (though we can't directly call it)
    // This trick helps in some browsers
    const arr = [];
    for (let i = 0; i < 1000; i++) {
      arr.push(new Array(10000).join('x'));
    }
    arr.length = 0;
  }, 60000); // Every minute
}

// Export the initialization function
export {
  initializePerformanceOptimizations
};
