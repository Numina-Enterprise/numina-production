import os
import sys
import asyncio
from typing import List, Dict, Any
from google import genai
from google.genai import types

SYSTEM_INSTRUCTION = """You are Numina Chat Assistant for numinalabs.xyz.
You represent Numina Enterprise - providing verified multi-cloud financial intelligence,
zero-loss reconciliation at scale ($1.5Q), Cloud HSM keypinning, and decentralized coordination.
Be helpful, concise, technically rigorous, and security-conscious.
If questions relate to system health or security, cite DNSSEC, Cloudflare zero-trust, and ratifications."""

class NuminaChatbot:
    def __init__(self, api_key: str = None):
        key = api_key or os.environ.get("GEMINI_API_KEY")
        if not key:
            raise ValueError("GEMINI_API_KEY is required.")
        self.client = genai.Client(api_key=key)
        self.history: List[Dict[str, Any]] = []

    async def chat(self, user_message: str) -> str:
        self.history.append({"role": "user", "parts": [user_message]})
        response = await self.client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=self.history,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.7,
            )
        )
        agent_reply = response.text or ""
        self.history.append({"role": "model", "parts": [agent_reply]})
        return agent_reply

async def interactive_cli():
    print("=" * 60)
    print("Numina Web Chatbot (numinalabs.xyz)")
    print("Type 'exit' to quit.")
    print("=" * 60)
    try:
        bot = NuminaChatbot()
    except Exception as e:
        print(f"Error initializing: {e}")
        return

    while True:
        try:
            user_input = input("\nYou: ").strip()
            if not user_input:
                continue
            if user_input.lower() in ("exit", "quit"):
                break
            reply = await bot.chat(user_input)
            print(f"\nNumina: {reply}")
        except (KeyboardInterrupt, EOFError):
            break

if __name__ == "__main__":
    asyncio.run(interactive_cli())
