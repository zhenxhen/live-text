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
    const [lectureNotes, setLectureNotes] = useState<string>('');
    const [isGeneratingNotes, setIsGeneratingNotes] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    
    const transcriptionContainerRef = useRef<HTMLDivElement>(null);
    const notesContainerRef = useRef<HTMLDivElement>(null);
    const currentTranscriptionRef = useRef<string>('');

    const aiRef = useRef<GoogleGenAI | null>(null);
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

        aiRef.current = null;
        
        setStatus(TranscriptionStatus.IDLE);
    }, []);

    const generateNotes = async (transcriptChunk: string) => {
        if (!aiRef.current) return;
        setIsGeneratingNotes(true);
        try {
            const prompt = `You are an expert note-taker. Take the following transcription from a lecture and summarize it into clean, organized, and structured lecture notes in markdown format. Focus on key points, concepts, and action items. Do not add any introductory text like "Here are the notes:". Just provide the markdown. Here is the transcript:\n\n"${transcriptChunk}"`;
    
            const response = await aiRef.current.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
    
            const notesChunk = response.text;
            setLectureNotes(prev => (prev + notesChunk + '\n\n').trim());
    
        } catch (err) {
            console.error("Error generating notes:", err);
            // Optionally set an error state for the notes panel
        } finally {
            setIsGeneratingNotes(false);
        }
    };
    
    const handleMessage = (message: LiveServerMessage) => {
        if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            currentTranscriptionRef.current += text;
            setTranscription(prev => prev + text);
        }

        if (message.serverContent?.turnComplete) {
            const textToSummarize = currentTranscriptionRef.current.trim();
            if (textToSummarize) {
                generateNotes(textToSummarize);
            }
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
        setLectureNotes('');
        currentTranscriptionRef.current = '';

        try {
            // Safely check for API Key without crashing the browser
            const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;

            if (!apiKey) {
                // If running on a static host like GitHub pages, process.env won't exist.
                // Inform the user gracefully instead of crashing.
                setError("API 키가 환경에 설정되지 않았습니다. GitHub Pages와 같은 정적 환경에서는 API 키를 별도로 설정해야 합니다.");
                setStatus(TranscriptionStatus.ERROR);
                return;
            }
            
            aiRef.current = new GoogleGenAI({ apiKey: apiKey });
            
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

            sessionPromiseRef.current = aiRef.current.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        setStatus(TranscriptionStatus.RECORDING);
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
    }, [stopTranscription]);

    // Auto-scroll logic
    useEffect(() => {
        if (transcriptionContainerRef.current) {
            transcriptionContainerRef.current.scrollTop = transcriptionContainerRef.current.scrollHeight;
        }
    }, [transcription]);
    
    useEffect(() => {
        if (notesContainerRef.current) {
            notesContainerRef.current.scrollTop = notesContainerRef.current.scrollHeight;
        }
    }, [lectureNotes]);


    const getStatusText = () => {
        switch (status) {
            case TranscriptionStatus.CONNECTING: return "Connecting to Gemini...";
            case TranscriptionStatus.RECORDING: return "Listening... Speak into your microphone.";
            case TranscriptionStatus.STOPPING: return "Stopping...";
            case TranscriptionStatus.ERROR: return "An error occurred. See message below.";
            default: return "Click the button to start live transcription and note-taking.";
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
                ${(isConnecting || status === TranscriptionStatus.STOPPING || status === TranscriptionStatus.ERROR) ? 'bg-gray-500 cursor-not-allowed' : ''}
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
                    Live Transcription & Notes
                </h1>
                <p className="text-gray-400 mt-1">Powered by Gemini</p>
            </header>
            
            <main className="flex-grow flex flex-col md:flex-row gap-4 overflow-hidden">
                {/* Left Panel: Transcription */}
                <section className="w-full md:w-1/2 flex flex-col">
                    <h2 className="text-xl font-semibold mb-2 text-center text-gray-300">Transcription</h2>
                    <div 
                        ref={transcriptionContainerRef}
                        className="flex-grow bg-gray-800/50 rounded-lg p-6 overflow-y-auto border border-gray-700 shadow-inner"
                    >
                        {transcription ? (
                            <p className="text-lg whitespace-pre-wrap leading-relaxed">
                                {transcription}
                            </p>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-gray-500 text-lg">Your transcribed text will appear here...</p>
                            </div>
                        )}
                    </div>
                </section>

                {/* Right Panel: Lecture Notes */}
                <section className="w-full md:w-1/2 flex flex-col">
                    <h2 className="text-xl font-semibold mb-2 text-center text-gray-300">Lecture Notes</h2>
                    <div 
                        ref={notesContainerRef}
                        className="relative flex-grow bg-gray-800/50 rounded-lg p-6 overflow-y-auto border border-gray-700 shadow-inner"
                    >
                        {lectureNotes ? (
                             <p className="text-lg whitespace-pre-wrap leading-relaxed">
                                {lectureNotes}
                            </p>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-gray-500 text-lg">Generated notes will appear here...</p>
                            </div>
                        )}
                         {isGeneratingNotes && !lectureNotes && (
                            <div className="absolute inset-0 bg-gray-900/30 flex items-center justify-center rounded-lg">
                                <SpinnerIcon className="w-10 h-10 text-white animate-spin" />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            
            <footer className="flex flex-col items-center justify-center pt-6 text-center">
                <ControlButton />
                <p className={`mt-4 h-6 transition-opacity duration-300 text-sm ${error ? 'text-red-400' : 'text-gray-400'}`}>
                    {error || getStatusText()}
                </p>
            </footer>
        </div>
    );
};

export default App;