//openaiApi.ts

import axios from "axios";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MODELS = { GPT: "gpt-3.5-turbo", WHISPER: "whisper-1", TTS: "tts-1" };
const VOICE = "nova";

const getAuthHeaders = (apiKey: string) => ({
    Authorization: `Bearer ${apiKey}`,
});

export const transcribeAudio = async (
    audioBlob: Blob | any,
    apiKey: string,
    signal?: AbortSignal
): Promise<string> => {
    const formData = new FormData();
    formData.append("file", new File([audioBlob], "audio.webm"));
    formData.append("model", MODELS.WHISPER);

    const { data } = await axios.post(
         `${OPENAI_BASE_URL}/audio/transcriptions`
        , formData, {
        headers: {
            ...getAuthHeaders(apiKey),
            "Content-Type": "multipart/form-data",
        },
        signal,
    });

    return data.text;
};

export const askGpt = async (
    prompt: string,
    apiKey: string,
    systemPrompt = "You are a helpful assistant.",
    signal?: AbortSignal
): Promise<string> => {
    const { data } = await axios.post(
        `${OPENAI_BASE_URL}/chat/completions`,
        {
            model: MODELS.GPT,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt },
            ],
        },
        {
            headers: {
                ...getAuthHeaders(apiKey),
                "Content-Type": "application/json",
            },
            signal,
        }
);

    return data.choices?.[0]?.message?.content?.trim() || "";
};

export const speakText = async (text: string, apiKey: string): Promise<Blob> => {
    const { data } = await axios.post(
        `${OPENAI_BASE_URL}/audio/speech`,
        {
            model: MODELS.TTS,
            input: text,
            voice: VOICE,
        },
        {
            headers: {
                ...getAuthHeaders(apiKey),
                "Content-Type": "application/json",
            },
            responseType: "blob",
        }
);
    return data;
};