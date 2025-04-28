import React, { useState, useEffect, useRef, ReactNode } from 'react';

// Types and interfaces
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
    onError?: (err: Error) => void;
    children: (props: VoiceGPTChildrenRenderProps) => ReactNode;
}
// Constants
const OPENAI_BASE_URL = "https://api.openai.com/v1";

// Main component
export const VoiceGPT: React.FC<VoiceGPTProps> = ({
                                                      apiKey,
                                                      systemPrompt = "Sen yardımcı bir asistansın.",
                                                      silenceThreshold = -25,
                                                      silenceTimeout = 1500,
                                                      minSpeechDuration = 500,
                                                      debugMode = false,
                                                      gptModel = "gpt-3.5-turbo",
                                                      whisperModel = "whisper-1",
                                                      ttsModel = "tts-1",
                                                      ttsVoice = "nova",
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
            console.log(`[VoiceGPT Debug] ${message}`);
        }
    };

    useEffect(() => {
        audioElementRef.current = new Audio();

        // AudioContext için dinleyici ekleme
        audioElementRef.current.addEventListener('play', () => {
            speechInProgressRef.current = true;
            logDebug("Asistan konuşmaya başladı");
        });

        audioElementRef.current.addEventListener('ended', () => {
            speechInProgressRef.current = false;
            logDebug("Asistan konuşması bitti");
        });

        audioElementRef.current.addEventListener('pause', () => {
            speechInProgressRef.current = false;
            logDebug("Asistan konuşması duraklatıldı");
        });

        return () => {
            cleanupResources();
        };
    }, []);

    const cleanupResources = () => {
        // Tüm kaynakları temizle
        if (audioElementRef.current) {
            audioElementRef.current.pause();
            audioElementRef.current = null;
        }

        stopSilenceDetection();
        stopRecording();

        // AudioContext ve ilişkili kaynakları temizle
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        analyserRef.current = null;

        // Mikrofon akışını kapat
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

    // Ses seviyesi algılama için yardımcı fonksiyon
    const getAudioLevel = (): number => {
        const analyser = analyserRef.current;
        if (!analyser) return -100;
        const bufferLength = analyser.fftSize;
        const data = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(data);
        // normalize ve RMS
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

        // Başlangıç değerlerini sıfırla
        silenceStartTimeRef.current = null;
        speechStartTimeRef.current = null;
        hasSpokenRef.current = false;

        silenceDetectionIntervalRef.current = window.setInterval(async () => {
            if (processingAudioRef.current) return;

            const audioLevel = getAudioLevel();

            if (debugMode) {
                // Her zaman değil, ama belirli aralıklarla ses düzeyini logla
                if (Date.now() % 200 < 100) {
                    logDebug(`[VoiceGPT] audio dB: ${audioLevel.toFixed(2)} dB`);
                }
            }

            // Ses düzeyi eşiğin üstündeyse (konuşma var)
            if (audioLevel > silenceThreshold) {
                // Konuşma başlangıç zamanını kaydet
                if (speechStartTimeRef.current === null) {
                    speechStartTimeRef.current = Date.now();
                    logDebug("Konuşma başladı");
                }

                // Konuşma algılandı işareti
                hasSpokenRef.current = true;

                // Sessizlik süresini sıfırla
                silenceStartTimeRef.current = null;
            }
            // Ses düzeyi eşiğin altındaysa (sessizlik var)
            else {
                // İlk kez sessizlik algılandıysa başlangıç zamanını kaydet
                if (silenceStartTimeRef.current === null) {
                    silenceStartTimeRef.current = Date.now();
                }

                // Yeterli konuşma olmuş ve ardından belirlenen süreden uzun sessizlik varsa kaydı durdur
                const hasMinimumSpeech = speechStartTimeRef.current !== null &&
                    (Date.now() - speechStartTimeRef.current > minSpeechDuration);

                const hasSilenceDuration = silenceStartTimeRef.current !== null &&
                    (Date.now() - silenceStartTimeRef.current > silenceTimeout);

                if (hasSpokenRef.current && hasMinimumSpeech && hasSilenceDuration) {
                    logDebug(`Konuşma bitti. Konuşma süresi: ${speechStartTimeRef.current ? (Date.now() - speechStartTimeRef.current) : 0}ms, Sessizlik süresi: ${silenceStartTimeRef.current ? (Date.now() - silenceStartTimeRef.current) : 0}ms`);
                    processingAudioRef.current = true;
                    await processAudioAndGetResponse();
                }
            }

            // Konuşma devam ederken kullanıcı konuşmaya başlarsa
            if (speechInProgressRef.current && audioLevel > silenceThreshold) {
                logDebug("Barge-in: kullanıcı konuşuyor, asistan kesiliyor ve kayıt başlatılıyor");

                // 1) TTS’i durdur
                if (audioElementRef.current) {
                    audioElementRef.current.pause();
                    audioElementRef.current.currentTime = 0;
                }
                speechInProgressRef.current = false;

                // 2) Mevcut algılamayı durdur
                stopSilenceDetection();

                // 3) Önceki audioChunks’u temizle (tercihe bağlı)
                audioChunksRef.current = [];

                // 4) Yeni konuşma kaydını başlat
                processingAudioRef.current = false;
                await startRecording();

                // 5) Bu döngü iterasyonunu sonlandır
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

            // AudioContext ve Analyser oluştur
            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContext();
            }

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 512; // Daha hassas frekans analizi için
            analyserRef.current.smoothingTimeConstant = 0; // Daha yumuşak geçişler
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
                recordingRef.current = true;      // ref’i de güncelle
                logDebug("Kayıt başladı");
                startSilenceDetection();
            };

            mediaRecorder.onstop = () => {
                setRecording(false);
                recordingRef.current = false;
                stopSilenceDetection();
                logDebug("Kayıt durduruldu");

                // Mikrofon akışını durdur
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

        // 1) Önce recorder’ı durdur, bu ondataavailable tetikler:
        stopRecording();

        // 2) Kısa bir gecikme ver (ondataavailable’ın gelmesi için)
        await new Promise(res => setTimeout(res, 100));

        // 3) Blob’u oluştur:
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = []; // temizle

        logDebug(`Oluşan blob boyutu: ${(audioBlob.size/1024).toFixed(2)} KB`);

        // 4) Eğer blob çok küçükse, yeniden dinlemeye başla:
        if (audioBlob.size < 5000) {  // ~5 KB eşik
            logDebug("Çok kısa kayıt, yeniden dinleniyor");
            processingAudioRef.current = false;
            setIsLoading(false);
            await startRecording();
            return;
        }

        try {
            // 5) Transkripsiyon
            const transcription = await transcribeAudio(audioBlob);
            setQuestion(transcription);

            // 6) GPT cevabı
            const updated = [...conversationHistory, { role: "user", content: transcription }];
            setConversationHistory(updated);
            const gpt = await getGPTResponse(updated);
            setResponse(gpt);
            setConversationHistory([...updated, { role: "assistant", content: gpt }]);

            // 7) Barge-in için mikrofonu hemen aç
            processingAudioRef.current = false;
           await startRecording();

            // 8) TTS
            await textToSpeech(gpt);
            logDebug("TTS bitti, dinlemeye devam ediliyor");
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
                    // Configure audio element
                    audioElementRef.current.src = audioUrl;
                    audioElementRef.current.onended = () => {
                        speechInProgressRef.current = false;
                        resolve();
                    };
                    audioElementRef.current.onerror = (e) => {
                        speechInProgressRef.current = false;
                        console.log("Ses dosyası yüklenirken hata:", e);
                        reject(new Error("Audio playback error",));
                    };

                    // Start playback
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
            // Add greeting if it's the first interaction
            if (conversationHistory.length === 1) { // Only system prompt exists
                const greeting = "Merhaba, nasıl yardımcı olabilirim?";
                setResponse(greeting);
                await textToSpeech(greeting).catch(err => {
                    logDebug(`Karşılama mesajı seslendirilirken hata: ${err.message}`);
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

// Export a hook to use the VoiceGPT component
export function useVoiceGPT(props: Omit<VoiceGPTProps, 'children'>) {
    const [recording, setRecording] = useState(false);
    const [question, setQuestion] = useState("");
    const [response, setResponse] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Create a ref to a VoiceGPT instance's methods
    const voiceGPTRef = useRef<{
        startInteraction: () => void;
        stopInteraction: () => void;
        onError: (err: Error) => void;
    } | null>(null);

    // Render prop that will receive the VoiceGPT instance's methods
    const renderProp = (renderProps: VoiceGPTChildrenRenderProps) => {
        // Update local state to match the VoiceGPT instance's state
        setRecording(renderProps.recording);
        setQuestion(renderProps.question);
        setResponse(renderProps.response);
        setIsLoading(renderProps.isLoading);

        // Store the VoiceGPT instance's methods in the ref
        voiceGPTRef.current = {
            startInteraction: renderProps.startInteraction,
            stopInteraction: renderProps.stopInteraction,
            onError: renderProps.onError
        };

        // Return null since we don't want to render anything here
        return null;
    };

    // Methods to expose to consumers of the hook
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
        // VoiceGPT instance to render (hidden)
        VoiceGPTInstance: (
            <VoiceGPT {...props} children={renderProp} />
        ),
        // State and methods to expose
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