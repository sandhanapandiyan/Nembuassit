import React from 'react';
import './App.css';
import ChatMessages from './components/ChatMessages';
import VoiceControls from './components/VoiceControls';
import { ThemeProvider } from './styles/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <div className="App">
        <header className="header">
          <h1>SQL Voice Assistant</h1>
          <VoiceControls />
        </header>
        <div className="container">
          <ChatMessages />
        </div>
      </div>
    </ThemeProvider>
  );
}

export default App;
