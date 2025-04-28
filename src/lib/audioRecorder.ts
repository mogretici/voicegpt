//audioRecorder.ts

let audioChunks: Blob[] = [];
let silenceTimer: NodeJS.Timeout | null = null;

export const startSmartRecording = async (
    onSilence: () => void,
    silenceDuration = 1500
): Promise<MediaRecorder> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkSilence = () => {
        analyser.getByteFrequencyData(dataArray);
        const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;

        if (volume < 5) {
            if (!silenceTimer) {
                silenceTimer = setTimeout(() => {
                    onSilence();
                    mediaRecorder.stop();
                }, silenceDuration);
            }
        } else {
            if (silenceTimer) {
                clearTimeout(silenceTimer);
                silenceTimer = null;
            }
        }

        requestAnimationFrame(checkSilence);
    };

    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            audioChunks.push(e.data);
        }
    };

    mediaRecorder.start();
    checkSilence();
    return mediaRecorder;
};

export const stopRecording = async (recorder: MediaRecorder | null): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (!recorder) return reject("Kayıt başlatılmamış.");
        recorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
            resolve(audioBlob);
        };
        recorder.stop();
    });
};
