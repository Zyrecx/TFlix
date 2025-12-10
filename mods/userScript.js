import 'whatwg-fetch';
import './spatial-navigation-polyfill.js';
import './ui.js';
import './contentDetector.js';
import { initializePerformanceOptimizations } from './performance.js';

// Initialize performance optimizations early
initializePerformanceOptimizations();
