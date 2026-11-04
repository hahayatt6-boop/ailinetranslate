import importlib.util
from pathlib import Path
import unittest
import asyncio
import json
import websockets

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'scripts/deepgram_bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def result(text, final=False, start=0, duration=1):
    return {'type': 'Results', 'start': start, 'duration': duration,
            'is_final': final, 'channel': {'alternatives': [{'transcript': text}]}}


class TranscriptTests(unittest.TestCase):
    def test_interim_is_revised_then_finalized_without_duplication(self):
        mapper = bridge.TranscriptMapper()
        self.assertEqual(mapper.convert(result('a boy')), {'text': 'a boy', 'final': False})
        self.assertEqual(mapper.convert(result('A boy eats an apple.', True)),
                         {'text': 'A boy eats an apple.', 'final': True})
        self.assertIsNone(mapper.convert(result('A boy eats an apple.', True)))

    def test_consecutive_final_segments_are_not_recombined_into_a_long_sentence(self):
        mapper = bridge.TranscriptMapper()
        mapper.convert(result('The first part', True))
        self.assertEqual(mapper.convert(result('and the second part.', True, 1)),
                         {'text': 'and the second part.', 'final': True})

    def test_silence_does_not_emit_empty_caption(self):
        mapper = bridge.TranscriptMapper()
        self.assertIsNone(mapper.convert(result('', True)))
        self.assertIsNone(mapper.convert({'type': 'Metadata'}))

    def test_cloud_errors_do_not_include_credentials(self):
        class FailedAuth(Exception):
            response = type('Response', (), {'status_code': 401})()
        self.assertEqual(bridge.safe_error(FailedAuth('secret-token')), 'HTTP 401')


class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.finalized = asyncio.Event()
        self.disconnected = asyncio.Event()
        self.connections = 0
        self.controls = []

        async def upstream(ws):
            self.connections += 1
            connection = self.connections
            count = 0
            try:
                async for message in ws:
                    if isinstance(message, bytes):
                        count += 1
                        await ws.send(json.dumps(result('stream %s' % connection)))
                        if count == 3:
                            self.finalized.set()
                            await ws.send(json.dumps(result('final %s' % connection, True)))
                    else:
                        self.controls.append(json.loads(message).get('type'))
            finally:
                self.disconnected.set()

        self.cloud_server = await websockets.serve(upstream, '127.0.0.1', 0)
        cloud_port = self.cloud_server.sockets[0].getsockname()[1]

        def connect(url, **options):
            return websockets.connect('ws://127.0.0.1:%s' % cloud_port, proxy=None, **options)

        self.server = await websockets.serve(bridge.DeepgramBridge('test-only', connect).handle, '127.0.0.1', 0)
        self.url = 'ws://127.0.0.1:%s' % self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()
        self.cloud_server.close()
        await self.cloud_server.wait_closed()

    async def test_happysubs_protocol_streams_partials_and_short_finals(self):
        async with websockets.connect(self.url, proxy=None) as client:
            self.assertEqual(json.loads(await client.recv())['provider'], 'deepgram')
            for _ in range(3):
                await client.send(bytes(32000))
            messages = [json.loads(await asyncio.wait_for(client.recv(), 2)) for _ in range(4)]
            self.assertEqual(messages[-1], {'text': 'final 1', 'final': True})
            self.assertTrue(self.finalized.is_set())
            self.assertNotIn('Finalize', self.controls)
        await asyncio.wait_for(self.disconnected.wait(), 2)

    async def test_seek_reopens_cloud_session_before_new_captions(self):
        async with websockets.connect(self.url, proxy=None) as client:
            await client.recv()
            await client.send(json.dumps({'type': 'reset'}))
            self.assertEqual(json.loads(await asyncio.wait_for(client.recv(), 2))['type'], 'hello')
            await client.send(bytes(4096))
            self.assertEqual(json.loads(await asyncio.wait_for(client.recv(), 2))['text'], 'stream 2')

    async def test_unapproved_webpage_origin_cannot_use_cloud_key(self):
        async with websockets.connect(self.url, proxy=None, origin='https://unrelated.example') as client:
            with self.assertRaises(websockets.ConnectionClosed) as closed:
                await client.recv()
            self.assertEqual(closed.exception.rcvd.code, 1008)
        self.assertEqual(self.connections, 0)


if __name__ == '__main__':
    unittest.main()
