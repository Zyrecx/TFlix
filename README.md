# TFlix

TFlix is a TizenBrew module that transforms [Cineby.gd](https://www.cineby.gd/) into a TV-friendly experience for Samsung TVs. It creates a Netflix-like navigation system optimized for remote control operation.

## Features

- **TV-Remote Friendly Navigation** - Navigate using only the directional keys
- **Enhanced Visual Focus** - Clear indicators showing selected elements
- **Streamlined Video Playback** - Control playback with media keys on your remote
- **Smart Navigation** - Natural movement between elements with arrow keys
- **Automatic Scrolling** - Scrolls the page when navigating outside visible area
- **Visual Enhancements** - Focus highlighting and scaling for better visibility

## Installation

### Prerequisites

- Samsung Tizen TV with TizenBrew installed
- Internet connection

### Installing from npm (Recommended)

1. On your TV with TizenBrew installed, navigate to the Package Manager
2. Search for "@zyrecx/tflix"
3. Select and install the package

### Manual Installation

1. Build the module:
   ```
   ./build.bat
   ```

2. Package the module for TizenBrew:
   - Copy the entire TFlix folder to your TizenBrew modules directory
   - Alternatively, package it as a .ZIP file and install via TizenBrew

3. Open TizenBrew on your TV and select TFlix from the modules list

## Usage

- Use the directional keys (up, down, left, right) on your TV remote to navigate
- Press OK/Enter to select items
- Use media keys (Play, Pause, etc.) to control video playback
- Press Back to return to previous screens

## Development

### Project Structure

- `mods/` - Contains the JavaScript modules for enhancing Cineby.gd
- `service/` - Contains the service code for handling TV functionality
- `dist/` - Contains the built module files

### Building

To build the project, run:

```
./build.bat
```

This will install dependencies and build both the mods and service modules.

## License

MIT

---

*TFlix is a community-created module for TizenBrew and is not officially affiliated with Cineby.gd.*
