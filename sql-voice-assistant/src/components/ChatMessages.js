import React, { useState, useEffect, useRef } from 'react';
import '../styles/ChatMessages.css';
import VoiceControls from './VoiceControls'; // Import the VoiceControls component

function ChatMessages() {
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [lastQuery, setLastQuery] = useState(null);
  const [queryResult, setQueryResult] = useState(null);
  const [tableData, setTableData] = useState({ 
    data: [], 
    columns: [], 
    totalItems: 0,
    currentPage: 1
  });
  const [schema, setSchema] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const chatEndRef = useRef(null);
  const voiceControlsRef = useRef(null); // Add voice-related ref
  const [currentConversation, setCurrentConversation] = useState(null);
  const itemsPerPage = 5;

  // Add system check states
  const [systemChecks, setSystemChecks] = useState({
    database: false,
    voice: false,
    api: false
  });
  // Single initialization effect for all system checks and schema loading
  useEffect(() => {
    let mounted = true;
    const initializeApp = async () => {
      if (!mounted) return;
      setIsLoading(true);
      try {
        // Single schema fetch that also serves as database check
        const schemaResponse = await fetch('http://localhost:8000/schema');
        if (!mounted) return;
        
        const schemaData = await schemaResponse.json();
        if (schemaData.schema && mounted) {
          setSchema(schemaData.schema);
          setSystemChecks(prev => ({ ...prev, database: true }));
        }

        // Check API health
        const apiCheck = await fetch('http://localhost:8000/health');
        if (!mounted) return;
        
        if (apiCheck.ok) {
          setSystemChecks(prev => ({ ...prev, api: true }));
        }

        // Check voice capabilities
        if (window.speechSynthesis && mounted) {
          setSystemChecks(prev => ({ ...prev, voice: true }));
        }

        if (mounted) {
          setError(null);
          // Show greeting only after initialization
          const allChecksOk = window.speechSynthesis && apiCheck.ok && schemaData.schema;
          const greeting = allChecksOk 
            ? "Hello! I'm your SQL voice assistant. How can I help you today?" 
            : "I'm ready to help, though some features might be limited. What would you like to do?";
          speakMessage(greeting);
        }
      } catch (err) {
        if (!mounted) return;
        console.error('Initialization error:', err);
        setError('Failed to initialize the application. Please check the server connection.');
        setSystemChecks({
          database: false,
          voice: false,
          api: false
        });
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initializeApp();
    return () => {
      mounted = false;
    };
  }, []); // Only run once on mount
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Reset pagination and query result when new query is made
  useEffect(() => {
    setCurrentPage(1);
    setQueryResult(null);
  }, [lastQuery]);
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!userInput.trim() || isTyping) return;

    const userMessage = userInput.trim();
    setUserInput('');
    setMessages(prev => [...prev, { type: 'user', content: userMessage }]);
    setIsTyping(true);
    setLastQuery(userMessage);

    try {
      // Add a small delay for natural conversation flow
      await new Promise(resolve => setTimeout(resolve, 800));

      const response = await fetch('http://localhost:8000/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_query: userMessage,
          previous_context: currentConversation,
        }),
      });

      const data = await response.json();
      
      // Add another small delay for processing animation
      await new Promise(resolve => setTimeout(resolve, 400));
      
      setIsTyping(false);      if (data.status === 'success') {
        if (data.execution_result.type === 'SELECT') {
          // Store the complete result data
          setQueryResult(data.execution_result);
          setTableData(prev => ({
            ...prev,
            data: data.execution_result.data || [],
            columns: data.execution_result.columns || [],
            totalItems: data.execution_result.data ? data.execution_result.data.length : 0,
            currentPage: 1  // Reset to page 1 only for new queries
          }));
        }
        const formattedResponse = formatResponse(data);
        setMessages(prev => [...prev, {
          type: 'bot',
          content: formattedResponse,
        }]);

        // Speak the response if it's a simple message
        if (typeof formattedResponse === 'string' && voiceControlsRef.current) {
          voiceControlsRef.current.speakResponse(formattedResponse);
        }
      } else if (data.status === 'incomplete') {
        handleIncompleteQuery(data);
      } else {
        throw new Error(data.message || 'Query failed');
      }
    } catch (error) {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        type: 'bot',
        content: `Error: ${error.message}`,
      }]);
    }
  };
  // Update query state management
  useEffect(() => {
    if (queryResult && queryResult.type === 'SELECT') {
      setTableData(prev => ({
        ...prev,
        data: queryResult.data || [],
        columns: queryResult.columns || [],
        totalItems: queryResult.data ? queryResult.data.length : 0
      }));
      
      const formattedResponse = formatResponse({ execution_result: queryResult });
      setMessages(prev => prev.map((msg, i) => 
        i === prev.length - 1 && msg.type === 'bot' 
          ? { ...msg, content: formattedResponse }
          : msg
      ));
    }
  }, [queryResult, tableData.currentPage]);

  // Handle pagination changes
  const handlePageChange = (newPage) => {
    setTableData(prev => ({ ...prev, currentPage: newPage }));
    if (queryResult && queryResult.type === 'SELECT') {
      // Format and update the display with the new page
      const formattedResponse = formatResponse({ execution_result: queryResult });
      setMessages(prev => prev.map((msg, i) => 
        i === prev.length - 1 && msg.type === 'bot' 
          ? { ...msg, content: formattedResponse }
          : msg
      ));
    }
  };
  const formatResponse = (data) => {
    if (data.execution_result.type === 'SELECT') {
      const resultData = data.execution_result.data || [];
      const columns = data.execution_result.columns || [];
      const totalItems = resultData.length;
      const totalPages = Math.ceil(totalItems / itemsPerPage);
      
      // Use the current page from tableData state
      const startIndex = (tableData.currentPage - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const pageData = resultData.slice(startIndex, endIndex);

      const conversationalResponse = `I found ${totalItems} ${totalItems === 1 ? 'record' : 'records'}. ${
        totalItems > itemsPerPage ? `Showing page ${tableData.currentPage} of ${totalPages} (${itemsPerPage} items per page).` : ''
      }`;

      return (
        <>
          <div className="operation-badge select-badge">SELECT</div>
          <p className="chat-response">{conversationalResponse}</p>
          <div className="result-table">
            {columns && columns.length > 0 && (
              <>
                <table>
                  <thead>
                    <tr>
                      {columns.map((col, i) => (
                        <th key={i}>{col.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{
                            // Format date objects
                            cell instanceof Date || String(cell).match(/^\d{4}-\d{2}-\d{2}/) ? 
                              new Date(cell).toLocaleDateString() :
                            // Format decimal numbers
                            typeof cell === 'number' || String(cell).match(/^\d+\.\d{2}$/) ? 
                              parseFloat(cell).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              }) :
                            // Handle other types including null
                            cell === null ? 'NULL' : String(cell)
                          }</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      className="pagination-btn"
                      onClick={() => handlePageChange(Math.max(1, tableData.currentPage - 1))}
                      disabled={tableData.currentPage === 1}
                    >
                      Previous
                    </button>
                    <div className="page-numbers">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                        <button
                          key={page}
                          className={`page-number ${tableData.currentPage === page ? 'active' : ''}`}
                          onClick={() => handlePageChange(page)}
                        >
                          {page}
                        </button>
                      ))}
                    </div>
                    <button
                      className="pagination-btn"
                      onClick={() => handlePageChange(Math.min(totalPages, tableData.currentPage + 1))}
                      disabled={tableData.currentPage === totalPages}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      );
    } else {
      const message = data.execution_result.message;
      const conversationalResponse = message.replace(
        /(\d+) rows? affected/i,
        (match, num) => `I've successfully ${num === '1' ? 'updated 1 record' : `updated ${num} records`}`
      );

      return (
        <>
          <div className="operation-badge modify-badge">MODIFY</div>
          <p className="chat-response">{conversationalResponse}</p>
        </>
      );
    }
  };

  const handleIncompleteQuery = (data) => {
    const { table_name, next_prompt, voice_message } = data;
    setCurrentConversation(data);
    
    const messageContent = (
      <>
        <p>{voice_message}</p>
        <div className="insert-form">
          <h4>Adding new {table_name}</h4>
          {next_prompt.field_type === "select" ? (
            <select 
              className="department-select"
              onChange={(e) => handleFieldSubmit(e.target.value, next_prompt.field_name, data)}
            >
              <option value="">Select {next_prompt.field_name.replace('_', ' ')}</option>
              {next_prompt.options?.map(option => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="form-group">
              <label>{next_prompt.prompt}</label>
              <input
                type={next_prompt.field_type === 'date' ? 'date' : 'text'}
                className="form-input"
                placeholder={next_prompt.prompt}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleFieldSubmit(e.target.value, next_prompt.field_name, data);
                  }
                }}
              />
            </div>
          )}
        </div>
      </>
    );

    setMessages(prev => [...prev, {
      type: 'bot',
      content: messageContent
    }]);

    if (voice_message && voiceControlsRef.current) {
      voiceControlsRef.current.speakResponse(voice_message);
    }
  };

  const handleFieldSubmit = async (value, fieldName, previousData) => {
    try {
      const response = await fetch('http://localhost:8000/field-prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table_name: previousData.table_name,
          conversation_id: previousData.conversation_id,
          current_values: {
            ...(previousData.current_values || {}),
            [fieldName]: value
          }
        }),
      });

      const result = await response.json();

      if (result.status === 'complete') {
        const finalResponse = await fetch('http://localhost:8000/finalize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversation_id: previousData.conversation_id
          }),
        });

        const finalResult = await finalResponse.json();
        setMessages(prev => [...prev, {
          type: 'bot',
          content: finalResult.message
        }]);
        
        if (voiceControlsRef.current) {
          voiceControlsRef.current.speakResponse(finalResult.message);
        }
        
        setCurrentConversation(null);
      } else if (result.status === 'incomplete') {
        handleIncompleteQuery({
          ...previousData,
          next_prompt: result.next_prompt
        });
      }
    } catch (error) {
      console.error('Error submitting field:', error);
      setMessages(prev => [...prev, {
        type: 'bot',
        content: `Error: ${error.message}`
      }]);
    }
  };

  // Add voice transcript handler
  const handleVoiceTranscript = (transcript) => {
    setUserInput(transcript);
    handleSubmit({ preventDefault: () => {} });
  };
  // Function to speak text
  const speakMessage = (text) => {
    if (voiceControlsRef.current) {
      voiceControlsRef.current.speakResponse(text);
    }
  };

  // Speak messages when they're added
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === 'bot') {
        let textToSpeak = '';
        if (typeof lastMessage.content === 'string') {
          textToSpeak = lastMessage.content;
        } else if (lastMessage.content.props?.children) {
          // Extract text from JSX
          const extractText = (children) => {
            if (typeof children === 'string') return children;
            if (Array.isArray(children)) 
              return children.map(extractText).join(' ');
            if (children?.props?.children)
              return extractText(children.props.children);
            return '';
          };
          textToSpeak = extractText(lastMessage.content);
        }
        speakMessage(textToSpeak);
      }
    }
  }, [messages]);  const handleInputChange = (e) => {
    const value = e.target.value;
    setUserInput(value);
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (userInput.trim() && !isTyping) {
        handleSubmit();
      }
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {/* Message history */}
        {messages.map((msg, index) => (
          <div key={index} className={`message-container ${msg.type}-container`}>
            {msg.type === 'bot' && <div className="assistant-avatar">AI</div>}
            <div className={`message ${msg.type}-message`}>              {typeof msg.content === 'string' ? (
                <p>{msg.content}</p>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}

        {/* Enhanced typing indicator */}
        {isTyping && (
          <div className="message-container">
            <div className="assistant-avatar">AI</div>
            <div className="typing-indicator">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        )}
        
        <div ref={chatEndRef} />
      </div>
      <div className="input-area">        <input
          type="text"
          value={userInput}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          className="input-field"
          placeholder="Type your query or click mic to speak..."
          disabled={isTyping}
          autoComplete="off"
          autoFocus
        />
        <div className="controls">
          <VoiceControls
            ref={voiceControlsRef}
            onTranscript={handleVoiceTranscript}
            disabled={isTyping || !systemChecks.voice}
          />          <button
            type="button"
            onClick={(e) => handleSubmit(e)}
            className="send-btn"
            disabled={!userInput.trim() || isTyping}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatMessages;