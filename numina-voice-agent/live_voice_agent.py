import asyncio
import os
import sys
import pyaudio
from google import genai
from google.genai import types

# ---------------- Configuration & Audio Constants ----------------
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
CHANNELS = 1
CHUNK_SIZE = 1024

MODEL_NAME = "gemini-3.8-live"  # Or "gemini-3.8-live-extended-thinking"

# ---------------- Tool Definition (NON_BLOCKING) ----------------
# Non-blocking allows continuous conversational fillers while execution proceeds in background
weather_tool = types.FunctionDeclaration(
    name="get_current_weather",
    description="Gets the current weather for a given city.",
    behavior="NON_BLOCKING",
    parameters={
        "type": "OBJECT",
        "properties": {
            "city": {
                "type": "STRING",
                "description": "City name, e.g., 'San Francisco, CA'",
            }
        },
        "required": ["city"],
    },
)

status_tool = types.FunctionDeclaration(
    name="query_numina_status",
    description="Queries the operational and infrastructure status of numinalabs.xyz and Numina services.",
    behavior="NON_BLOCKING",
    parameters={
        "type": "OBJECT",
        "properties": {
            "service_name": {
                "type": "STRING",
                "description": "Service name, e.g., 'web', 'treasury', 'contracts', 'all'",
            }
        },
        "required": ["service_name"],
    },
)

async def execute_weather_lookup(city: str) -> dict:
    """Simulated async background function."""
    await asyncio.sleep(2.5)  # Simulate network / API delay
    return {"city": city, "temperature": "68°F", "condition": "Sunny with light breeze"}

async def execute_status_lookup(service_name: str) -> dict:
    """Async background service check."""
    await asyncio.sleep(1.0)
    return {
        "service": service_name,
        "domain": "numinalabs.xyz",
        "status": "OPERATIONAL",
        "dnssec": "ACTIVE",
        "hsm_signing": "ENABLED",
        "cluster_state": "726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd"
    }


# ---------------- Audio Input & Output Handlers ----------------
class LiveVoiceAgent:
    def __init__(self, client: genai.Client):
        self.client = client
        self.pyaudio_instance = pyaudio.PyAudio()
        self.audio_out_queue = asyncio.Queue()
        self.is_running = True

    async def audio_input_loop(self, session):
        """Streams microphone PCM audio to Gemini Live API."""
        loop = asyncio.get_running_loop()
        stream = self.pyaudio_instance.open(
            format=pyaudio.paInt16,
            channels=CHANNELS,
            rate=INPUT_SAMPLE_RATE,
            input=True,
            frames_per_buffer=CHUNK_SIZE,
        )

        try:
            while self.is_running:
                # Read raw PCM chunk asynchronously
                chunk = await loop.run_in_executor(
                    None, stream.read, CHUNK_SIZE, False
                )
                if not chunk:
                    continue

                # Stream audio via send_realtime_input
                await session.send_realtime_input(
                    audio=types.Blob(
                        data=chunk,
                        mime_type=f"audio/pcm;rate={INPUT_SAMPLE_RATE}",
                    )
                )
        except asyncio.CancelledError:
            pass
        finally:
            stream.stop_stream()
            stream.close()

    async def audio_output_loop(self):
        """Plays received 24kHz PCM chunks through the speakers."""
        loop = asyncio.get_running_loop()
        stream = self.pyaudio_instance.open(
            format=pyaudio.paInt16,
            channels=CHANNELS,
            rate=OUTPUT_SAMPLE_RATE,
            output=True,
            frames_per_buffer=CHUNK_SIZE,
        )

        try:
            while self.is_running:
                chunk = await self.audio_out_queue.get()
                if chunk is None:
                    continue
                await loop.run_in_executor(None, stream.write, chunk)
                self.audio_out_queue.task_done()
        except asyncio.CancelledError:
            pass
        finally:
            stream.stop_stream()
            stream.close()

    async def handle_tool_calls(self, session, tool_call):
        """Executes non-blocking tool calls and returns function response."""
        for call in tool_call.function_calls:
            print(f"\n[Tool Invoked] {call.name}({call.args})")
            result = {}
            if call.name == "get_current_weather":
                city = call.args.get("city", "Unknown")
                result = await execute_weather_lookup(city)
            elif call.name == "query_numina_status":
                svc = call.args.get("service_name", "all")
                result = await execute_status_lookup(svc)
            else:
                result = {"status": "UNKNOWN_TOOL"}

            # Send the tool response back through the session
            response = types.FunctionResponse(
                id=call.id,
                name=call.name,
                response=result,
            )
            await session.send_tool_response(function_responses=[response])
            print(f"[Tool Response Sent] {result}")

    def clear_output_queue(self):
        """Clears pending audio buffers immediately upon user interruption."""
        while not self.audio_out_queue.empty():
            try:
                self.audio_out_queue.get_nowait()
                self.audio_out_queue.task_done()
            except asyncio.QueueEmpty:
                break

    async def receive_loop(self, session):
        """Processes incoming events: audio chunks, transcripts, tool calls, and interruptions."""
        async for message in session.receive():
            status = getattr(message, "interaction_status", None)

            # 1. Process server content (Model speech & Transcriptions)
            if message.server_content:
                content = message.server_content

                # Interruption check: immediately purge output buffer
                if content.interrupted:
                    print("\n[Interrupted by user]")
                    self.clear_output_queue()
                    continue

                # Live Transcripts
                if content.input_transcription:
                    print(f"User: {content.input_transcription.text}", end="\r")
                if content.output_transcription:
                    print(f"Agent: {content.output_transcription.text}")

                # Audio Playback: process ALL inline audio parts
                if content.model_turn and content.model_turn.parts:
                    for part in content.model_turn.parts:
                        if part.inline_data and part.inline_data.data:
                            await self.audio_out_queue.put(part.inline_data.data)

            # 2. Asynchronous Non-Blocking Tool Calls
            if message.tool_call:
                # Spawn in background so listening/streaming loop is never blocked
                asyncio.create_task(self.handle_tool_calls(session, message.tool_call))

            # 3. Lifecycle Status Check
            if status == "IDLE":
                pass  # Ready for subsequent user turns

    async def run(self):
        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.AUDIO],
            system_instruction=types.Content(
                parts=[
                    types.Part(
                        text=(
                            "You are Numina Voice, the official real-time voice intelligence agent for numinalabs.xyz. "
                            "You are friendly, concise, and ultra-responsive. Keep spoken answers natural and conversational. "
                            "When querying live infrastructure or background tools, give brief conversational fillers if needed."
                        )
                    )
                ]
            ),
            tools=[types.Tool(function_declarations=[weather_tool, status_tool])],
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
        )

        async with self.client.aio.live.connect(model=MODEL_NAME, config=config) as session:
            print("Connected to Gemini Live API. Speak into your microphone (Ctrl+C to stop)...")
            
            tasks = [
                asyncio.create_task(self.audio_input_loop(session)),
                asyncio.create_task(self.audio_output_loop()),
                asyncio.create_task(self.receive_loop(session)),
            ]
            try:
                await asyncio.gather(*tasks)
            except asyncio.CancelledError:
                pass
            finally:
                self.is_running = False
                for t in tasks:
                    t.cancel()
                self.pyaudio_instance.terminate()


async def main():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Please set your GEMINI_API_KEY environment variable.")
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    agent = LiveVoiceAgent(client)
    try:
        await agent.run()
    except KeyboardInterrupt:
        print("\nExiting session.")


if __name__ == "__main__":
    asyncio.run(main())
