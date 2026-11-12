# Ask with any AI service (on-TV mode)

On-TV mode (option C, the `dev.couchtv.ontv` app) can answer "put on Bluey" with an AI that finds
the show and presses the TV's buttons. It is **off by default**. This page says which AI services
it can use, how to set one up, and what a model has to support.

The computer bridge (option B) is different: it runs the Claude Code program on your own Claude
plan and never uses an API key. Nothing here changes it.

## Which services

The TV speaks two wire formats, and one of them covers almost everything else:

| You pick on the setup page | Wire format | Web address it uses |
|---|---|---|
| Claude (Anthropic) | Anthropic Messages API | `https://api.anthropic.com` |
| OpenAI | OpenAI chat completions | `https://api.openai.com/v1` |
| Google Gemini | OpenAI compatible | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenRouter | OpenAI compatible | `https://openrouter.ai/api/v1` |
| Groq | OpenAI compatible | `https://api.groq.com/openai/v1` |
| Mistral | OpenAI compatible | `https://api.mistral.ai/v1` |
| A model at home | OpenAI compatible | for example `http://my-computer.local:11434/v1` (Ollama) |
| Another service | OpenAI compatible | whatever address it gives you, ending in `/v1` |

Claude Haiku 5.5 is the tested default and costs about a fifth of a US cent per ask. For every other
service you type the **model name** yourself, because model names change and the app does not guess.
Prices differ: set a monthly spend limit with the service.

## Setting it up

1. Open the setup page on a phone that is paired with the TV: `http://<tv address>:5400/setup`.
2. In **Ask**, choose the AI service. The web address fills in. Type the model name for any service
   except Claude.
3. Paste the API key (a server at home on your own network needs none) and tick **Switch ask on**.
4. **Save ask.** The page says whether it is ready.

Use a key made only for this TV. It is stored on the TV in the app's private storage, and anyone with
ADB access to the TV can read it. **A key is only ever sent to the exact address it was saved for**: it is
stored together with its service, scheme, host and port, and the app uses it only while that is still the
address in use. If you change any of those and do not type a new key, the old key is deleted, and it could
not be used anyway.

## What a model has to support

Ask works by tool calling. The model gets four tools (`play`, `launch`, `key`, `now`) and must be able
to call them. Pick a model that supports **function calling / tool use**. A small local model that does
not will answer in words and press nothing. A typical ask is a few short calls, around 12,000 input
tokens and 1,200 output tokens in total, and a one or two sentence answer. The loop stops after five
rounds.

## What it does when asked

- It is told which apps the TV has and may only open those. Without that list a model guesses at services for
  the wrong country (it tried Netflix, Stan and ABC iview on a TV with none of them, failed five times, and the
  app then said a bare "Done.").
- A request for a suggestion or recommendation is answered in text, without tools.
- If something fails it may try one other way, then says plainly what did not work. If it runs out of rounds, or
  stops without words after a failure, the reply is the last reason (for example "I could not finish that. Last
  problem: launch: com.netflix.ninja is not installed on the TV"). "Done." is only said when something was done.
- Set the country on the setup page: it steers which streaming services a title is looked up for.

## Rules the app enforces

- A web address must be `https://`. Plain `http://` is accepted only for a server on your own network
  (`localhost`, `10.x`, `192.168.x`, `172.16` to `172.31`, `169.254.x`, `*.local`, `*.lan`), so a key
  never crosses the internet unencrypted.
- No name or password inside the address, and no `?` or `#`: it ends at the path.
- The address cannot be the TV itself. The obvious spellings (`localhost`, `127.x`, `::1`, `0.0.0.0`) are
  refused when you save. Every ask then resolves the name and refuses it again if any answer is loopback,
  "any", or one of the TV's own network addresses, so a name that points at the TV does not get past it.
  A computer on your network is fine. A name that changes its answer between that check and the connection
  can only matter for plain `http://`, which is allowed for home network names only; over `https://` the
  certificate would not match the TV's own plain http services.
- When a service refuses a request, only its own JSON error message is shown (cut to 200 characters),
  never anything else it sent back. A reply that is not in the expected shape produces one fixed sentence
  that quotes nothing from it.
- Claude always needs a key. An OpenAI compatible address on your own network may have none.
- Ask is off for a kids profile, as before.

## The settings API

`GET /api/settings` returns `ask`: `enabled`, `has_key`, `provider` (`anthropic` or `openai`), `base`,
`model`, `keyless_ok` and `ready`. It never returns the key. `POST /api/settings` accepts `ask_enabled`,
`ask_key`, `ask_provider`, `ask_base` and `ask_model`. A wrong value answers `400` with a sentence and
saves nothing. An empty `ask_base` or `ask_model` means the service's default.

## Adding another kind of service

The TV app's code for each wire format is in `on-tv/android/app/src/main/java/dev/couchtv/ontv/AskWire.kt`
(`AnthropicChat` and `OpenAiChat`), in plain Kotlin with no Android in it. Their rules are unit tested in
`AskWireTest.kt` (`gradle testDebugUnitTest` in `on-tv/android`). A service with its own format is one more
`AskChat` subclass and one more line in `AskWire.chat`.

## Cost and privacy

Each ask sends the question, the selected person's name if there is one, the country, **the names of the
apps installed on the TV** (so the model does not guess at apps you do not have), the descriptions of the
four tools, and what those tools return (for example what is playing now or the result of a search) to
the service you chose. Nothing else is sent, and nothing is sent unless ask is on and someone
asks. The app does not follow redirects, so a service cannot pass your key on to another address. See
your service's own terms for how it handles what it receives.
