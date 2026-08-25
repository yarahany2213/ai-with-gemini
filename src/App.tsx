/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from "react";
import { signInWithPopup, onAuthStateChanged, signOut, User } from "firebase/auth";
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";
import { LogIn, LogOut, Send, Bot, User as UserIcon, Loader2, ShoppingCart, CreditCard, X, CheckCircle2, ChevronDown, Download, Mic, MicOff, ArrowDown, Sun, Moon, Eye, Search } from "lucide-react";
import clsx from "clsx";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

// Load stripe client side
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "pk_test_placeholder");

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const logout = () => signOut(auth);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 text-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col min-h-screen w-full bg-slate-950 text-slate-100 font-sans overflow-hidden relative items-center justify-center px-10">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px]"></div>
          <div className="absolute top-1/2 -right-24 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-0 left-1/4 w-[600px] h-[300px] bg-slate-900/50 border border-slate-800/30 -rotate-6 rounded-3xl"></div>
        </div>
        <div className="relative z-10 w-full max-w-md bg-slate-900/80 border border-slate-800 p-10 rounded-3xl backdrop-blur-xl shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-indigo-500/20">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
            <p className="text-slate-400 text-sm">Sign in to access your unified AI workspace</p>
          </div>
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-3 bg-white text-slate-950 font-semibold py-3.5 px-4 rounded-xl hover:bg-slate-100 transition-colors mb-6 shadow-xl shadow-white/5"
          >
            <LogIn className="w-5 h-5" />
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  return <ChatScreen user={user} logout={logout} />;
}

function ChatScreen({ user, logout }: { user: User; logout: () => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [showCart, setShowCart] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [modelSelection, setModelSelection] = useState("auto");
  const [isListening, setIsListening] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light" | "hc">("dark");
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const isScrolledUp = scrollHeight - scrollTop - clientHeight > 100;
      setShowScrollButton(isScrolledUp);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // Check if user is Pro
    const checkProStatus = async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          setIsPro(userDoc.data().isPro || false);
        }
      } catch (error) {
        console.error("Failed to fetch user profile", error);
      }
    };
    checkProStatus();

    // Only load messages for the current user to keep it private
    const q = query(
      collection(db, `users/${user.uid}/messages`),
      orderBy("createdAt", "asc")
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
    });
    return () => unsubscribe();
  }, [user.uid]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping, streamingMessage]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();
    setInput("");
    
    // Add user message to DB
    const messagesRef = collection(db, `users/${user.uid}/messages`);
    await addDoc(messagesRef, {
      content: userMessage,
      role: "user",
      createdAt: serverTimestamp(),
    });

    setIsTyping(true);
    setStreamingMessage("");

    try {
      // Get conversation history to send to AI
      // The API endpoint expects an array of {role, content}
      const historyForAPI = messages.map((m) => ({
        role: m.role,
        content: m.content
      }));
      // Add the new user message
      historyForAPI.push({ role: "user", content: userMessage });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyForAPI, model: modelSelection }),
      });

      if (!res.ok) {
        let errMsg = "Network response was not ok";
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch (e) {}
        throw new Error(errMsg);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = "";

      if (reader) {
        setIsTyping(false); // Stop typing indicator
        
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 2);
            
            if (event.startsWith('data: ')) {
              const dataStr = event.slice(6);
              if (dataStr === '[DONE]') continue;
              
              try {
                const data = JSON.parse(dataStr);
                if (data.text) {
                  fullResponse += data.text;
                  setStreamingMessage(fullResponse);
                }
              } catch (e) {
                console.error("Error parsing stream chunk", e);
              }
            }
          }
        }
      }

      if (fullResponse) {
        await addDoc(messagesRef, {
          content: fullResponse,
          role: "model",
          createdAt: serverTimestamp(),
        });
      }
      setStreamingMessage("");
    } catch (error: any) {
      console.error("Failed to get AI response", error);
      await addDoc(messagesRef, {
        content: `Error: ${error.message || "Sorry, I'm having trouble connecting right now."}`,
        role: "model",
        createdAt: serverTimestamp(),
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleExport = () => {
    if (messages.length === 0) return;
    
    let text = "OmniAI Hub - Chat History\n\n";
    messages.forEach((msg) => {
      const role = msg.role === 'user' ? 'You' : 'AI';
      text += `${role}:\n${msg.content}\n\n`;
    });
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-history-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInput((prev) => {
          const separator = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
          return prev + separator + finalTranscript;
        });
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.error("Failed to start speech recognition", e);
    }
  };

  return (
    <div className={`flex flex-col h-screen bg-slate-950 text-slate-100 font-sans relative overflow-hidden theme-${theme}`}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute top-1/2 -right-24 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px]"></div>
      </div>
      
      {/* Header */}
      <header className="relative z-10 bg-slate-900/50 border-b border-slate-800/80 px-6 py-4 flex items-center justify-between backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-100 tracking-tight">OmniAI Hub</h1>
            <p className="text-xs text-indigo-400 flex items-center gap-1 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Connected & Ready
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-800/50 border border-slate-700 text-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 placeholder:text-slate-500 transition-all focus:bg-slate-800 focus:w-48"
            />
          </div>

          <button
            onClick={handleExport}
            disabled={messages.length === 0}
            title="Export Chat History"
            className="p-2 bg-slate-800/80 border border-slate-700 text-slate-300 rounded-lg hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 transition-colors flex items-center justify-center"
          >
            <Download className="w-4 h-4" />
          </button>
          
          {/* Theme Toggle */}
          <button
            onClick={() => setTheme(prev => prev === "dark" ? "light" : prev === "light" ? "hc" : "dark")}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/50 border border-slate-700/50 rounded-lg transition-colors flex items-center justify-center mr-2"
            title="Toggle Theme"
          >
            {theme === "dark" && <Moon className="w-5 h-5" />}
            {theme === "light" && <Sun className="w-5 h-5" />}
            {theme === "hc" && <Eye className="w-5 h-5" />}
          </button>

          <div className="relative">
            <select
              value={modelSelection}
              onChange={(e) => setModelSelection(e.target.value)}
              className="appearance-none bg-slate-800/80 border border-slate-700 text-slate-200 text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer"
            >
              <option value="auto">Auto-Select Model</option>
              <optgroup label="Google Gemini">
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
              </optgroup>
              <optgroup label="Anthropic">
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                <option value="claude-3-opus-20240229">Claude 3 Opus</option>
              </optgroup>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
          {!isPro ? (
            <button
              onClick={() => { setShowCart(true); setPaymentSuccess(false); }}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:from-indigo-400 hover:to-purple-500 shadow-lg shadow-indigo-500/20 transition-all"
            >
              <ShoppingCart className="w-4 h-4" />
              Upgrade Pro
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-slate-800/50 border border-indigo-500/30 text-indigo-400 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase">
              Pro Member
            </div>
          )}
          <button
            onClick={logout}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg transition-colors"
            title="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <main 
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-hide"
      >
        {messages.length === 0 && !isTyping && (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
            <div className="w-16 h-16 bg-slate-900/50 border border-slate-800 rounded-2xl flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-lg">One Chat. Three Titans.</p>
            <p className="text-sm mt-2 max-w-md">Connect GPT-4, Claude 3.5, and Gemini 1.5 Pro into a single unified workspace.</p>
          </div>
        )}
        
        {messages.filter(msg => (msg.content || "").toLowerCase().includes((searchQuery || "").toLowerCase())).map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={clsx(
                "flex items-start gap-3 max-w-[85%] sm:max-w-[75%]",
                isUser ? "ml-auto flex-row-reverse" : ""
              )}
            >
              <div
                className={clsx(
                  "w-8 h-8 shrink-0 rounded-lg flex items-center justify-center shadow-sm",
                  isUser ? "bg-indigo-600" : "bg-slate-800 border border-slate-700"
                )}
              >
                {isUser ? (
                  <UserIcon className="w-4 h-4 text-white" />
                ) : (
                  <Bot className="w-4 h-4 text-white" />
                )}
              </div>
              <div className={clsx("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
                <div
                  className={clsx(
                    "px-5 py-3.5 rounded-2xl shadow-md whitespace-pre-wrap leading-relaxed text-sm",
                    isUser
                      ? "bg-indigo-600 text-white rounded-tr-sm"
                      : "bg-slate-900/80 border border-slate-800 text-slate-200 rounded-tl-sm backdrop-blur-sm"
                  )}
                >
                  {msg.content}
                </div>
                {msg.createdAt && typeof msg.createdAt.toDate === 'function' && (
                  <span className="text-[10px] text-slate-500 px-1">
                    {msg.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        
        {streamingMessage && (
          <div className="flex items-start gap-3 max-w-[85%] sm:max-w-[75%]">
            <div className="w-8 h-8 shrink-0 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shadow-sm">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="px-5 py-3.5 rounded-2xl shadow-md whitespace-pre-wrap leading-relaxed text-sm bg-slate-900/80 border border-slate-800 text-slate-200 rounded-tl-sm backdrop-blur-sm">
              {streamingMessage}<span className="inline-block w-1.5 h-4 ml-1 align-middle bg-indigo-400 animate-pulse"></span>
            </div>
          </div>
        )}

        {isTyping && !streamingMessage && (
          <div className="flex items-start gap-3 max-w-[85%] sm:max-w-[75%]">
             <div className="w-8 h-8 shrink-0 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shadow-sm">
                <Bot className="w-4 h-4 text-white" />
             </div>
             <div className="px-5 py-4 bg-slate-900/80 border border-slate-800 text-slate-200 rounded-2xl rounded-tl-sm shadow-md backdrop-blur-sm flex gap-1 items-center">
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></div>
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center bg-slate-800/90 text-slate-200 border border-slate-700/80 rounded-full p-2.5 shadow-xl hover:bg-slate-700 transition-all backdrop-blur-md hover:-translate-y-1 hover:-translate-x-1/2"
          title="Jump to latest message"
        >
          <ArrowDown className="w-5 h-5" />
        </button>
      )}

      {/* Input */}
      <footer className="relative z-10 bg-slate-950/80 border-t border-slate-800/80 p-4 shrink-0 backdrop-blur-xl">
        <form
          onSubmit={sendMessage}
          className="max-w-4xl mx-auto flex items-center gap-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message gemini gpt and Claude..."
            className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 placeholder:text-slate-600 text-slate-200 transition-all"
            disabled={isTyping}
          />
          <button
            type="button"
            onClick={toggleListening}
            className={clsx(
              "w-11 h-11 shrink-0 rounded-xl flex items-center justify-center transition-colors shadow-lg",
              isListening 
                ? "bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500/30 animate-pulse" 
                : "bg-slate-800/80 text-slate-400 border border-slate-700 hover:text-white hover:bg-slate-700"
            )}
            title={isListening ? "Stop listening" : "Start dictation"}
          >
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className="w-11 h-11 shrink-0 bg-indigo-600 text-white rounded-xl flex items-center justify-center hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-600/20"
          >
            <Send className="w-4 h-4 ml-[-2px]" />
          </button>
        </form>
      </footer>
      
      {/* Checkout Modal */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
            <button
              onClick={() => setShowCart(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white bg-slate-800/50 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            {!paymentSuccess ? (
              <>
                <div className="text-center mb-6">
                  <div className="w-12 h-12 bg-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-indigo-500/30">
                    <ShoppingCart className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-bold text-white mb-2">OmniAI Pro</h2>
                  <p className="text-slate-400 text-sm">Unlock GPT-4, Claude 3.5, and Gemini 1.5 Pro with unlimited requests.</p>
                </div>
                
                <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-slate-300">Pro Subscription (Monthly)</span>
                    <span className="text-white font-semibold">$5.99</span>
                  </div>
                  <div className="flex justify-between items-center text-sm text-slate-500 border-t border-slate-800 pt-2 mt-2">
                    <span>Total due today</span>
                    <span className="text-indigo-400 font-bold">$5.99</span>
                  </div>
                </div>

                <Elements stripe={stripePromise}>
                  <CheckoutForm 
                    user={user} 
                    onSuccess={() => {
                      setPaymentSuccess(true);
                      setIsPro(true);
                    }} 
                  />
                </Elements>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/30">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Payment Successful!</h2>
                <p className="text-slate-400 text-sm mb-8">You are now an OmniAI Pro member.</p>
                <button
                  onClick={() => setShowCart(false)}
                  className="w-full bg-slate-800 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-slate-700 transition-colors"
                >
                  Return to Chat
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckoutForm({ user, onSuccess }: { user: User, onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isBuying, setIsBuying] = useState(false);
  const [error, setError] = useState("");

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || isBuying) return;

    setIsBuying(true);
    setError("");

    try {
      // 1. Get client secret from our backend
      const res = await fetch("/api/create-payment-intent", { method: "POST" });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to create payment intent");
      }

      // 2. Confirm payment
      const result = await stripe.confirmCardPayment(data.clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement) as any,
        },
      });

      if (result.error) {
        setError(result.error.message || "Payment failed");
        setIsBuying(false);
      } else if (result.paymentIntent?.status === "succeeded") {
        // 3. Mark user as pro in Firestore
        await setDoc(doc(db, "users", user.uid), { isPro: true }, { merge: true });
        onSuccess();
      }
    } catch (err: any) {
      console.error("Payment error", err);
      setError(err.message || "Failed to process payment");
      setIsBuying(false);
    }
  };

  return (
    <form onSubmit={handlePurchase} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Card Details</label>
        <div className="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3.5 focus-within:ring-2 focus-within:ring-indigo-500/50 transition-all">
          <CardElement 
            options={{ 
              style: { 
                base: { 
                  color: '#f8fafc', 
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '14px',
                  '::placeholder': { color: '#475569' }, 
                  iconColor: '#818cf8' 
                } 
              } 
            }} 
          />
        </div>
      </div>
      
      {error && (
        <div className="text-red-400 text-sm mt-2 p-3 bg-red-400/10 border border-red-400/20 rounded-lg">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || isBuying}
        className="w-full bg-indigo-600 text-white font-semibold py-3.5 px-4 rounded-xl hover:bg-indigo-500 disabled:opacity-70 disabled:hover:bg-indigo-600 transition-colors mt-6 shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
      >
        {isBuying ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Processing Payment...
          </>
        ) : (
          "Pay $5.99"
        )}
      </button>
    </form>
  );
}
