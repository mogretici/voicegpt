# VoiceGPT

**VoiceGPT** is a real-time, barge-in enabled voice AI assistant component for React.  
It transcribes user speech with Whisper, generates intelligent responses using GPT-3.5, and speaks responses out loud via TTS.

---

## ✨ Features

- 🎙️ Real-time speech transcription using OpenAI Whisper
- 🤖 AI-powered response generation via OpenAI GPT-3.5
- 🔊 Voice output with OpenAI TTS (Text-to-Speech)
- 🛑 Barge-in support: users can interrupt assistant's speech
- 🧹 Automatic microphone/audio resource management
- 🛠️ Full TypeScript support with strongly-typed props
- 🪝 Easy integration using both a component and a custom React hook

---

## 📦 Installation

```bash
npm install voicegpt
```

or

```bash
yarn add voicegpt
```

---

## 🚀 Usage

### 1. Component Usage

```tsx
import { VoiceGPT } from "voicegpt";

const App = () => (
  <VoiceGPT apiKey="YOUR_OPENAI_API_KEY">
    {({ recording, question, response, startInteraction, stopInteraction, isLoading }) => (
      <div>
        <button onClick={startInteraction}>
          {recording ? "Recording..." : "Start Listening"}
        </button>
        <p><strong>Question:</strong> {question}</p>
        <p><strong>Response:</strong> {response}</p>
        {isLoading && <p>Loading...</p>}
      </div>
    )}
  </VoiceGPT>
);
```

---

### 2. Hook Usage

```tsx
import { useVoiceGPT } from "voicegpt";

const App = () => {
  const {
    VoiceGPTInstance,
    recording,
    question,
    response,
    isLoading,
    startInteraction,
    stopInteraction
  } = useVoiceGPT({ apiKey: "YOUR_OPENAI_API_KEY" });

  return (
    <div>
      {VoiceGPTInstance}
      <button onClick={startInteraction}>
        {recording ? "Recording..." : "Start Listening"}
      </button>
      <p><strong>Question:</strong> {question}</p>
      <p><strong>Response:</strong> {response}</p>
      {isLoading && <p>Loading...</p>}
    </div>
  );
};
```

---

## ⚙️ Props

| Prop               | Description                           | Type                   | Default                     |
|:-------------------|:--------------------------------------|:------------------------|:----------------------------|
| apiKey             | Your OpenAI API key                   | `string`                | **Required**                |
| systemPrompt       | Assistant system prompt               | `string`                | `"You are a helpful assistant."` |
| greetingMessage    | Greeting message                      | `string`                | `"Hello, how can I help you?"` |
| silenceThreshold   | Silence threshold (in dB)             | `number`                | `-25`                       |
| silenceTimeout     | Silence duration before processing    | `number`                | `1500` (ms)                 |
| minSpeechDuration  | Minimum speech duration before accept | `number`                | `500` (ms)                  |
| debugMode          | Enable debug logging                  | `boolean`               | `false`                     |
| gptModel           | OpenAI GPT model name                 | `string`                | `"gpt-3.5-turbo"`            |
| whisperModel       | OpenAI Whisper model name             | `string`                | `"whisper-1"`               |
| ttsModel           | OpenAI TTS model name                 | `string`                | `"tts-1"`                   |
| ttsVoice           | OpenAI TTS voice name                 | `string`                | `"nova"`                    |
| onError            | Custom error handler callback         | `(err: Error) => void`   | -                           |

---

## 🖥️ Requirements

- Modern browsers (Chrome 95+, Edge 95+, Safari 15+)
- Web Audio API support
- OpenAI API access (Whisper, GPT, and TTS endpoints)

---

## 📄 License

MIT License

---

## 🙌 Contribution

Feel free to open issues or submit pull requests to improve the package!

