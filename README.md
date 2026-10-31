# AI Line Translator

A personal-use Chrome Manifest V3 extension for live bilingual subtitles on browser audio. The first milestone targets SCORM training pages and YouTube.

## What works in this MVP

- User-initiated tab audio capture through `chrome.tabCapture`.
- Captured audio is played back through an offscreen document so the tab does not go silent.
- Audio is chunked and sent to a configurable OpenAI-compatible transcription endpoint (default path: `/v1/audio/transcriptions`).
- Recognized text is translated through a configurable chat-completions endpoint.
- Original text and Chinese translation are shown in a draggable in-page subtitle overlay.
- API keys and endpoint settings are stored locally in `chrome.storage.local`; never commit credentials.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this project directory.
5. Open a SCORM training page or YouTube video, then click the extension icon and press **Start capture**.

## Configure providers

Open the extension popup and expand **Provider settings**.

- **ASR base URL**: OpenAI-compatible base URL, e.g. `https://api.openai.com/v1`.
- **ASR model**: e.g. `whisper-1` (must be supported by your provider).
- **Translation base URL**: OpenAI-compatible base URL, e.g. `https://api.openai.com/v1`.
- **Translation model**: a chat-completions model supported by your provider.
- **API key**: stored in this browser profile only.

The extension appends `/audio/transcriptions` and `/chat/completions` to the configured base URLs. If your provider uses a different API shape, it needs a provider adapter.

## Notes / limitations

- This is an early functional MVP, not a claim of production-grade streaming. MediaRecorder emits short WebM chunks; provider support for independent WebM chunks varies.
- Transcription and translation are sequential and can have latency. A future iteration should use a streaming ASR provider and rolling context.
- Browser capture requires a user gesture and works on the active tab. Protected/DRM media, browser-internal pages, and some enterprise-managed pages may block capture.
- Chrome extension audio capture permissions and host permissions are declared in the manifest. Review them before distributing.
- The extension does not include a default paid API key or guarantee any provider's free tier.
- No TTS is included in this first version.

## Development

No build step is required. Source is plain JavaScript, HTML, and CSS.
