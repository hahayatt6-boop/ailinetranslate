# AI Line Translator

A Chrome Manifest V3 extension for bilingual subtitles on browser-based training videos.

## Experimental native-caption mode (v0.2.0)

- Reads visible caption/subtitle DOM nodes and native HTML5 text tracks in the current page and accessible frames.
- Sends caption text to a Google web-translation endpoint from the extension service worker; no Google Cloud key is requested.
- Shows original text plus Chinese translation in a compact draggable overlay.
- Includes a small in-memory translation cache to reduce repeated requests.
- Native-caption mode does not require an ASR API key.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project directory.
5. Refresh the training page, open the extension popup, and click **读取网页字幕**.

## Important limitations

- The caption reader uses common player selectors and HTML5 text tracks. CSOD may use a custom player, canvas rendering, closed shadow DOM, or cross-origin frame restrictions; therefore detection is not guaranteed until tested on the exact course page.
- The Google web endpoint used here is an unofficial web interface, not a supported or guaranteed free API. It may be throttled, changed, or blocked. Do not use it as a production SLA.
- If captions cannot be extracted, the extension currently cannot translate them in this mode. Audio capture remains available as a separate, API-configured fallback.
- Translation requests are sent to Google. Do not use this mode for confidential content unless this data flow is acceptable.
- No API key is embedded in the extension.

## Provider roadmap

A generic provider configuration is planned for user-supplied OpenAI-compatible models (for example Xiaomi MiMo, DeepSeek, or other compatible services). It is not yet implemented in this version.
