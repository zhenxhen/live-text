import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, Blob } from '@google/genai';
import { TranscriptionStatus } from './types';
import { MicrophoneIcon, StopIcon, SpinnerIcon } from './components/Icons';

// Audio processing constants
const INPUT_SAMPLE_RATE = 16000;
const SCRIPT_PROCESSOR_BUFFER_SIZE = 4096;

// Base64 encoding utility
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// PCM audio data to Blob utility
function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
    };
}


const App: React.FC = () => {
    const [status, setStatus] = useState<TranscriptionStatus>(TranscriptionStatus.IDLE);
    const [transcription, setTranscription] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    
    const transcriptionContainerRef = useRef<HTMLDivElement>(null);
    const currentTranscriptionRef = useRef<string>('');

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

    const stopTranscription = useCallback(() => {
        setStatus(TranscriptionStatus.STOPPING);
        
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session?.close());
            sessionPromiseRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        if (currentTranscriptionRef.current) {
            setTranscription(prev => (prev + currentTranscriptionRef.current).trim());
            currentTranscriptionRef.current = '';
        }
        
        setStatus(TranscriptionStatus.IDLE);
    }, []);
    
    const handleMessage = (message: LiveServerMessage) => {
        if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            currentTranscriptionRef.current += text;
            // Live update for responsiveness
            setTranscription(prev => prev + text);
        }

        if (message.serverContent?.turnComplete) {
            setTranscription(prev => prev.trim() + '\n\n');
            currentTranscriptionRef.current = '';
        }
    };

    const handleError = (e: Error | ErrorEvent) => {
        console.error(e);
        const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
        setError(`Error: ${errorMessage}. Please try again.`);
        stopTranscription();
    };

    const startTranscription = async () => {
        setStatus(TranscriptionStatus.CONNECTING);
        setError(null);
        setTranscription('');
        currentTranscriptionRef.current = '';

        try {
            if (!process.env.API_KEY) {
                throw new Error("API_KEY environment variable not set.");
            }
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        setStatus(TranscriptionStatus.RECORDING);
                        // FIX: Cast window to any to support webkitAudioContext for older browsers without TypeScript errors.
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
                        const source = audioContextRef.current.createMediaStreamSource(streamRef.current!);
                        scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_SIZE, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then(session => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        
                        source.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(audioContextRef.current.destination);
                    },
                    onmessage: handleMessage,
                    onerror: handleError,
                    onclose: () => {
                        if(status !== TranscriptionStatus.STOPPING && status !== TranscriptionStatus.IDLE) {
                            stopTranscription();
                        }
                    },
                },
                config: {
                    inputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO], // Required even if not using audio output
                },
            });
            
            await sessionPromiseRef.current;

        } catch (err) {
            handleError(err as Error);
        }
    };
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopTranscription();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-scroll logic
    useEffect(() => {
        if (transcriptionContainerRef.current) {
            transcriptionContainerRef.current.scrollTop = transcriptionContainerRef.current.scrollHeight;
        }
    }, [transcription]);

    const getStatusText = () => {
        switch (status) {
            case TranscriptionStatus.CONNECTING: return "Connecting to Gemini...";
            case TranscriptionStatus.RECORDING: return "Listening... Speak into your microphone.";
            case TranscriptionStatus.STOPPING: return "Stopping transcription...";
            case TranscriptionStatus.ERROR: return "An error occurred.";
            default: return "Click the button to start live transcription.";
        }
    };

    const ControlButton = () => {
        const isRecording = status === TranscriptionStatus.RECORDING;
        const isConnecting = status === TranscriptionStatus.CONNECTING;

        return (
            <button
                onClick={isRecording ? stopTranscription : startTranscription}
                disabled={isConnecting || status === TranscriptionStatus.STOPPING}
                className={`relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-opacity-50
                ${
                  isRecording
                    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-400'
                    : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-400'
                }
                ${(isConnecting || status === TranscriptionStatus.STOPPING) ? 'bg-gray-500 cursor-not-allowed' : ''}
                shadow-lg transform hover:scale-105`}
            >
                {isConnecting && <SpinnerIcon className="w-10 h-10 text-white animate-spin" />}
                {!isConnecting && isRecording && <StopIcon className="w-8 h-8 text-white" />}
                {!isConnecting && !isRecording && <MicrophoneIcon className="w-10 h-10 text-white" />}
            </button>
        );
    };

    return (
        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans p-4 md:p-6">
            <header className="text-center mb-4">
                <h1 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    Real-time Audio Transcriber
                </h1>
                <p className="text-gray-400 mt-1">Powered by Gemini</p>
            </header>
            
            <div 
                ref={transcriptionContainerRef}
                className="flex-grow bg-gray-800/50 rounded-lg p-6 overflow-y-auto border border-gray-700 shadow-inner"
            >
                {transcription ? (
                    <p className="text-lg md:text-xl whitespace-pre-wrap leading-relaxed">
                        {transcription}
                    </p>
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-gray-500 text-lg">Your transcribed text will appear here...</p>
                    </div>
                )}
            </div>
            
            <footer className="flex flex-col items-center justify-center pt-6 text-center">
                <ControlButton />
                <p className={`mt-4 h-6 transition-opacity duration-300 ${status === TranscriptionStatus.IDLE && !error ? 'opacity-50' : 'opacity-100'}`}>
                    {error || getStatusText()}
                </p>
            </footer>
        </div>
    );
};

export default App;
