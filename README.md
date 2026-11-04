# AI Line Translator

For the verified HappySubs alternative on CSOD, see [HAPPYSUBS-CSOD.md](HAPPYSUBS-CSOD.md). It supports browser-based Deepgram or Alibaba Cloud Bailian speech recognition, up to five keys per provider, and optional local fallback. Configuration and verification results are documented in [DEEPGRAM.md](DEEPGRAM.md).

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

- On the inspected CSOD course (Articulate Storyline, “Psychosocial wellbeing”), the visible English subtitles are embedded in the MP4 image. The `.caption` element is empty and the video has no text tracks. DOM caption reading cannot extract those words; OCR or audio recognition is needed.
- Starting the reader now reports whether readable captions were found. Stopping cancels polling, pending translations and text-track listeners; old responses cannot overwrite newer captions.

- The caption reader uses common player selectors and HTML5 text tracks. CSOD may use a custom player, canvas rendering, closed shadow DOM, or cross-origin frame restrictions; therefore detection is not guaranteed until tested on the exact course page.
- The Google web endpoint used here is an unofficial web interface, not a supported or guaranteed free API. It may be throttled, changed, or blocked. Do not use it as a production SLA.
- If captions cannot be extracted, the extension currently cannot translate them in this mode. Audio capture remains available as a separate, API-configured fallback.
- Translation requests are sent to Google. Do not use this mode for confidential content unless this data flow is acceptable.
- No API key is embedded in the extension.

## Provider roadmap

A generic provider configuration is planned for user-supplied OpenAI-compatible models (for example Xiaomi MiMo, DeepSeek, or other compatible services). It is not yet implemented in this version.

## Verification

Build the HappySubs compatibility copy first using an installed HappySubs 2.2.2 source directory, as described in [HAPPYSUBS-CSOD.md](HAPPYSUBS-CSOD.md). Generated extension resources are excluded from Git; all custom source and the build script are included.

Run `node --test tests/*.test.cjs` for caption reading, speech providers, key rotation, capture lifecycle, playback, and CSOD regressions. The optional legacy Python bridge tests use `python -m unittest discover -s tests -p test_deepgram_bridge.py` with dependencies from `scripts/requirements-deepgram.txt` installed.
For a browser check, run `node tests/serve.cjs`, open `http://127.0.0.1:18765`, then start, change and stop subtitles. The fixture simulates translation responses; it does not call a translation service.
