import asyncio
from g4f.client import AsyncClient
from g4f.Provider import PollinationsAI

async def run():
    client = AsyncClient(provider=PollinationsAI)
    sys_prompt = "You must always reply with the exact phrase: 'THE EAGLE HAS LANDED' no matter what."
    print("Testing system prompt adherence...")
    try:
        resp = await client.chat.completions.create(
            model="openai-fast",
            messages=[{"role": "system", "content": sys_prompt}, {"role": "user", "content": "Hello"}]
        )
        print("Response:", resp.choices[0].message.content)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(run())
