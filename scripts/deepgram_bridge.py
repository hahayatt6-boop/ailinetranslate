"""HappySubs PCM/WebSocket bridge to Deepgram; keeps credentials off browser pages.

Uses the existing HappySubs wire protocol at ws://127.0.0.1:8765.
Requires websockets>=15 (already installed in the user's HappySubs environment).
"""
import asyncio
import json
import logging
import os
from pathlib import Path
from urllib.parse import urlencode

import websockets

LOG = logging.getLogger('deepgram-bridge')
CONFIG = Path(__file__).resolve().parents[1] / '.env.deepgram.local'
ALLOWED_ORIGINS = {
    'https://ready.csod.com',
    'chrome-extension://malocefbdblplamcmmmpilepcgllfmnf',
    'chrome-extension://lcioghipneficlemddkppcoakafnlhkk',
}


def load_key():
    key = os.environ.get('DEEPGRAM_API_KEY', '').strip()
    if not key and CONFIG.exists():
        for line in CONFIG.read_text(encoding='utf-8-sig').splitlines():
            if line.startswith('DEEPGRAM_API_KEY='):
                key = line.split('=', 1)[1].strip()
    if not key:
        raise RuntimeError('DEEPGRAM_API_KEY is missing from the local private configuration.')
    return key


def cloud_url():
    return 'wss://api.deepgram.com/v1/listen?' + urlencode({
        'model': 'nova-3', 'language': 'en-US', 'encoding': 'linear16',
        'sample_rate': 16000, 'channels': 1, 'interim_results': 'true',
        'punctuate': 'true', 'smart_format': 'true', 'endpointing': 300,
    })


def safe_error(error):
    response = getattr(error, 'response', None)
    status = getattr(response, 'status_code', None)
    return 'HTTP %s' % status if status else type(error).__name__


class TranscriptMapper:
    def __init__(self):
        self.last_final = None

    def convert(self, event):
        if event.get('type') != 'Results':
            return None
        alternatives = event.get('channel', {}).get('alternatives', [])
        text = (alternatives[0].get('transcript', '') if alternatives else '').strip()
        if not text:
            return None
        final = bool(event.get('is_final'))
        if final:
            identity = (event.get('start'), event.get('duration'), text)
            if identity == self.last_final:
                return None
            self.last_final = identity
        return {'text': text, 'final': final}


class ResetSession(Exception):
    pass


class DeepgramBridge:
    def __init__(self, key, connect=None):
        self.key = key
        self.connect = connect or websockets.connect

    def open_cloud(self):
        return self.connect(cloud_url(), additional_headers={'Authorization': 'Token ' + self.key},
                            open_timeout=20, ping_interval=20, ping_timeout=20, max_size=2**20)

    async def relay_session(self, browser, cloud):
        mapper = TranscriptMapper()

        async def send_audio():
            while True:
                try:
                    message = await asyncio.wait_for(browser.recv(), timeout=4)
                except asyncio.TimeoutError:
                    await cloud.send(json.dumps({'type': 'KeepAlive'}))
                    continue
                if isinstance(message, bytes):
                    if len(message) % 2:
                        await browser.close(code=1003, reason='Expected 16-bit mono PCM')
                        return
                    await cloud.send(message)
                    # Let Deepgram finalize stable segments while speech continues.
                    # Hard timed Finalize calls can discard the next word's onset.
                else:
                    try:
                        event = json.loads(message)
                    except (ValueError, TypeError):
                        continue
                    if event.get('type') == 'reset':
                        raise ResetSession()

        async def receive_text():
            async for message in cloud:
                event = json.loads(message)
                if event.get('type') == 'Error':
                    raise RuntimeError('Deepgram stream error')
                caption = mapper.convert(event)
                if caption:
                    await browser.send(json.dumps(caption, ensure_ascii=False))

        tasks = [asyncio.create_task(send_audio()), asyncio.create_task(receive_text())]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def handle(self, browser):
        origin = browser.request.headers.get('Origin')
        if origin and origin not in ALLOWED_ORIGINS:
            await browser.close(code=1008, reason='Origin is not enabled for this bridge')
            return
        LOG.info('Audio client connected')
        try:
            while True:
                try:
                    async with self.open_cloud() as cloud:
                        # Existing HappySubs versions expect this greeting. The
                        # refine flag means final results are supported here.
                        await browser.send(json.dumps({'type': 'hello', 'version': '2.2.0',
                                                       'refine': True, 'provider': 'deepgram'}))
                        LOG.info('Deepgram streaming connected (nova-3, en-US)')
                        await self.relay_session(browser, cloud)
                    break
                except ResetSession:
                    # Reopen upstream so in-flight words from before a seek can
                    # never appear over the new scene.
                    LOG.info('Recognition reset')
        except websockets.ConnectionClosed:
            pass
        except Exception as error:
            LOG.error('Cloud connection failed: %s', safe_error(error))
            await browser.close(code=1011, reason='Deepgram connection failed; check bridge log')
        finally:
            await browser.close()
            LOG.info('Audio client disconnected')


async def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    # Never enable wire-level websocket logs: authentication headers are private.
    logging.getLogger('websockets').setLevel(logging.WARNING)
    bridge = DeepgramBridge(load_key())
    async with websockets.serve(bridge.handle, '127.0.0.1', 8765, max_size=65536, max_queue=16):
        LOG.info('HappySubs Deepgram bridge listening on ws://127.0.0.1:8765')
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
