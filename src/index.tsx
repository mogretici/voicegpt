import React, { useState, useEffect, useRef, ReactNode } from 'react';

export interface VoiceGPTChildrenRenderProps {
    recording: boolean;
    question: string;
    response: string;
    startInteraction: () => void;
    stopInteraction: () => void;
    isLoading: boolean;
    onError: (err: Error) => void;
}

export interface VoiceGPTProps {
    apiKey: string;
    systemPrompt?: string;
    silenceThreshold?: number;
    silenceTimeout?: number;
    minSpeechDuration?: number;
    debugMode?: boolean;
    gptModel?: string;
    whisperModel?: string;
    ttsModel?: string;
    ttsVoice?: string;
    greetingMessage?: string;
    onError?: (err: Error) => void;
    children: (props: VoiceGPTChildrenRenderProps) => ReactNode;
}
const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const VoiceGPT: React.FC<VoiceGPTProps> = ({
                                                      apiKey,
                                                      systemPrompt = "You are a helpful assistant.",
                                                      silenceThreshold = -25,
                                                      silenceTimeout = 1500,
                                                      minSpeechDuration = 500,
                                                      debugMode = false,
                                                      gptModel = "gpt-3.5-turbo",
                                                      whisperModel = "whisper-1",
                                                      ttsModel = "tts-1",
                                                      ttsVoice = "nova",
                                                      greetingMessage = "Hello, how can I help you?",
                                                      onError,
                                                      children,
                                                  })=> {
    const [recording, setRecording] = useState(false);
    const [question, setQuestion] = useState("");
    const [response, setResponse] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [conversationHistory, setConversationHistory] = useState<Array<{ role: string; content: string }>>([
        { role: "system", content: systemPrompt }
    ]);
    const recordingRef = useRef(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioElementRef = useRef<HTMLAudioElement | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const microphoneStreamRef = useRef<MediaStream | null>(null);
    const silenceStartTimeRef = useRef<number | null>(null);
    const speechStartTimeRef = useRef<number | null>(null);
    const silenceDetectionIntervalRef = useRef<number | null>(null);
    const speechInProgressRef = useRef<boolean>(false);
    const processingAudioRef = useRef<boolean>(false);
    const hasSpokenRef = useRef<boolean>(false);

    const logDebug = (message: string) => {
        if (debugMode) {
            console.log(`[VoiceGPT Debug]: ${message}`);
        }
    };

    useEffect(() => {
        audioElementRef.current = new Audio();

        audioElementRef.current.addEventListener('play', () => {
            speechInProgressRef.current = true;
            logDebug("The assistant started speaking");
        });

        audioElementRef.current.addEventListener('ended', () => {
            speechInProgressRef.current = false;
            logDebug("The assistant finished speaking");
        });

        audioElementRef.current.addEventListener('pause', () => {
            speechInProgressRef.current = false;
            logDebug("The assistant paused speaking");
        });

        return () => {
            cleanupResources();
        };
    }, []);

    const cleanupResources = () => {
        if (audioElementRef.current) {
            audioElementRef.current.pause();
            audioElementRef.current = null;
        }

        stopSilenceDetection();
        stopRecording();

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        analyserRef.current = null;

        if (microphoneStreamRef.current) {
            microphoneStreamRef.current.getTracks().forEach(track => track.stop());
            microphoneStreamRef.current = null;
        }
    };

    const handleError = (error: Error) => {
        if (onError) {
            onError(error);
        } else {
            console.error("VoiceGPT Error:", error);
        }
        setIsLoading(false);
    };

    const getAudioLevel = (): number => {
        const analyser = analyserRef.current;
        if (!analyser) return -100;
        const bufferLength = analyser.fftSize;
        const data = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < bufferLength; i++) {
            const x = (data[i] - 128) / 128;
            sumSq += x * x;
        }
        const rms = Math.sqrt(sumSq / bufferLength);
        const db = 20 * Math.log10(rms);
        return isFinite(db) ? db : -100;
    };

    const startSilenceDetection = () => {
        if (silenceDetectionIntervalRef.current) {
            stopSilenceDetection();
        }

        silenceStartTimeRef.current = null;
        speechStartTimeRef.current = null;
        hasSpokenRef.current = false;

        silenceDetectionIntervalRef.current = window.setInterval(async () => {
            if (processingAudioRef.current) return;

            const audioLevel = getAudioLevel();

            if (debugMode) {
                if (Date.now() % 200 < 100) {
                    logDebug(`[VoiceGPT] audio dB: ${audioLevel.toFixed(2)} dB`);
                }
            }

            if (audioLevel > silenceThreshold) {
                if (speechStartTimeRef.current === null) {
                    speechStartTimeRef.current = Date.now();
                    logDebug("Conversation started");
                }

                hasSpokenRef.current = true;

                silenceStartTimeRef.current = null;
            }
            else {
                if (silenceStartTimeRef.current === null) {
                    silenceStartTimeRef.current = Date.now();
                }

                const hasMinimumSpeech = speechStartTimeRef.current !== null &&
                    (Date.now() - speechStartTimeRef.current > minSpeechDuration);

                const hasSilenceDuration = silenceStartTimeRef.current !== null &&
                    (Date.now() - silenceStartTimeRef.current > silenceTimeout);

                if (hasSpokenRef.current && hasMinimumSpeech && hasSilenceDuration) {
                    logDebug(`The conversation is over. Talk time: ${speechStartTimeRef.current ? (Date.now() - speechStartTimeRef.current) : 0}ms, Silence duration: ${silenceStartTimeRef.current ? (Date.now() - silenceStartTimeRef.current) : 0}ms`);
                    processingAudioRef.current = true;
                    await processAudioAndGetResponse();
                }
            }

            if (speechInProgressRef.current && audioLevel > silenceThreshold) {
                logDebug("Barge-in: user speaks, assistant interrupts and starts recording");

                if (audioElementRef.current) {
                    audioElementRef.current.pause();
                    audioElementRef.current.currentTime = 0;
                }
                speechInProgressRef.current = false;

                stopSilenceDetection();

                audioChunksRef.current = [];

                processingAudioRef.current = false;
                await startRecording();

                return;
            }
        }, 100);
    };

    const stopSilenceDetection = () => {
        if (silenceDetectionIntervalRef.current) {
            clearInterval(silenceDetectionIntervalRef.current);
            silenceDetectionIntervalRef.current = null;
        }
        silenceStartTimeRef.current = null;
        speechStartTimeRef.current = null;
    };

    const startRecording = async () => {
        try {
            if (recording) return;

            processingAudioRef.current = false;
            setIsLoading(false);

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            microphoneStreamRef.current = stream;

            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContext();
            }

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 512;
            analyserRef.current.smoothingTimeConstant = 0;
            analyserRef.current.minDecibels = -90;
            analyserRef.current.maxDecibels = -10

            const source = audioContextRef.current.createMediaStreamSource(stream);
            source.connect(analyserRef.current);

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstart = () => {
                setRecording(true);
                recordingRef.current = true;
                logDebug("Recording has started");
                startSilenceDetection();
            };

            mediaRecorder.onstop = () => {
                setRecording(false);
                recordingRef.current = false;
                stopSilenceDetection();
                logDebug("Recording has stopped");

                if (microphoneStreamRef.current) {
                    microphoneStreamRef.current.getTracks().forEach(track => track.stop());
                }
            };

            mediaRecorder.start();
        } catch (error) {
            handleError(error as Error);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        stopSilenceDetection();
    };

    const processAudioAndGetResponse = async () => {
        setIsLoading(true);
        processingAudioRef.current = true;

        stopRecording();

        await new Promise(res => setTimeout(res, 100));

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        logDebug(`The resulting blob size is: ${(audioBlob.size/1024).toFixed(2)} KB`);

        if (audioBlob.size < 5000) {
            logDebug("The audio blob is too small, skipping processing");
            processingAudioRef.current = false;
            setIsLoading(false);
            await startRecording();
            return;
        }

        try {
            const transcription = await transcribeAudio(audioBlob);
            setQuestion(transcription);

            const updated = [...conversationHistory, { role: "user", content: transcription }];
            setConversationHistory(updated);
            const gpt = await getGPTResponse(updated);
            setResponse(gpt);
            setConversationHistory([...updated, { role: "assistant", content: gpt }]);

            processingAudioRef.current = false;
           await startRecording();

            await textToSpeech(gpt);
            logDebug("TTS is over, listening continues.");
        } catch (err) {
            handleError(err as Error);
            processingAudioRef.current = false;
            await startRecording();
        } finally {
            setIsLoading(false);
        }
    };

    const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
        const formData = new FormData();
        formData.append("file", audioBlob, "audio.webm");
        formData.append("model", whisperModel);

        const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Transcription failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return data.text;
    };

    const getGPTResponse = async (messages: Array<{ role: string; content: string }>): Promise<string> => {
        const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: gptModel,
                messages: messages
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GPT response failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    };

    const textToSpeech = async (text: string): Promise<void> => {
        return new Promise(async (resolve, reject) => {
            try {
                const response = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: ttsModel,
                        input: text,
                        voice: ttsVoice,
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Speech synthesis failed: ${response.status} ${response.statusText} - ${errorText}`);
                }

                const audioBlob = await response.blob();
                const audioUrl = URL.createObjectURL(audioBlob);

                if (audioElementRef.current) {
                    startSilenceDetection();
                    audioElementRef.current.src = audioUrl;
                    audioElementRef.current.onended = () => {
                        speechInProgressRef.current = false;
                        resolve();
                    };
                    audioElementRef.current.onerror = (e) => {
                        speechInProgressRef.current = false;
                        logDebug(`Audio playback error: ${e}`);
                        reject(new Error("Audio playback error",));
                    };

                    audioElementRef.current.play().catch(err => {
                        speechInProgressRef.current = false;
                        reject(err);
                    });
                } else {
                    reject(new Error("Audio element not initialized"));
                }
            } catch (error) {
                speechInProgressRef.current = false;
                reject(error);
            }
        });
    };

    const startInteraction = async () => {
        if (recording || processingAudioRef.current) {
            stopInteraction();
        } else {
            if (conversationHistory.length === 1) {
                setResponse(greetingMessage);
                await textToSpeech(greetingMessage).catch(err => {
                    logDebug(`Error while voicing welcome message: ${err.message}`);
                });
            }
            await startRecording();
        }
    };

    const stopInteraction = () => {
        stopRecording();
        if (audioElementRef.current) {
            audioElementRef.current.pause();
            audioElementRef.current.currentTime = 0;
            speechInProgressRef.current = false;
        }
        processingAudioRef.current = false;
    };

    const handleCustomError = (err: Error) => {
        if (onError) {
            onError(err);
        } else {
            console.error("VoiceGPT Error:", err);
        }
    };

    return (
        <>
            {children({
                recording,
                question,
                response,
                startInteraction,
                stopInteraction,
                isLoading,
                onError: handleCustomError
            })}
        </>
    );
};

export function useVoiceGPT(props: Omit<VoiceGPTProps, 'children'>) {
    const [recording, setRecording] = useState(false);
    const [question, setQuestion] = useState("");
    const [response, setResponse] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const voiceGPTRef = useRef<{
        startInteraction: () => void;
        stopInteraction: () => void;
        onError: (err: Error) => void;
    } | null>(null);

    const renderProp = (renderProps: VoiceGPTChildrenRenderProps) => {
        setRecording(renderProps.recording);
        setQuestion(renderProps.question);
        setResponse(renderProps.response);
        setIsLoading(renderProps.isLoading);

        voiceGPTRef.current = {
            startInteraction: renderProps.startInteraction,
            stopInteraction: renderProps.stopInteraction,
            onError: renderProps.onError
        };

        return null;
    };

    const startInteraction = () => {
        if (voiceGPTRef.current) {
            voiceGPTRef.current.startInteraction();
        }
    };

    const stopInteraction = () => {
        if (voiceGPTRef.current) {
            voiceGPTRef.current.stopInteraction();
        }
    };

    const handleError = (err: Error) => {
        if (voiceGPTRef.current) {
            voiceGPTRef.current.onError(err);
        }
    };

    return {
        VoiceGPTInstance: (
            <VoiceGPT {...props} children={renderProp} />
        ),
        recording,
        question,
        response,
        isLoading,
        startInteraction,
        stopInteraction,
        onError: handleError
    };
}

export default VoiceGPT;