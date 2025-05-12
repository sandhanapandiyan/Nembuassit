import React, { useState, useEffect } from 'react';
import '../styles/VoiceControls.css';

function VoiceControls({ onTranscript }) {
  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [recognition, setRecognition] = useState(null);
  const [synth, setSynth] = useState(window.speechSynthesis);
  const [femaleVoice, setFemaleVoice] = useState(null);

  useEffect(() => {
    // Initialize speech recognition
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognitionInstance = new SpeechRecognition();
      recognitionInstance.continuous = false;
      recognitionInstance.interimResults = false;
      recognitionInstance.lang = 'en-US';

      recognitionInstance.onstart = () => {
        setIsListening(true);
      };

      recognitionInstance.onend = () => {
        setIsListening(false);
      };

      recognitionInstance.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (onTranscript) {
          onTranscript(transcript);
        }
        speakResponse("Got it!");
      };      recognitionInstance.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
        let errorMessage = "Oops! I didn't catch that. Could you try again?";
        
        switch(event.error) {
          case 'not-allowed':
          case 'permission-denied':
            errorMessage = "I need permission to use your microphone. Please enable it in your browser settings.";
            break;
          case 'no-speech':
            errorMessage = "I didn't hear anything. Please speak again.";
            break;
          case 'network':
            errorMessage = "There seems to be a network issue. Please check your connection.";
            break;
          case 'audio-capture':
            errorMessage = "I can't detect a microphone. Please make sure one is connected.";
            break;
        }
        
        speakResponse(errorMessage);
      };

      setRecognition(recognitionInstance);
    }

    // Initialize voices
    loadVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices;
    }
  }, [onTranscript]);

  const loadVoices = () => {
    const voices = synth.getVoices();
    // Prefer younger female voices
    const voice = voices.find(v => 
      (v.name.includes('Female') || 
       v.name.includes('Woman') || 
       v.name.includes('Zira') || 
       v.name.includes('Tessa') || 
       v.name.includes('Karen') ||
       v.name.includes('Samantha')) &&
      !v.name.includes('Old') &&
      !v.name.includes('Senior')
    ) || voices[0];
    
    setFemaleVoice(voice);
  };

  const toggleVoice = () => {
    setVoiceEnabled(!voiceEnabled);
    if (!voiceEnabled) {
      speakResponse("Voice enabled!");
    } else {
      synth.cancel();
    }
  };

  const handleVoiceClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const startListening = () => {
    if (recognition && !isListening) {
      try {
        recognition.start();
        speakResponse("I'm listening...");
      } catch (error) {
        console.error('Speech recognition error:', error);
        speakResponse("I can't access the microphone. Please check permissions.");
      }
    }
  };

  const stopListening = () => {
    if (recognition && isListening) {
      recognition.stop();
    }
  };

  const speakResponse = (text) => {
    if (!voiceEnabled || !synth) return;
    
    if (synth.speaking) {
      synth.cancel();
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1.3;
    utterance.volume = 1;
    
    if (femaleVoice) {
      utterance.voice = femaleVoice;
    }
    
    if (text.includes('?')) {
      utterance.rate = 1.0;
      utterance.pitch = 1.4;
    } else if (text.includes('!') || text.includes('Okay')) {
      utterance.rate = 1.2;
      utterance.pitch = 1.5;
    }
    
    synth.speak(utterance);
  };
  return (
    <div className="voice-controls">
      <button
        className={`voice-btn ${isListening ? 'listening' : ''}`}
        onClick={handleVoiceClick}
        title={isListening ? 'Stop listening' : 'Click to speak'}
        aria-label={isListening ? 'Stop listening' : 'Click to speak'}
      >
        <div className="voice-icon-wrapper">
          {isListening ? (
            <svg className="microphone-icon active" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 15c2.21 0 4-1.79 4-4V6c0-2.21-1.79-4-4-4S8 3.79 8 6v5c0 2.21 1.79 4 4 4z"/>
              <path d="M19 11h-2c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92z"/>
            </svg>
          ) : (
            <svg className="microphone-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 15c2.21 0 4-1.79 4-4V6c0-2.21-1.79-4-4-4S8 3.79 8 6v5c0 2.21 1.79 4 4 4z"/>
              <path d="M19 11h-2c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92z"/>
            </svg>
          )}
          {isListening && (
            <div className="voice-wave">
              <div className="voice-wave-bar"></div>
              <div className="voice-wave-bar"></div>
              <div className="voice-wave-bar"></div>
              <div className="voice-wave-bar"></div>
              <div className="voice-wave-bar"></div>
            </div>
          )}
        </div>
      </button>
      {isListening && (
        <div className="voice-feedback">
          <div className="voice-status">Listening... Speak now</div>
          <div className="voice-tip">Click again to stop</div>
        </div>
      )}
    </div>
  );
}

export default VoiceControls;