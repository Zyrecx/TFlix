# Cineby TizenBrew Module

A TizenBrew module that transforms the [Cineby](https://www.cineby.app/) streaming service into a TV-optimized webapp with enhanced remote control navigation and video player features.

## Features

### 🎮 Remote Control Navigation
- **Directional Navigation**: Use arrow keys to navigate through movies, shows, and UI elements
- **Smart Focus System**: Automatically highlights focusable elements with visual indicators
- **Grid Navigation**: Optimized navigation for movie/TV show grids
- **Quick Access**: Number keys (1-9) for quick section navigation

### 📺 Video Player Enhancements
- **Media Key Support**: Play/Pause, Stop, Rewind, Fast Forward
- **Volume Control**: TV remote volume keys support
- **Seek Controls**: Ctrl + Arrow keys for precise seeking
- **Auto-focus**: Automatic focus management during video playback

### 🎨 TV-Optimized Interface
- **Visual Focus Indicators**: Clear highlighting of selected elements
- **Smooth Animations**: Enhanced transitions and scaling effects
- **TV-Friendly Sizing**: Larger buttons and touch targets
- **Reduced Motion Options**: Accessibility considerations for motion sensitivity

### ⚡ Performance Optimizations
- **Efficient DOM Monitoring**: Smart element detection and focus management
- **Responsive Design**: Adapts to different TV screen sizes
- **Minimal Resource Usage**: Lightweight implementation

## Installation

1. **Prerequisites**: Make sure you have TizenBrew installed on your Samsung TV
2. **Download**: Clone or download this repository
3. **Install**: Place the module in your TizenBrew modules directory
4. **Activate**: Enable the module through TizenBrew interface

```bash
# Clone the repository
git clone https://github.com/your-username/cineby-tizenbrew.git

# Install dependencies (optional, for service features)
cd cineby-tizenbrew
npm install
```

## Usage

### Basic Navigation
- **Arrow Keys**: Navigate between elements
- **Enter**: Activate/click selected element
- **Return/Escape**: Go back or close overlays
- **Number Keys (1-9)**: Quick jump to different sections

### Video Controls
- **Space/Media Play/Pause**: Toggle video playback
- **Media Stop**: Stop video and return to beginning
- **Media Rewind**: Skip back 10 seconds
- **Media Fast Forward**: Skip forward 10 seconds
- **Ctrl + Up/Down**: Adjust volume
- **Ctrl + Left/Right**: Seek backward/forward

### Advanced Features
- **Auto-focus**: Elements are automatically focused as you navigate
- **Smart Scrolling**: Page scrolls to keep focused elements visible
- **Context Awareness**: Different behaviors for different page sections

## Configuration

The module includes a service component that can be configured for additional features:

### Service Endpoints
- `GET /health` - Service health check
- `GET /preferences` - Get user preferences
- `POST /preferences` - Update user preferences
- `POST /remote-control` - Handle remote control actions

### Default Preferences
```json
{
  "navigation": {
    "focusTimeout": 300,
    "scrollBehavior": "smooth",
    "autoFocus": true
  },
  "video": {
    "autoPlay": false,
    "defaultVolume": 0.7,
    "seekInterval": 10
  },
  "ui": {
    "theme": "dark",
    "fontSize": "large",
    "reduceMotion": false
  }
}
```

## Technical Details

### Module Structure
```
cineby-tizenbrew/
├── package.json          # Module configuration and metadata
├── src/
│   ├── cineby-mod.js     # Main modification script
│   └── service.js        # Backend service (optional)
├── README.md             # This file
└── LICENSE               # MIT License
```

### Key Components

1. **Focus Management System**: Tracks and manages focusable elements
2. **Keyboard Event Handler**: Processes remote control inputs
3. **Video Player Enhancement**: Adds TV-specific video controls
4. **UI Enhancement Layer**: Visual improvements for TV viewing
5. **Service Backend**: Optional Node.js service for advanced features

### Supported Elements
- Movie and TV show cards
- Navigation links and buttons
- Video players
- Search inputs
- Menu items and controls

## Compatibility

- **TizenBrew**: Compatible with TizenBrew modules system
- **Samsung TV**: Tested on Samsung Tizen TVs
- **Cineby Website**: Works with current Cineby.app interface
- **Browsers**: Compatible with modern web browsers

## Development

### Local Development
```bash
# Install dependencies
npm install

# Start the service (optional)
node src/service.js

# The main modification script runs automatically when the module is loaded
```

### Testing
1. Load the module in TizenBrew
2. Navigate to Cineby website
3. Test remote control navigation
4. Verify video player controls
5. Check visual focus indicators

### Debugging
The module exposes debugging functions globally:
```javascript
// Access from browser console
CinebyTVControls.updateFocus()           // Refresh focusable elements
CinebyTVControls.getCurrentFocus()       // Get currently focused element
CinebyTVControls.getFocusableElements()  // Get all focusable elements
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on actual TV hardware if possible
5. Submit a pull request

### Guidelines
- Follow existing code style
- Test thoroughly on TV interface
- Document new features
- Consider accessibility implications

## Troubleshooting

### Common Issues

**Navigation not working**
- Ensure TizenBrew has properly registered the module
- Check browser console for JavaScript errors
- Verify TV remote control key registration

**Focus indicators not visible**
- Check if CSS styles are being applied
- Verify element detection is working
- Try refreshing the page

**Video controls not responding**
- Ensure video element is properly detected
- Check media key registration with TV APIs
- Verify video player is accessible

**Performance issues**
- Check if DOM observation is causing excessive updates
- Monitor focus element list size
- Consider reducing animation complexity

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- **TizenBrew Team**: For creating the TizenBrew platform
- **Cineby**: For providing an excellent streaming service
- **Samsung**: For the Tizen TV platform and APIs
- **Community**: For testing and feedback

## Support

For issues and support:
1. Check the troubleshooting section above
2. Search existing GitHub issues
3. Create a new issue with detailed information
4. Include TV model and TizenBrew version

---

**Disclaimer**: This module is not officially affiliated with Cineby or Samsung. It's a community-created enhancement for better TV accessibility.
