# TFlix Local Desktop Testing & Development

Test TFlix directly in Google Chrome, Microsoft Edge, or Firefox without installing it on your TV for every change.

---

## Quick Start

1. From the repository root, start the local Vite development server:
   ```bash
   npm run dev
   ```
2. Open **`http://localhost:5173`** in your browser.
3. You will see the complete 10-foot TFlix interface along with a floating **TV Remote Simulator & HUD** in the bottom-right corner.

---

## Desktop Remote Controls & Key Mappings

When testing in a desktop browser, keyboard keys are automatically translated into real Samsung Smart TV remote events:

| Desktop Key | TV Remote Action | Tizen keyCode | Behavior |
| :--- | :--- | :--- | :--- |
| **Arrow Up / Down / Left / Right** | D-Pad Directions | 38, 40, 37, 39 | 2D Spatial Grid Navigation |
| **Enter** | OK / Select | 13 | Click active focused item |
| **`b` / `Backspace` / `Escape`** | Back / Return | 10009 | Close modal / player / return to home |
| **`Space` / `p`** | MediaPlayPause | 10252 | Toggle video playback |
| **`f`** | Fast Forward | 417 | Forward video |
| **`r`** | Rewind | 412 | Rewind video |

---

## Visual TV Remote Simulator HUD

A floating TV remote widget is displayed at the bottom-right of your screen during local development:
* **Clickable D-Pad:** Click ▲, ▼, ◀, ▶, OK, and Back with your mouse to test focus state transitions without using the keyboard.
* **Live HUD Metrics:** Displays active focused DOM element and key event latency.
* **Tizen API Shim:** Emulates `window.tizen.tvinputdevice` and `window.tizen.application` so all TV hardware calls execute safely on desktop.

---

## Testing Features Locally

1. **Catalog Browsing:** Browse Home, Movies, TV Shows, and Watchlist rows.
2. **Search:** Click `🔍 Search` to test the 10-foot on-screen virtual keyboard and live TMDB query results.
3. **Details & Seasons:** Click any TV series card to test the season switcher and episode list.
4. **Player & Multi-Provider Switcher:** Click "Play" on any movie or episode to test iframe streaming and switch between servers (VidLink, Embed.su, AutoEmbed, VidSrc, SmashyStream).
5. **Custom TMDB API Key:** Click `⚙ Settings` to enter your personal TMDB API key and test real-time validation.
