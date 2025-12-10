# TFlix Local Testing Guide

## Quick Start

Run the local testing server:
```
local-test.bat
```

This will:
1. Build your TFlix module
2. Start a local HTTP server on port 8080
3. Serve the built files from the `dist` folder

## Setting Up TizenBrew for Local Testing

### 1. Find Your Computer's IP Address
```powershell
ipconfig
```
Look for your IPv4 address (e.g., `192.168.1.100`)

### 2. Configure TizenBrew on Your TV

1. Open TizenBrew on your Samsung TV
2. Go to **Settings** or **Package Manager**
3. Add a custom module source
4. Enter: `http://YOUR-IP-ADDRESS:8080/`
   - Example: `http://192.168.1.100:8080/`

### 3. Install TFlix from Local Source

1. In TizenBrew's package manager, refresh sources
2. Find "TFlix" in the list (it should show as coming from your local source)
3. Install it

## Development Workflow

### Making Changes

1. **Edit your code** in the `mods/` or `service/` folders
2. **Rebuild**: Stop the server (Ctrl+C) and run `local-test.bat` again
3. **Reload on TV**: In TizenBrew, update/reinstall the module

### Quick Rebuild (Without Server)

If you just want to rebuild without starting the server:
```
npm run build
```

### Watch for File Changes (Advanced)

For automatic rebuilding when files change, you can use:
```powershell
npm install -g nodemon
nodemon --watch mods --watch service --exec "npm run build"
```

## Troubleshooting

### Server won't start
- Check if port 8080 is already in use
- Try a different port: `npx http-server dist --cors -c-1 -p 8081`

### TV can't connect to server
- Make sure your TV and computer are on the same network
- Check your firewall settings (allow port 8080)
- Verify your IP address hasn't changed

### Module not updating on TV
- Clear TizenBrew's cache
- Uninstall and reinstall the module
- Make sure you rebuilt after making changes

### Changes not appearing
- Check that you ran `npm run build` after editing
- Verify the dist folder has updated files
- Hard refresh the page on your TV (reinstall module)

## File Structure

```
TFlix/
├── mods/               # Your source files (edit these)
│   ├── ui.js
│   ├── contentDetector.js
│   ├── performance.js
│   └── ...
├── service/            # Service worker source (edit these)
│   └── service.js
├── dist/               # Built files (served to TV)
│   ├── userScript.js
│   └── service.js
└── local-test.bat      # Start local test server
```

## Alternative: Direct File Installation

If local server doesn't work, you can also:
1. Build: `npm run build`
2. Copy the entire `dist` folder to your TV via USB or SCP
3. Install from local files in TizenBrew

## Tips

- **Keep the server running** while testing to avoid rebuilding repeatedly
- **Use console.log()** in your code and check browser dev tools on TV (if available)
- **Test incrementally** - make small changes and test often
- **Check the package.json** version number matches what TizenBrew shows
