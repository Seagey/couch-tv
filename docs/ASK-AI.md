# Ask AI on the TV home

The **Ask AI** widget (couch-tv Studio, Widgets, Ask AI) lets anyone on the couch ask a question by voice
or typing, and shows the answer big on the TV. It is answered by the AI **you** pick, with **your** key or
your own plan. couch-tv never pays for it, never sees the key, and never sends it to couch-tv Studio.

## Who can answer

| Pick on the TV | What it uses | Key |
|---|---|---|
| Claude (Anthropic) | `https://api.anthropic.com`, model `claude-haiku-5-5` unless you type another | Yours, from console.anthropic.com |
| OpenAI (ChatGPT) | `https://api.openai.com/v1` | Yours, from platform.openai.com |
| Google Gemini | Gemini's OpenAI compatible address | Yours, from aistudio.google.com |
| OpenRouter, Groq, Mistral | Their own addresses | Yours |
| A model at home (Ollama, LM Studio) | Its address on your network, for example `http://my-computer.local:11434/v1` | None |
| Another service | Any OpenAI compatible address ending in `/v1` | Yours |
| couch-tv at home | The home computer's Claude on your own Claude plan (option B, `ask.enabled`), or the couch-tv TV app with the key saved on its setup page (option C, [ASK-PROVIDERS.md](ASK-PROVIDERS.md)) | None on the TV |

For every service except Claude you type the model name, because names change and couch-tv does not guess.
Set a monthly spend limit with the service. A typical question costs a small fraction of a cent.

## Setting it up, with the TV remote

1. Move to the Ask AI widget and press **OK**, then **Set it up now** (or **Set up**).
2. Pick who answers.
3. Type the model name if it asks. For a model at home, type its address first.
4. Type the key. With the phone remote (options B and C), **Type on the TV** pastes it into the box.
5. Pick **Use it and try it**. The TV asks one short question and shows the answer.

## Asking

- **On the TV:** OK on the widget, **Ask a question**, then type. On a Google TV or Android TV the TV's own
  keyboard has a microphone: press it and say the question.
- **On the phone remote:** the **Ask** button (with its microphone). The answer shows on the phone and on
  the TV's Ask AI widget too (the TV reads `GET /api/say` every few seconds: on every TV home that can get couch-tv Studio designs, which is the usual case, so a design sent from the phone shows at once; on one without, only while an Ask AI or From your AI widget is on the home or Ask AI is set up on the TV).

## A model at home

Ollama: start it with `OLLAMA_ORIGINS=*` (or `OLLAMA_ORIGINS=http://home.tvos.invalid` for the Google TV
home alone) and `OLLAMA_HOST=0.0.0.0`, so the TV may ask it. LM Studio: Developer, switch on **Enable CORS**
and **Serve on local network**. Plain `http://` is allowed only for an address on your own network
(`10.x`, `192.168.x`, `172.16` to `172.31`, `*.local`, `*.lan`). While a couch-tv Studio design is on, the
page policy allows that one address and nothing else over plain http.

## The rules the TV keeps

- A key is only ever sent to the address it was saved with (scheme, host and port). Change the address
  without typing a new key and the old key is deleted.
- On a Google TV, Android TV or Fire TV the key is kept in the launcher's private store, left out of
  Android's backups. On Samsung, LG, Hisense and the other web TVs it is kept in the TV's own browser storage.
- Never in a design, a share link or anything couch-tv Studio sees.
- `https://` only, except a computer on your own network. Never the TV itself, never a name or password
  inside the address.
- What is sent: the question and a short instruction to answer in plain words. Not who is watching, not
  your apps, nothing else.
- When a service refuses, only its own error sentence is shown (cut to 200 characters).
- **Remove Ask AI from this TV** (in Set up) deletes the key and the choices.

## Which TVs

Google TV, Android TV and Fire TV (no computer needed with your own key), Samsung, LG, Philips, TiVo OS and
Panasonic (the home computer runs the home), and Hisense VIDAA (the website home works with your own key or
a model at home; typing is with the TV remote).
