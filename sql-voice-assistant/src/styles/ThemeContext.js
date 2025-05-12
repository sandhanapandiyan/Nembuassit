import React, { createContext, useContext } from 'react';
import './theme.css';

const ThemeContext = createContext();

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  const theme = {
    primary: '#FF6B9E',
    primaryDark: '#E0558A',
    success: '#4CAF50',
    warning: '#FF9800',
    error: '#F44336',
    background: '#FFF5F9',
    cardBg: '#FFFFFF',
    text: '#333333',
    textLight: '#777777',
    border: '#FFD6E5',
    userBubble: '#FF6B9E',
    botBubble: '#FFEEF5',
    voiceBtn: '#FF6B9E',
  };

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}
